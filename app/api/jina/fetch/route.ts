import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import { createLogger } from "@/lib/logger";
import { redis } from "@/lib/redis";
import { compress, decompress } from "@/lib/redis-compression";
import { getTextDirection } from "@/lib/rtl";
import { ArticleResponseSchema, ErrorResponseSchema } from "@/types/api";
import Showdown from "showdown";
import { sanitizeHtml, sanitizeText } from "@/lib/sanitize-ads";

const logger = createLogger("api:jina:fetch");

// Configure Showdown converter with extensions for GitHub Flavored Markdown
const showdownConverter = new Showdown.Converter({
    tables: true,
    strikethrough: true,
    ghCodeBlocks: true,
    tasklists: true,
    smoothLivePreview: true,
    simpleLineBreaks: true,
    openLinksInNewWindow: true,
    emoji: true,
    underline: true,
    ellipsis: true,
    simplifiedAutoLink: true,
    excludeTrailingPunctuationFromURLs: true,
    literalMidWordUnderscores: true,
    ghMentions: false,
    backslashEscapesHTMLTags: true,
});

// Jina.ai Configuration
const JINA_TIMEOUT_MS = 75000; // 75 seconds timeout for cf-browser-rendering

// Request schema
const JinaFetchRequestSchema = z.object({
    url: z.string().url(),
});

// Cached article schema
const CachedArticleSchema = z.object({
    title: z.string(),
    content: z.string(),
    textContent: z.string(),
    length: z.number().int().positive(),
    siteName: z.string(),
    byline: z.string().optional().nullable(),
    publishedTime: z.string().optional().nullable(),
    htmlContent: z.string().optional(),
    lang: z.string().optional().nullable(),
    dir: z.enum(["rtl", "ltr"]).optional().nullable(),
});

type CachedArticle = z.infer<typeof CachedArticleSchema>;

/**
 * Extract hostname from URL safely
 */
function extractHostname(url: string): string {
    try {
        return new URL(url).hostname;
    } catch {
        return "unknown";
    }
}

/**
 * Convert markdown to HTML using Showdown
 */
function convertMarkdownToHtml(markdown: string): string {
    try {
        return showdownConverter.makeHtml(markdown);
    } catch (error) {
        logger.warn({ error }, "Failed to convert markdown via Showdown");
        // Fallback to simple conversion
        const escaped = markdown
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
        return escaped
            .split(/\n{2,}/)
            .map((chunk) => `<p>${chunk.replace(/\n/g, "<br />")}</p>`)
            .join("");
    }
}

/**
 * Parse Jina.ai response
 * Handles multiple formats:
 * - JSON: {"code":200,"status":20000,"data":{"title":"...","content":"...",...},"meta":{...}}
 * - Premium (readerlm-v2): Simple markdown starting with "# Title"
 * - Public: Structured format with "Title:", "URL Source:", "Published Time:", "Markdown Content:"
 */
