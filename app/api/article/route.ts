import { NextRequest, NextResponse } from "next/server";
import { ArticleRequestSchema, ArticleResponseSchema, ErrorResponseSchema } from "@/types/api";
import { fetchArticleWithDiffbot, extractDateFromDom, extractImageFromDom } from "@/lib/api/diffbot";
import { redis } from "@/lib/redis";
import { compress, decompress } from "@/lib/redis-compression";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import { AppError, createNetworkError, createParseError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { getTextDirection } from "@/lib/rtl";
import { sanitizeHtml, sanitizeText } from "@/lib/sanitize-ads";
import { scrubUrl } from "@/lib/privacy";
import { extractArticleUrl } from "@/lib/validation/url";

const logger = createLogger('api:article');

// Diffbot Article schema - validates the response from fetchArticleWithDiffbot
const DiffbotArticleSchema = z.object({
  title: z.string().min(1, "Article title cannot be empty"),
  html: z.string().min(1, "Article HTML content cannot be empty"),
  text: z.string().min(1, "Article text content cannot be empty"),
  siteName: z.string().min(1, "Site name cannot be empty"),
  byline: z.string().optional().nullable(),
  publishedTime: z.string().optional().nullable(),
  image: z.string().nullable().optional(),
  htmlContent: z.string().optional(),
  lang: z.string().optional().nullable(),
});

// Article schema for caching
const CachedArticleSchema = z.object({
  title: z.string(),
  content: z.string(),
  textContent: z.string(),
  length: z.number().int().positive(),
  siteName: z.string(),
  byline: z.string().optional().nullable(),
  publishedTime: z.string().optional().nullable(),
  image: z.string().nullable().optional(),
  htmlContent: z.string().optional(),
  lang: z.string().optional().nullable(),
  dir: z.enum(['rtl', 'ltr']).optional().nullable(),
});

type CachedArticle = z.infer<typeof CachedArticleSchema>;

type ArticleMetadata = {
  title: string;
  siteName: string;
  length: number;
  byline?: string | null;
  publishedTime?: string | null;
  image?: string | null;
};

/**
 * Get URL with source prefix
 */
function getUrlWithSource(source: string, url: string): string {
  switch (source) {
    case "wayback":
      return `https://web.archive.org/web/2/${url}`;
    case "fetch-fast":
    case "fetch-slow":
    default:
      return url;
  }
}

function buildFetchUrl(url: string, source?: string | null): string {
  const siteUrl = process.env.NEXT_PUBLIC_URL || "https://smry.ai";
  if (!source || source === "fetch-fast") {
    return `${siteUrl}/${url}`;
  }

  return `${siteUrl}/${url}?source=${source}`;
}

/**
 * Save or return longer article
 */
async function saveOrReturnLongerArticle(
  key: string,
  newArticle: CachedArticle
): Promise<CachedArticle> {
  try {
    // Validate incoming article first
    const incomingValidation = CachedArticleSchema.safeParse(newArticle);

    if (!incomingValidation.success) {
      const validationError = fromError(incomingValidation.error);
      logger.error({
        key,
        validationError: validationError.toString(),
        articleData: {
          hasTitle: !!newArticle.title,
          hasContent: !!newArticle.content,
          hasTextContent: !!newArticle.textContent,
          length: newArticle.length,
        }
      }, 'Incoming article validation failed');
      throw new Error(`Invalid article data: ${validationError.toString()}`);
    }

    const validatedNewArticle = incomingValidation.data;

    // Helper to save both compressed article and metadata
    const saveToCache = async (article: CachedArticle) => {
      const metaKey = `meta:${key}`;
      const metadata: ArticleMetadata = {
        title: article.title,
        siteName: article.siteName,
        length: article.length,
        byline: article.byline,
        publishedTime: article.publishedTime,
        image: article.image,
      };

      await Promise.all([
        redis.set(key, compress(article)),
        redis.set(metaKey, metadata)
      ]);
    };

    const rawCachedData = await redis.get(key);
    const cachedData = decompress(rawCachedData);

    if (cachedData) {
      const existingValidation = CachedArticleSchema.safeParse(cachedData);

      if (!existingValidation.success) {
        const validationError = fromError(existingValidation.error);
        logger.warn({
          key,
          validationError: validationError.toString()
        }, 'Existing cache validation failed - replacing with new article');

        // Save new article since existing is invalid
        await saveToCache(validatedNewArticle);
        logger.debug({ key, length: validatedNewArticle.length }, 'Cached article (replaced invalid)');
        return validatedNewArticle;
      }

      const existingArticle = existingValidation.data;

      // Prioritize HTML content: if existing is missing HTML but new one has it, update cache
      if (!existingArticle.htmlContent && validatedNewArticle.htmlContent) {
        await saveToCache(validatedNewArticle);
        logger.debug({ key, length: validatedNewArticle.length }, 'Cached article (replaced missing HTML)');
        return validatedNewArticle;
      }

      if (validatedNewArticle.length > existingArticle.length) {
        await saveToCache(validatedNewArticle);
        logger.debug({ key, newLength: validatedNewArticle.length, oldLength: existingArticle.length }, 'Cached longer article');
        return validatedNewArticle;
      } else {
        logger.debug({ key, length: existingArticle.length }, 'Using existing cached article');
        return existingArticle;
      }
    } else {
      // No existing article, save the new one
      await saveToCache(validatedNewArticle);
      logger.debug({ key, length: validatedNewArticle.length }, 'Cached article (new)');
      return validatedNewArticle;
    }
  } catch (error) {
    const validationError = fromError(error);
    logger.warn({ error: validationError.toString() }, 'Cache operation error');
    // Return the new article even if caching fails
    return newArticle;
  }
}

// Browser User-Agents for rotation (real Chrome on different platforms)
const BROWSER_USER_AGENTS = [
  // Chrome on Windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  // Chrome on macOS
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  // Chrome on Linux
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];

// Googlebot User-Agents (many sites whitelist these for SEO indexing)
const GOOGLEBOT_USER_AGENTS = [
  // Googlebot Desktop
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  // Googlebot Smartphone
  "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
];

type FetchStrategy = "browser" | "googlebot";

/**
 * Result from a fetch attempt with parsed article for quality comparison
 */
interface FetchResult {
  success: boolean;
  strategy: FetchStrategy;
  html?: string;
  article?: CachedArticle;
  quality: number;  // Higher = better quality content
  error?: string;
}

/**
 * Calculate quality score for an article
 * Higher scores indicate more complete/better content
 */
function calculateQuality(article: CachedArticle): number {
  // Primary: textContent length
  let score = article.textContent.length;

  // Bonus: has byline (+100)
  if (article.byline) score += 100;

  // Bonus: has publishedTime (+100)  
  if (article.publishedTime) score += 100;

  // Bonus: has image (+50)
  if (article.image) score += 50;

  return score;
}

/**
 * Cookie jar for persisting cookies (especially DataDome) across retry attempts
 */
interface CookieJar {
  cookies: Map<string, string>;
}

/**
 * Extract cookies from Set-Cookie response header
 */
function extractSetCookies(headers: Record<string, string>): Map<string, string> {
  const cookies = new Map<string, string>();
  const setCookie = headers['set-cookie'];
  if (setCookie) {
    // Parse set-cookie header - handle comma-separated cookies carefully
    // Cookie values can contain commas, so we split on comma followed by a cookie name pattern
    const cookieStrings = setCookie.split(/,(?=\s*[a-zA-Z_][a-zA-Z0-9_-]*=)/);
    for (const cookie of cookieStrings) {
      // Extract just the name=value part (before any attributes like ; Path=/)
      const match = cookie.match(/^\s*([^=]+)=([^;]*)/);
      if (match) {
        const name = match[1].trim();
        const value = match[2].trim();
        // Only store cookies we care about (datadome, cf_clearance, etc.)
        if (name === 'datadome' || name === 'cf_clearance' || name === '__cf_bm') {
          cookies.set(name, value);
        }
      }
    }
  }
  return cookies;
}

/**
 * Build Cookie header string from jar
 */
function buildCookieHeader(jar: CookieJar): string | undefined {
  if (jar.cookies.size === 0) return undefined;
  return Array.from(jar.cookies.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

/**
 * Build headers for a specific fetch strategy
 */
function buildFetchHeaders(url: string, strategy: FetchStrategy, cookieJar?: CookieJar): HeadersInit {
  const cookieHeader = cookieJar ? buildCookieHeader(cookieJar) : undefined;

  if (strategy === "googlebot") {
    // Googlebot headers - simpler, but whitelisted by many sites
    const userAgent = GOOGLEBOT_USER_AGENTS[Math.floor(Math.random() * GOOGLEBOT_USER_AGENTS.length)];
    const headers: Record<string, string> = {
      "User-Agent": userAgent,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      "Accept-Encoding": "gzip, deflate",
      "Connection": "keep-alive",
    };
    if (cookieHeader) headers["Cookie"] = cookieHeader;
    return headers;
  }

  // Browser strategy - full Chrome emulation
  const userAgent = BROWSER_USER_AGENTS[Math.floor(Math.random() * BROWSER_USER_AGENTS.length)];
  const headers: Record<string, string> = {
    "User-Agent": userAgent,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
    "Connection": "keep-alive",
    "DNT": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control": "max-age=0",
  };
  // Include accumulated cookies (critical for DataDome bypass on retries)
  if (cookieHeader) headers["Cookie"] = cookieHeader;
  return headers;
}




/**
 * Attempt to fetch with a specific strategy
 * Includes tarpit detection: if body read takes too long, abort early
 */
async function tryFetchWithStrategy(
  url: string,
  strategy: FetchStrategy,
  cookieJar?: CookieJar
): Promise<{ html: string; strategy: FetchStrategy } | { status: number; blocked: boolean; headers?: Record<string, string> }> {
  const headers = buildFetchHeaders(url, strategy, cookieJar);
  const controller = new AbortController();
  // Reduced from 35s to 15s - sites that tarpit from the start should fail faster
  // so we can try other strategies sooner
  const timeoutMs = 15000; // Overall request timeout (headers + body)
  const bodyTimeoutMs = 10000; // Tarpit detection: abort if body doesn't arrive within 10s of headers
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const startTime = Date.now();

  try {
    const response = await fetch(url, {
      headers,
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const headersReceivedTime = Date.now();
    const headersLatency = headersReceivedTime - startTime;

    // Collect headers for debugging
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((val, key) => {
      responseHeaders[key] = val;
    });

    // Check if blocked (401 Unauthorized, 403 Forbidden, 429 Rate Limited)
    if (response.status === 401 || response.status === 403 || response.status === 429) {
      logger.warn({
        source: "fetch-fast",
        strategy,
        status: response.status,
        headers: responseHeaders,
        url: scrubUrl(url)
      }, 'Request blocked by target site');

      return { status: response.status, blocked: true, headers: responseHeaders };
    }

    if (!response.ok) {
      logger.warn({
        source: "fetch-fast",
        strategy,
        status: response.status,
        headers: responseHeaders,
        url: scrubUrl(url)
      }, 'Request failed (non-blocked)');
      return { status: response.status, blocked: false, headers: responseHeaders };
    }

    // Tarpit detection: set a timeout for reading the body
    // Some sites (like WaPo) send headers quickly but slow-drip the body
    const bodyController = new AbortController();
    const bodyTimeoutId = setTimeout(() => bodyController.abort(), bodyTimeoutMs);

    try {
      // Race between body read and timeout
      const html = await Promise.race([
        response.text(),
        new Promise<never>((_, reject) => {
          bodyController.signal.addEventListener('abort', () => {
            const bodyDuration = Date.now() - headersReceivedTime;
            reject(new Error(`TARPIT_DETECTED: Body read timed out after ${bodyDuration}ms`));
          });
        })
      ]);

      clearTimeout(bodyTimeoutId);

      logger.debug({
        source: "fetch-fast",
        strategy,
        headersLatency,
        totalDuration: Date.now() - startTime,
        htmlLength: html.length,
      }, 'Fetch completed successfully');

      return { html, strategy };
    } catch (bodyError: any) {
      clearTimeout(bodyTimeoutId);

      if (bodyError.message?.startsWith('TARPIT_DETECTED')) {
        logger.warn({
          source: "fetch-fast",
          strategy,
          url: scrubUrl(url),
          headersLatency,
          bodyTimeout: bodyTimeoutMs,
        }, 'Tarpit detected: body read timed out, aborting early');

        return { status: 408, blocked: true, headers: responseHeaders };
      }
      throw bodyError;
    }
  } catch (error: any) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      const duration = Date.now() - startTime;
      logger.error({ source: "fetch-fast", strategy, url: scrubUrl(url), duration }, 'Fetch request timed out');
      return { status: 408, blocked: false };
    }

    throw error;
  }
}



/**
 * Parse HTML into a validated CachedArticle
 */
function parseHtmlToArticle(
  html: string,
  url: string,
  strategy: FetchStrategy
): CachedArticle | null {
  if (!html || html.length < 100) {
    return null;
  }

  try {
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const parsed = reader.parse();

    if (!parsed || !parsed.content || !parsed.textContent) {
      return null;
    }

    // Extract language from HTML
    const htmlLang = dom.window.document.documentElement.getAttribute('lang') ||
      dom.window.document.documentElement.getAttribute('xml:lang') ||
      parsed.lang ||
      null;

    // Detect text direction based on language or content analysis
    const textDir = getTextDirection(htmlLang, parsed.textContent);

    const articleCandidate: CachedArticle = {
      title: parsed.title || dom.window.document.title || 'Untitled',
      content: sanitizeHtml(parsed.content),
      textContent: sanitizeText(parsed.textContent),
      length: parsed.textContent.length,
      siteName: (() => {
        try {
          return new URL(url).hostname;
        } catch {
          return parsed.siteName || 'unknown';
        }
      })(),
      byline: parsed.byline,
      publishedTime: extractDateFromDom(dom.window.document) || null,
      image: extractImageFromDom(dom.window.document) || null,
      htmlContent: html,
      lang: htmlLang,
      dir: textDir,
    };

    const validationResult = CachedArticleSchema.safeParse(articleCandidate);
    if (!validationResult.success) {
      return null;
    }

    return validationResult.data;
  } catch {
    return null;
  }
}

/**
 * Attempt a single fetch strategy and return a FetchResult with quality scoring
 */
async function tryFetchAndParse(
  url: string,
  strategy: FetchStrategy,
  cookieJar: CookieJar,
  hostname: string
): Promise<FetchResult> {
  const result = await tryFetchWithStrategy(url, strategy, cookieJar);

  // Accumulate cookies from response (even on failure)
  if ('headers' in result && result.headers) {
    const newCookies = extractSetCookies(result.headers);
    if (newCookies.size > 0) {
      newCookies.forEach((value, key) => cookieJar.cookies.set(key, value));
      logger.debug({
        source: "fetch-fast",
        hostname,
        strategy,
        newCookies: Array.from(newCookies.keys()),
        totalCookies: cookieJar.cookies.size,
      }, 'Accumulated cookies from response');
    }
  }

  // Check if blocked or failed
  if ('status' in result) {
    return {
      success: false,
      strategy,
      quality: 0,
      error: `HTTP ${result.status}`,
    };
  }

  // Got HTML - try to parse it
  const { html } = result;
  const article = parseHtmlToArticle(html, url, strategy);

  if (!article) {
    return {
      success: false,
      strategy,
      html,
      quality: 0,
      error: 'Readability extraction failed',
    };
  }

  const quality = calculateQuality(article);

  return {
    success: true,
    strategy,
    html,
    article,
    quality,
  };
}

async function fetchArticleWithFast(
  url: string
): Promise<{ article: CachedArticle; cacheURL: string } | { error: AppError }> {
  const hostname = new URL(url).hostname;

  // Cookie jar to persist cookies (especially DataDome) across retry attempts
  const cookieJar: CookieJar = { cookies: new Map() };

  // Collect all successful results for quality comparison
  const results: FetchResult[] = [];

  try {
    // Strategy 1: Browser (immediate)
    logger.info({
      source: "fetch-fast",
      hostname,
      strategy: "browser",
      attempt: 1,
      cookieCount: 0,
    }, 'Fetching with browser');

    const browserResult = await tryFetchAndParse(url, "browser", cookieJar, hostname);
    results.push(browserResult);

    // If browser succeeded with high quality, return immediately (optimization)
    if (browserResult.success && browserResult.quality > 3000) {
      logger.info({
        source: "fetch-fast",
        hostname,
        strategy: "browser",
        quality: browserResult.quality,
        earlyReturn: true,
      }, 'High quality result, returning early');

      return {
        article: browserResult.article!,
        cacheURL: url,
      };
    }

    // Strategy 2: Googlebot (with delay and cookies)
    if (!browserResult.success || browserResult.quality < 3000) {
      await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 100));

      logger.info({
        source: "fetch-fast",
        hostname,
        strategy: "googlebot",
        attempt: 2,
        cookieCount: cookieJar.cookies.size,
      }, 'Fetching with googlebot');

      const googlebotResult = await tryFetchAndParse(url, "googlebot", cookieJar, hostname);
      results.push(googlebotResult);
    }

    // Strategy 3: Browser retry with accumulated cookies (if we have cookies)
    if (cookieJar.cookies.size > 0) {
      await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 200));

      logger.info({
        source: "fetch-fast",
        hostname,
        strategy: "browser",
        attempt: 3,
        cookieCount: cookieJar.cookies.size,
        isRetryWithCookies: true,
      }, 'Fetching with browser (with cookies)');

      const cookieRetryResult = await tryFetchAndParse(url, "browser", cookieJar, hostname);
      results.push(cookieRetryResult);
    }

    // Pick the best result by quality
    const successfulResults = results.filter(r => r.success && r.article);

    if (successfulResults.length === 0) {
      // All strategies failed
      const lastError = results[results.length - 1]?.error || 'Unknown error';
      logger.error({
        source: "fetch-fast",
        hostname,
        totalAttempts: results.length,
        cookiesAccumulated: cookieJar.cookies.size,
        errors: results.map(r => ({ strategy: r.strategy, error: r.error })),
      }, 'All fetch strategies failed');

      return {
        error: createNetworkError(
          `All fetch strategies failed: ${lastError}`,
          url,
          500
        ),
      };
    }

    // Sort by quality (descending) and pick the best
    successfulResults.sort((a, b) => b.quality - a.quality);
    const bestResult = successfulResults[0];

    // Log quality comparison if we have multiple successful results
    if (successfulResults.length > 1) {
      logger.info({
        source: "fetch-fast",
        hostname,
        winner: bestResult.strategy,
        winnerQuality: bestResult.quality,
        alternatives: successfulResults.slice(1).map(r => ({
          strategy: r.strategy,
          quality: r.quality,
        })),
      }, 'Selected best quality result');
    }

    logger.info({
      source: "fetch-fast",
      hostname,
      title: bestResult.article!.title,
      length: bestResult.article!.length,
      strategy: bestResult.strategy,
      quality: bestResult.quality,
      cookiesUsed: cookieJar.cookies.size,
    }, 'Article fetched and parsed successfully');

    return {
      article: bestResult.article!,
      cacheURL: url,
    };
  } catch (error) {
    logger.error({ source: "fetch-fast", hostname, error }, 'Fetch exception');
    return {
      error: createNetworkError('Failed to fetch article directly', url, undefined, error),
    };
  }
}



