import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import { createLogger } from "@/lib/logger";
import { redis } from "@/lib/redis";
import { compress, decompress } from "@/lib/redis-compression";
import { getTextDirection } from "@/lib/rtl";
import { ArticleResponseSchema, ErrorResponseSchema } from "@/types/api";
import { marked } from "marked";
import { sanitizeHtml, sanitizeText } from "@/lib/sanitize-ads";

const logger = createLogger("api:jina:fetch");

// Configure marked
marked.setOptions({
    breaks: true,
    gfm: true,
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
 * Convert markdown to HTML
 */
function convertMarkdownToHtml(markdown: string): string {
    try {
        const html = marked.parse(markdown);
        return typeof html === "string" ? html : "";
    } catch (error) {
        logger.warn({ error }, "Failed to convert markdown via marked");
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
 * Parse Jina.ai markdown response
 */
function parseJinaResponse(
    markdown: string,
    url: string
): CachedArticle | { error: string } {
    const lines = markdown.split("\n");

    const title = lines[0]?.replace("Title: ", "").trim() || "Untitled";

    let urlSourceLine = "";
    let publishedTime = null;
    let contentStartIndex = 4;

    for (let i = 0; i < Math.min(10, lines.length); i++) {
        if (lines[i].startsWith("URL Source:")) {
            urlSourceLine = lines[i].replace("URL Source: ", "").trim();
            contentStartIndex = i + 2;

            if (lines[i + 2]?.startsWith("Published Time:")) {
                publishedTime = lines[i + 2].replace("Published Time: ", "").trim();
                contentStartIndex = i + 4;
            }

            if (lines[contentStartIndex]?.includes("Markdown Content:")) {
                contentStartIndex++;
            }

            break;
        }
    }

    const urlSource = urlSourceLine || url;
    const mainContent = lines.slice(contentStartIndex).join("\n").trim();

    if (!mainContent || mainContent.length < 100) {
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
 * Fetch article from Jina.ai using premium API (server-side)
 */
async function fetchFromJinaPremium(
    url: string,
    apiKey: string
): Promise<CachedArticle | { error: string; status?: number }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), JINA_TIMEOUT_MS);

    try {
        logger.info({ hostname: extractHostname(url) }, "Fetching with Jina premium API");

        const response = await fetch("https://r.jina.ai/", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                "X-Engine": "cf-browser-rendering",
                "X-Respond-With": "readerlm-v2",
                "X-Timeout": "20",
                "X-Token-Budget": "150000",
            },
            body: JSON.stringify({ url }),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            logger.error({ status: response.status }, "Jina premium API error");
            return { error: `Jina API error: ${response.status}`, status: response.status };
        }

        const markdown = await response.text();
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
        logger.info({ hostname: extractHostname(url) }, "Fetching with Jina public API (no API key)");

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
        const result = apiKey
            ? await fetchFromJinaPremium(url, apiKey)
            : await fetchFromJinaPublic(url);

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