function parseJinaResponse(
    responseText: string,
    url: string
): CachedArticle | { error: string } {
    // First, try to detect and parse JSON response format
    const trimmedResponse = responseText.trim();
    if (trimmedResponse.startsWith("{")) {
        try {
            const jsonResponse = JSON.parse(trimmedResponse);
            logger.debug({
                hasData: !!jsonResponse.data,
                dataType: typeof jsonResponse.data,
                code: jsonResponse.code,
                status: jsonResponse.status,
                dataKeys: jsonResponse.data ? Object.keys(jsonResponse.data) : []
            }, "Parsed JSON response from Jina");

            // Validate it has the expected Jina JSON structure
            if (jsonResponse.data && typeof jsonResponse.data === "object") {
                const { title, content, url: sourceUrl } = jsonResponse.data;

                logger.debug({
                    hasTitle: !!title,
                    titlePreview: title?.substring(0, 50),
                    hasContent: !!content,
                    contentType: typeof content,
                    contentLength: content?.length || 0,
                    contentPreview: typeof content === "string" ? content.substring(0, 100) : "N/A",
                    sourceUrl
                }, "Extracted fields from Jina JSON data");

                if (content && typeof content === "string" && content.length > 50) {
                    logger.debug("Parsing JSON Jina response format");

                    // The content may be wrapped in markdown code fences like ```markdown ... ```
                    // Strip them if present
                    let rawContent = content.trim();

                    // Check for ```markdown at the start and ``` at the end
                    const codeFenceMatch = rawContent.match(/^```(?:markdown)?\s*\n?([\s\S]*?)\n?```\s*$/);
                    if (codeFenceMatch) {
                        rawContent = codeFenceMatch[1].trim();
                        logger.debug("Stripped markdown code fences from JSON content");
                    }

                    const mainContent = rawContent;
                    const contentHtml = convertMarkdownToHtml(mainContent);
                    const textDir = getTextDirection(null, mainContent);

                    // Try to extract published time from the content if present
                    let publishedTime: string | null = null;
                    const dateMatch = mainContent.match(
                        /\*\*([A-Za-z]+\s+\d{1,2},?\s+\d{4}[^*]*)\*\*/
                    );
                    if (dateMatch) {
                        publishedTime = dateMatch[1].trim();
                    }

                    // Try to extract byline from the content
                    let byline: string | null = null;
                    const bylineMatch = mainContent.match(/^##\s+By\s+(.+)$/m) ||
                        mainContent.match(/^###\s+By\s+(.+)$/m);
                    if (bylineMatch) {
                        byline = bylineMatch[1].trim();
                    }

                    return {
                        title: (title || "Untitled").trim(),
                        content: sanitizeHtml(contentHtml),
                        textContent: sanitizeText(mainContent),
                        length: mainContent.length,
                        siteName: extractHostname(sourceUrl || url),
                        byline: byline,
                        publishedTime: publishedTime,
                        htmlContent: contentHtml,
                        lang: null,
                        dir: textDir,
                    };
                } else {
                    logger.debug({ contentLength: content?.length || 0 }, "JSON content too short or missing, falling back to markdown parsing");
                }
            }
        } catch (parseError) {
            // Not valid JSON, continue with markdown parsing
            logger.debug({ error: parseError instanceof Error ? parseError.message : String(parseError) }, "Response looks like JSON but failed to parse, trying markdown format");
        }
    }

    // Fall back to markdown parsing
    const lines = trimmedResponse.split("\n");

    // Detect format: public API has structured headers
    const hasStructuredFormat = lines.some(
        (line, i) =>
            i < 10 &&
            (line.startsWith("Title:") ||
                line.startsWith("URL Source:") ||
                line.startsWith("Markdown Content:"))
    );

    let title = "Untitled";
    let urlSource = url;
    let publishedTime: string | null = null;
    let mainContent = "";

    if (hasStructuredFormat) {
        // Parse structured format (public API)
        logger.debug("Parsing structured Jina response format");

        let contentStartIndex = 0;

        for (let i = 0; i < Math.min(15, lines.length); i++) {
            const line = lines[i];

            if (line.startsWith("Title:")) {
                title = line.replace("Title:", "").trim() || "Untitled";
            } else if (line.startsWith("URL Source:")) {
                urlSource = line.replace("URL Source:", "").trim() || url;
            } else if (line.startsWith("Published Time:")) {
                publishedTime = line.replace("Published Time:", "").trim() || null;
            } else if (line.includes("Markdown Content:")) {
                contentStartIndex = i + 1;
                break;
            }
        }

        // If no "Markdown Content:" found, try to find where content starts
        if (contentStartIndex === 0) {
            for (let i = 0; i < Math.min(15, lines.length); i++) {
                if (
                    !lines[i].startsWith("Title:") &&
                    !lines[i].startsWith("URL Source:") &&
                    !lines[i].startsWith("Published Time:") &&
                    lines[i].trim().length > 0
                ) {
                    contentStartIndex = i;
                    break;
                }
            }
        }

        mainContent = lines.slice(contentStartIndex).join("\n").trim();
    } else {
        // Parse simple markdown format (premium API with readerlm-v2)
        logger.debug("Parsing simple markdown Jina response format (premium)");

        // First line with # is typically the title
        for (let i = 0; i < Math.min(10, lines.length); i++) {
            const line = lines[i].trim();
            if (line.startsWith("# ")) {
                title = line.replace(/^#\s+/, "").trim();
                break;
            } else if (line.startsWith("## ") && title === "Untitled") {
                // Fall back to ## if no # found
                title = line.replace(/^##\s+/, "").trim();
            }
        }

        // Try to extract author/byline from "## By Author" pattern
        let bylineMatch: string | null = null;
        for (let i = 0; i < Math.min(15, lines.length); i++) {
            const line = lines[i].trim();
            if (line.startsWith("## By ") || line.startsWith("### By ")) {
                bylineMatch = line.replace(/^###?\s+By\s+/i, "").trim();
                break;
            }
        }

        // Try to extract published time from bold date pattern like "**December 19, 2025...**"
        for (let i = 0; i < Math.min(20, lines.length); i++) {
            const line = lines[i].trim();
            const dateMatch = line.match(
                /\*\*([A-Za-z]+\s+\d{1,2},?\s+\d{4}[^*]*)\*\*/
            );
            if (dateMatch) {
                publishedTime = dateMatch[1].trim();
                break;
            }
        }

        // The entire content is the markdown (it's already formatted)
        mainContent = trimmedResponse;

        // Store byline if found (we'll add it to the return object)
        if (bylineMatch) {
            logger.debug({ byline: bylineMatch }, "Extracted byline from premium response");
        }
    }

    if (!mainContent || mainContent.length < 50) {
        return { error: "Jina.ai returned insufficient content" };
    }

    const contentHtml = convertMarkdownToHtml(mainContent);
    const textDir = getTextDirection(null, mainContent);

    return {
        title: title,
        content: sanitizeHtml(contentHtml),
        textContent: sanitizeText(mainContent),
        length: mainContent.length,
        siteName: extractHostname(urlSource),
        byline: null,
        publishedTime: publishedTime,
        htmlContent: contentHtml,
        lang: null,
        dir: textDir,
    };
}

/**
 * Parse SSE (Server-Sent Events) response from Jina premium API
 * Each event contains progressively accumulated content
 * Returns the final complete content from the last event
 */
function parseSSEResponse(sseText: string): { title: string; content: string; url: string } | null {
    const lines = sseText.split("\n");
    let lastData: { title: string; content: string; url: string } | null = null;

    for (const line of lines) {
        if (line.startsWith("data:")) {
            const jsonStr = line.substring(5).trim();
            if (jsonStr) {
                try {
                    const data = JSON.parse(jsonStr);
                    if (data.content !== undefined) {
                        lastData = {
                            title: data.title || "",
                            content: data.content || "",
                            url: data.url || ""
                        };
                    }
                } catch {
                    // Skip invalid JSON lines
                }
            }
        }
    }

    return lastData;
}

/**
 * Fetch article from Jina.ai using premium API (server-side)
 */
async function fetchFromJinaPremium(
    url: string,
    apiKey: string
): Promise<CachedArticle | { error: string; status?: number }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), JINA_TIMEOUT_MS);

    try {
        logger.info(
            { hostname: extractHostname(url), mode: "PREMIUM", hasApiKey: true },
            "🔑 Fetching with Jina PREMIUM API (cf-browser-rendering + readerlm-v2)"
        );

        const response = await fetch(`https://r.jina.ai/${url}`, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "X-Engine": "browser",
                "X-Timeout": "15",
                "X-Token-Budget": "75000",
                "X-With-Links-Summary": "false"
            },
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            logger.error({ status: response.status }, "Jina premium API error");
            return { error: `Jina API error: ${response.status}`, status: response.status };
        }

        const markdown = await response.text();

        // Detect stub response: when Jina fails to extract content, it returns just the URL
        // Pattern: ```markdown\n{"url": "..."}\n``` or similar minimal responses
        const isStubResponse =
            markdown.length < 500 &&
            markdown.includes('"url"') &&
            !markdown.includes('"content"') &&
            !markdown.includes('"title"');

        if (isStubResponse) {
            logger.warn(
                { responseLength: markdown.length },
                "⚠️ Jina premium returned stub response (no content extracted), falling back to public API"
            );
            // Return a special error that signals we should try public API
            return { error: "STUB_RESPONSE", status: 206 };
        }

        return parseJinaResponse(markdown, url);
    } catch (error) {
        clearTimeout(timeoutId);

        if (error instanceof Error && error.name === "AbortError") {
            return { error: `Request timed out after ${JINA_TIMEOUT_MS / 1000} seconds`, status: 408 };
        }

        logger.error({ error }, "Jina premium fetch error");
        return { error: error instanceof Error ? error.message : "Failed to fetch from Jina.ai" };
    }
}

/**
 * Fetch article from Jina.ai using public API (fallback)
 */
async function fetchFromJinaPublic(
    url: string
): Promise<CachedArticle | { error: string; status?: number }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), JINA_TIMEOUT_MS);

    try {
        logger.info(
            { hostname: extractHostname(url), mode: "PUBLIC", hasApiKey: false },
            "⚠️ Fetching with Jina PUBLIC API (no API key configured)"
        );

        const response = await fetch(`https://r.jina.ai/${url}`, {
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            logger.error({ status: response.status }, "Jina public API error");
            return { error: `HTTP error: ${response.status}`, status: response.status };
        }

        const markdown = await response.text();
        return parseJinaResponse(markdown, url);
    } catch (error) {
        clearTimeout(timeoutId);

        if (error instanceof Error && error.name === "AbortError") {
            return { error: `Request timed out after ${JINA_TIMEOUT_MS / 1000} seconds`, status: 408 };
        }

        logger.error({ error }, "Jina public fetch error");
        return { error: error instanceof Error ? error.message : "Failed to fetch from Jina.ai" };
    }
}