/**
 * Fetch article directly from Wayback Machine (archive.org) without using Diffbot
 * This bypasses Diffbot's rate limits by fetching and parsing with Readability directly
 */
async function fetchArticleWithWayback(
  waybackUrl: string,
  originalUrl: string
): Promise<{ article: CachedArticle; cacheURL: string } | { error: AppError }> {
  try {
    logger.info({ source: "wayback", waybackUrl, originalHostname: new URL(originalUrl).hostname }, 'Fetching article from archive.org directly');

    // Pick a random User-Agent to avoid fingerprinting
    const userAgent = BROWSER_USER_AGENTS[Math.floor(Math.random() * BROWSER_USER_AGENTS.length)];

    const controller = new AbortController();
    const timeoutMs = 20000; // 20 seconds timeout for Wayback (it can be slow)
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(waybackUrl, {
      headers: {
        // Core browser headers
        "User-Agent": userAgent,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",

        // Security headers that browsers send
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",

        // Client hints (Chrome-specific)
        "Sec-CH-UA": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        "Sec-CH-UA-Mobile": "?0",
        "Sec-CH-UA-Platform": '"Windows"',

        // Additional headers
        "Upgrade-Insecure-Requests": "1",
        "Cache-Control": "max-age=0",
      },
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Specific logging for archive.org rate limits
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      logger.error({
        source: "wayback",
        status: 429,
        retryAfter,
        waybackUrl
      }, 'Archive.org rate limit exceeded (429)');
      return {
        error: createNetworkError(
          `Archive.org rate limit exceeded. The Wayback Machine is temporarily limiting requests. Please try again later or use a different source tab.`,
          waybackUrl,
          429
        ),
      };
    }

    if (!response.ok) {
      logger.error({ source: "wayback", status: response.status, waybackUrl }, 'Archive.org fetch HTTP error');
      return {
        error: createNetworkError(
          `HTTP ${response.status} error when fetching from archive.org`,
          waybackUrl,
          response.status
        ),
      };
    }

    const html = await response.text();

    if (!html) {
      logger.warn({ source: "wayback", htmlLength: 0 }, 'Received empty HTML content from archive.org');
      return {
        error: createParseError('Received empty HTML content from archive.org', 'wayback'),
      };
    }

    // Store original HTML before Readability parsing
    const originalHtml = html;

    // Use the original URL as the base for parsing (not the wayback URL)
    // This helps Readability correctly resolve relative URLs
    const dom = new JSDOM(html, { url: originalUrl });
    const reader = new Readability(dom.window.document);
    const parsed = reader.parse();

    if (!parsed || !parsed.content || !parsed.textContent) {
      logger.warn({ source: "wayback", waybackUrl }, 'Readability extraction failed for archived page');
      return {
        error: createParseError('Failed to extract article content from archived page with Readability', 'wayback'),
      };
    }

    // Extract language from HTML
    const htmlLang = dom.window.document.documentElement.getAttribute('lang') ||
      dom.window.document.documentElement.getAttribute('xml:lang') ||
      parsed.lang ||
      null;

    // Detect text direction based on language or content analysis
    const textDir = getTextDirection(htmlLang, parsed.textContent);

    const articleCandidate: CachedArticle = {
      title: parsed.title || dom.window.document.title || 'Untitled',
      content: sanitizeHtml(parsed.content),
      textContent: sanitizeText(parsed.textContent),
      length: parsed.textContent.length,
      siteName: (() => {
        try {
          return new URL(originalUrl).hostname;
        } catch {
          return parsed.siteName || 'archive.org';
        }
      })(),
      byline: parsed.byline,
      publishedTime: extractDateFromDom(dom.window.document) || null,
      image: extractImageFromDom(dom.window.document) || null,
      htmlContent: originalHtml, // Original archived page HTML
      lang: htmlLang,
      dir: textDir,
    };

    const validationResult = CachedArticleSchema.safeParse(articleCandidate);

    if (!validationResult.success) {
      const validationError = fromError(validationResult.error);
      logger.error({ source: "wayback", validationError: validationError.toString() }, 'Wayback article validation failed');
      return {
        error: createParseError(
          `Invalid Wayback article: ${validationError.toString()}`,
          'wayback',
          validationError
        ),
      };
    }

    const validatedArticle = validationResult.data;
    logger.info({ source: "wayback", title: validatedArticle.title, length: validatedArticle.length }, 'Wayback article parsed and validated');

    return {
      article: validatedArticle,
      cacheURL: waybackUrl,
    };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      logger.error({ source: "wayback", waybackUrl, timeoutMs: 20000 }, 'Wayback fetch timed out');
      return {
        error: createNetworkError('Connection timed out when fetching from archive.org', waybackUrl, 408),
      };
    }
    logger.error({ source: "wayback", error, waybackUrl }, 'Wayback fetch exception');
    return {
      error: createNetworkError('Failed to fetch article from archive.org', waybackUrl, undefined, error),
    };
  }
}

/**
 * Fetch and parse article using Diffbot (for fetch-slow and wayback sources)
 */
async function fetchArticleWithDiffbotWrapper(
  urlWithSource: string,
  source: string
): Promise<{ article: CachedArticle; cacheURL: string } | { error: AppError }> {
  try {
    logger.info({ source, hostname: new URL(urlWithSource).hostname }, 'Fetching article with Diffbot');

    // Pass source parameter to enable debug tracking
    const diffbotResult = await fetchArticleWithDiffbot(urlWithSource, source);

    if (diffbotResult.isErr()) {
      const error = diffbotResult.error;
      logger.error({ source, errorType: error.type, message: error.message, hasDebugContext: !!error.debugContext }, 'Diffbot fetch failed');
      return { error };
    }

    const diffbotArticle = diffbotResult.value;

    // Validate Diffbot response with Zod
    const validationResult = DiffbotArticleSchema.safeParse(diffbotArticle);

    if (!validationResult.success) {
      const validationError = fromError(validationResult.error);
      logger.error({
        source,
        validationError: validationError.toString(),
        receivedData: {
          hasTitle: !!diffbotArticle.title,
          hasHtml: !!diffbotArticle.html,
          hasText: !!diffbotArticle.text,
          hasSiteName: !!diffbotArticle.siteName,
          titleLength: diffbotArticle.title?.length || 0,
          htmlLength: diffbotArticle.html?.length || 0,
          textLength: diffbotArticle.text?.length || 0,
        }
      }, 'Diffbot response validation failed');

      return {
        error: createParseError(
          `Invalid Diffbot response: ${validationError.toString()}`,
          source,
          validationError
        )
      };
    }

    const validatedArticle = validationResult.data;

    // Detect text direction based on language or content analysis
    const textDir = getTextDirection(validatedArticle.lang, validatedArticle.text);

    const article: CachedArticle = {
      title: validatedArticle.title,
      content: sanitizeHtml(validatedArticle.html),
      textContent: sanitizeText(validatedArticle.text),
      length: validatedArticle.text.length,
      siteName: validatedArticle.siteName,
      byline: validatedArticle.byline,
      publishedTime: validatedArticle.publishedTime,
      image: validatedArticle.image,
      htmlContent: validatedArticle.htmlContent,
      lang: validatedArticle.lang,
      dir: textDir,
    };

    logger.debug({ source, title: article.title, length: article.length, lang: article.lang, dir: article.dir }, 'Diffbot article parsed and validated');
    return { article, cacheURL: urlWithSource };
  } catch (error) {
    logger.error({ source, error }, 'Article parsing exception');
    return { error: createParseError("Failed to parse article", source, error) };
  }
}