/**
 * POST /api/jina/fetch
 * Fetch article from Jina.ai (server-side, keeps API key secure)
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const validationResult = JinaFetchRequestSchema.safeParse(body);

        if (!validationResult.success) {
            const error = fromError(validationResult.error);
            logger.error({ error: error.toString() }, "Validation error");
            return NextResponse.json(
                ErrorResponseSchema.parse({
                    error: error.toString(),
                    type: "VALIDATION_ERROR",
                }),
                { status: 400 }
            );
        }

        const { url } = validationResult.data;
        const cacheKey = `jina.ai:${url}`;

        // Step 1: Check cache first
        try {
            const rawCachedArticle = await redis.get(cacheKey);
            const cachedArticle = decompress(rawCachedArticle);

            if (cachedArticle) {
                const article = CachedArticleSchema.parse(cachedArticle);

                if (article.length > 4000) {
                    logger.debug({ hostname: extractHostname(url), length: article.length }, "Jina cache hit");

                    return NextResponse.json(
                        ArticleResponseSchema.parse({
                            source: "jina.ai",
                            cacheURL: `https://r.jina.ai/${url}`,
                            article: {
                                ...article,
                                byline: article.byline || "",
                                dir: article.dir || getTextDirection(article.lang, article.textContent),
                                lang: article.lang || "",
                                publishedTime: article.publishedTime || null,
                            },
                            status: "success",
                        })
                    );
                }
            }
        } catch (error) {
            logger.warn({ error: error instanceof Error ? error.message : String(error) }, "Jina cache check error");
        }

        // Step 2: Fetch from Jina.ai
        const apiKey = process.env.JINA_API_KEY;

        // Log which mode will be used
        logger.info(
            {
                hostname: extractHostname(url),
                hasApiKey: !!apiKey,
                apiKeyLength: apiKey?.length || 0,
                mode: apiKey ? "PREMIUM" : "PUBLIC"
            },
            apiKey
                ? "🔑 JINA_API_KEY is set, using PREMIUM mode"
                : "⚠️ JINA_API_KEY not set, falling back to PUBLIC mode"
        );

        let result = apiKey
            ? await fetchFromJinaPremium(url, apiKey)
            : await fetchFromJinaPublic(url);

        // If premium API returned a stub response (no content), fallback to public API
        if ("error" in result && result.error === "STUB_RESPONSE" && apiKey) {
            logger.info(
                { hostname: extractHostname(url) },
                "🔄 Premium API failed to extract content, retrying with PUBLIC API"
            );
            result = await fetchFromJinaPublic(url);
        }

        if ("error" in result) {
            logger.error({ error: result.error }, "Jina fetch failed");
            return NextResponse.json(
                ErrorResponseSchema.parse({
                    error: result.error,
                    type: "JINA_ERROR",
                }),
                { status: result.status || 500 }
            );
        }

        // Step 3: Cache the result
        try {
            const metaKey = `meta:${cacheKey}`;
            const metadata = {
                title: result.title,
                siteName: result.siteName,
                length: result.length,
                byline: result.byline,
                publishedTime: result.publishedTime,
            };

            await Promise.all([
                redis.set(cacheKey, compress(result)),
                redis.set(metaKey, metadata),
            ]);

            logger.info({ hostname: extractHostname(url), length: result.length }, "Jina article cached");
        } catch (error) {
            logger.warn({ error: error instanceof Error ? error.message : String(error) }, "Jina cache save error");
        }

        // Step 4: Return result
        return NextResponse.json(
            ArticleResponseSchema.parse({
                source: "jina.ai",
                cacheURL: `https://r.jina.ai/${url}`,
                article: {
                    ...result,
                    byline: result.byline || "",
                    lang: result.lang || "",
                    publishedTime: result.publishedTime || null,
                },
                status: "success",
            })
        );
    } catch (error) {
        logger.error({ error }, "Unexpected error in Jina fetch");

        return NextResponse.json(
            ErrorResponseSchema.parse({
                error: "An unexpected error occurred",
                type: "UNKNOWN_ERROR",
                details: error instanceof Error ? error.message : String(error),
            }),
            { status: 500 }
        );
    }
}