/**
 * Fetch and parse article - routes to appropriate method based on source
 */
async function fetchArticle(
  urlWithSource: string,
  source: string,
  originalUrl?: string
): Promise<{ article: CachedArticle; cacheURL: string } | { error: AppError }> {
  switch (source) {
    case "fetch-fast":
      return fetchArticleWithFast(urlWithSource);
    case "fetch-slow":
      return fetchArticleWithDiffbotWrapper(urlWithSource, source);
    case "wayback":
      // Use direct fetch from archive.org instead of Diffbot
      // This bypasses Diffbot rate limits
      return fetchArticleWithWayback(urlWithSource, originalUrl || urlWithSource);
    default:
      return {
        error: createParseError(`Unsupported source: ${source}`, source),
      };
  }
}

/**
 * GET /api/article?url=...&source=...
 */
export async function GET(request: NextRequest) {
  try {
    // Parse and validate query parameters
    const searchParams = request.nextUrl.searchParams;
    const url = searchParams.get("url");
    const source = searchParams.get("source");

    const validationResult = ArticleRequestSchema.safeParse({ url, source });

    if (!validationResult.success) {
      const error = fromError(validationResult.error);
      const debugFetchUrl = url ? buildFetchUrl(url, source ?? "fetch-fast") : undefined;
      logger.error({ error: error.toString(), fetchUrl: scrubUrl(debugFetchUrl), url: scrubUrl(url), source }, 'Validation error - Full URL for debugging');
      return NextResponse.json(
        ErrorResponseSchema.parse({
          error: error.toString(),
          type: "VALIDATION_ERROR",
        }),
        { status: 400 }
      );
    }

    const { url: validatedUrl, source: validatedSource } = validationResult.data;

    // Construct the full smry.ai URL for debugging
    const fetchUrl = buildFetchUrl(validatedUrl, validatedSource);

    // DEBUG: Log request details
    logger.debug({
      action: '[CACHE_DEBUG]',
      step: 'request_received',
      details: {
        rawUrl: scrubUrl(url),
        validatedUrl: scrubUrl(validatedUrl),
        source: validatedSource,
        fetchUrl: scrubUrl(fetchUrl)
      }
    }, 'Cache Debug: Article Request Received');

    // Jina.ai is handled by a separate endpoint (/api/jina) for client-side fetching
    if (validatedSource === "jina.ai") {
      logger.warn({ source: validatedSource, fetchUrl: scrubUrl(fetchUrl) }, 'Jina.ai source not supported in this endpoint');
      return NextResponse.json(
        ErrorResponseSchema.parse({
          error: "Jina.ai source is handled client-side. Use /api/jina endpoint instead.",
          type: "VALIDATION_ERROR",
        }),
        { status: 400 }
      );
    }

    logger.info({ source: validatedSource, hostname: new URL(validatedUrl).hostname, fetchUrl: scrubUrl(fetchUrl) }, 'API Request');

    const urlWithSource = getUrlWithSource(validatedSource, validatedUrl);
    // Use extractArticleUrl to normalize trailing slashes for consistent cache keys
    const normalizedUrlForCache = extractArticleUrl(validatedUrl);
    const cacheKey = `${validatedSource}:${normalizedUrlForCache}`;

    logger.debug({
      action: '[CACHE_DEBUG]',
      step: 'key_generated',
      cacheKey,
      urlWithSource
    }, 'Cache Debug: Key Generated');

    // Try to get from cache
    try {
      logger.debug({
        action: '[CACHE_DEBUG]',
        step: 'redis_get_start'
      }, 'Cache Debug: Attempting Redis GET');

      const rawCachedArticle = await redis.get(cacheKey);
      const cachedArticle = decompress(rawCachedArticle);

      logger.debug({
        action: '[CACHE_DEBUG]',
        step: 'redis_get_result',
        result: cachedArticle ? 'HIT' : 'MISS',
        length: cachedArticle?.length,
        hasHtml: !!cachedArticle?.htmlContent
      }, 'Cache Debug: Redis GET Result');

      if (cachedArticle) {
        // Validate cached data
        const cacheValidation = CachedArticleSchema.safeParse(cachedArticle);

        if (!cacheValidation.success) {
          const validationError = fromError(cacheValidation.error);
          logger.warn({
            cacheKey,
            validationError: validationError.toString(),
            receivedType: typeof cachedArticle,
            hasKeys: cachedArticle ? Object.keys(cachedArticle as any) : []
          }, 'Cache validation failed - will fetch fresh');
          // Continue to fetch fresh data instead of using invalid cache
        } else {
          const article = cacheValidation.data;

          if (article.length > 900 && article.htmlContent) {
            logger.debug({
              action: '[CACHE_DEBUG]',
              step: 'cache_hit_valid',
              length: article.length
            }, 'Cache hit - returning cached article');

            logger.debug({ source: validatedSource, hostname: new URL(validatedUrl).hostname, length: article.length }, 'Cache hit');

            // Validate final response structure
            const response = ArticleResponseSchema.parse({
              source: validatedSource,
              cacheURL: urlWithSource,
              article: {
                title: article.title,
                byline: article.byline || null,
                dir: article.dir || getTextDirection(article.lang, article.textContent),
                lang: article.lang || "",
                content: article.content,
                textContent: article.textContent,
                length: article.length,
                siteName: article.siteName,
                publishedTime: article.publishedTime || null,
                image: article.image || null,
                htmlContent: article.htmlContent,
              },
              status: "success",
            });

            return NextResponse.json(response);
          } else if (article.length > 900 && !article.htmlContent) {
            logger.warn({
              action: '[CACHE_DEBUG]',
              step: 'cache_skip_missing_html',
              length: article.length
            }, 'Cache hit SKIPPED: Missing HTML content');
            logger.info({ source: validatedSource, hostname: new URL(validatedUrl).hostname }, 'Cache hit but missing HTML content - fetching fresh');
          } else {
            logger.warn({
              action: '[CACHE_DEBUG]',
              step: 'cache_skip_short',
              length: article.length,
              threshold: 900,
              hasHtml: !!article.htmlContent
            }, 'Cache hit SKIPPED: Article too short (< 900 chars)');
          }
        }
      }
    } catch (error) {
      const validationError = fromError(error);
      logger.warn({
        error: error instanceof Error ? error.message : String(error),
        validationError: validationError.toString()
      }, 'Cache read error');
      // Continue to fetch fresh data
    }

    // Fetch fresh data
    logger.info({ source: validatedSource, fetchUrl: scrubUrl(fetchUrl) }, 'Fetching fresh data');
    const result = await fetchArticle(urlWithSource, validatedSource, validatedUrl);

    if ("error" in result) {
      const appError = result.error;
      logger.error({
        source: validatedSource,
        errorType: appError.type,
        message: appError.message,
        hasDebugContext: !!appError.debugContext,
        fetchUrl: scrubUrl(fetchUrl),
        urlWithSource: scrubUrl(urlWithSource),
      }, 'Fetch failed - Full URL for debugging');

      // Include cacheURL in error details so frontend can show the actual URL that was attempted
      const errorDetails = {
        ...appError,
        url: urlWithSource, // The actual URL that was attempted (with source prefix)
        fetchUrl, // Full smry.ai URL for easy debugging
      };

      return NextResponse.json(
        ErrorResponseSchema.parse({
          error: appError.message,
          type: appError.type,
          details: errorDetails,
          debugContext: appError.debugContext,
        }),
        { status: 500 }
      );
    }

    const { article, cacheURL } = result;

    // Save to cache
    try {
      logger.debug({
        action: '[CACHE_DEBUG]',
        step: 'redis_set_attempt',
        length: article.length
      }, 'Cache Debug: Attempting to save to cache');

      const savedArticle = await saveOrReturnLongerArticle(cacheKey, article);

      // Validate saved article
      const savedValidation = CachedArticleSchema.safeParse(savedArticle);

      if (!savedValidation.success) {
        const validationError = fromError(savedValidation.error);
        logger.error({
          cacheKey,
          validationError: validationError.toString()
        }, 'Saved article validation failed');

        // Use original article if saved validation fails
        const response = ArticleResponseSchema.parse({
          source: validatedSource,
          cacheURL,
          article: {
            title: article.title,
            byline: article.byline || null,
            dir: article.dir || getTextDirection(article.lang, article.textContent),
            lang: article.lang || "",
            content: article.content,
            textContent: article.textContent,
            length: article.length,
            siteName: article.siteName,
            publishedTime: article.publishedTime || null,
            htmlContent: article.htmlContent,
          },
          status: "success",
        });

        return NextResponse.json(response);
      }

      const validatedSavedArticle = savedValidation.data;

      const response = ArticleResponseSchema.parse({
        source: validatedSource,
        cacheURL,
        article: {
          title: validatedSavedArticle.title,
          byline: validatedSavedArticle.byline || null,
          dir: validatedSavedArticle.dir || getTextDirection(validatedSavedArticle.lang, validatedSavedArticle.textContent),
          lang: validatedSavedArticle.lang || "",
          content: validatedSavedArticle.content,
          textContent: validatedSavedArticle.textContent,
          length: validatedSavedArticle.length,
          siteName: validatedSavedArticle.siteName,
          publishedTime: validatedSavedArticle.publishedTime || null,
          htmlContent: validatedSavedArticle.htmlContent,
        },
        status: "success",
      });

      logger.info({ source: validatedSource, title: validatedSavedArticle.title }, 'Success');
      return NextResponse.json(response);
    } catch (error) {
      const validationError = fromError(error);
      logger.warn({
        error: error instanceof Error ? error.message : String(error),
        validationError: validationError.toString()
      }, 'Cache save error');

      // Return article even if caching fails - validate it first
      const articleValidation = CachedArticleSchema.safeParse(article);

      if (!articleValidation.success) {
        const articleError = fromError(articleValidation.error);
        logger.error({
          validationError: articleError.toString()
        }, 'Article validation failed in error handler');

        // Return error if we can't validate the article
        return NextResponse.json(
          ErrorResponseSchema.parse({
            error: `Article validation failed: ${articleError.toString()}`,
            type: "VALIDATION_ERROR",
          }),
          { status: 500 }
        );
      }

      const validatedArticle = articleValidation.data;

      const response = ArticleResponseSchema.parse({
        source: validatedSource,
        cacheURL,
        article: {
          title: validatedArticle.title,
          byline: validatedArticle.byline || null,
          dir: validatedArticle.dir || getTextDirection(validatedArticle.lang, validatedArticle.textContent),
          lang: validatedArticle.lang || "",
          content: validatedArticle.content,
          textContent: validatedArticle.textContent,
          length: validatedArticle.length,
          siteName: validatedArticle.siteName,
          publishedTime: validatedArticle.publishedTime || null,
          image: validatedArticle.image || null,
          htmlContent: validatedArticle.htmlContent,
        },
        status: "success",
      });

      return NextResponse.json(response);
    }
  } catch (error) {
    // Try to extract URL info for better debugging
    const searchParams = request.nextUrl.searchParams;
    const url = searchParams.get("url");
    const source = searchParams.get("source") || "fetch-fast";
    const debugFetchUrl = url ? buildFetchUrl(url, source) : undefined;

    logger.error({
      error,
      fetchUrl: scrubUrl(debugFetchUrl),
      url: scrubUrl(url),
      source,
    }, 'Unexpected error in API route - Full URL for debugging');

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
