import { NextRequest, NextResponse, after } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from "ai";
import { z } from "zod";
import { createLogger } from "@/lib/logger";
import { redis } from "@/lib/redis";
import { extractArticleUrl } from "@/lib/validation/url";
// CLERK DISABLED - auth import commented out
// import { auth } from "@clerk/nextjs/server";

// Configure AI provider (OpenRouter by default, but customizable)
// Users can set OPENAI_BASE_URL to any OpenAI-compatible endpoint
const openai = createOpenAI({
  baseURL: process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENAI_API_KEY!,
  headers: {
    // Optional headers for app attribution and rankings (mainly for OpenRouter)
    'HTTP-Referer': process.env.NEXT_PUBLIC_URL || 'http://localhost:3000',
    'X-Title': process.env.NEXT_PUBLIC_SITE_NAME || 'Paywall Bypass & AI Summaries',
  },
});

const logger = createLogger('api:summary');

// Default model if not specified in env
const DEFAULT_MODEL = "openai/gpt-oss-20b:free";

// Timeouts
const REDIS_TIMEOUT_MS = 5000; // 5 seconds for Redis operations
const AI_TIMEOUT_MS = 45000;  // 45 seconds to wait for AI stream to start/complete

// Helper to wrap promises with a timeout
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T> {
  let timeoutHandle: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutHandle!);
    return result;
  } catch (error) {
    clearTimeout(timeoutHandle!);
    throw error;
  }
}

// Request schema for useCompletion
const SummaryRequestSchema = z.object({
  prompt: z.string().min(400, "Content must be at least 400 characters"),
  title: z.string().optional(),
  url: z.string().optional(),
  ip: z.string().optional(),
  language: z.string().optional().default("en"),
  source: z.string().optional().default("fetch-fast"), // Source tab for cache differentiation
});

// Base summary prompt template
const BASE_SUMMARY_PROMPT = `You are an expert researcher and editor, skilled at distilling complex texts into clear, concise, and accurate summaries.

I will provide you with an article. Your task is to generate a summary that captures the essence of the text while adhering to the following instructions.

Instructions for the summary:

Core Thesis: Begin by identifying and stating the article's central argument or main topic in a single, clear sentence.

Key Points: Extract the primary supporting arguments, findings, or main points of the article. Present these as a bulleted list, with each point being a complete and self-contained sentence.

Conclusion: Summarize the article's conclusion, implications, or call to action in a final sentence.

What to Exclude:

Do not include minor details, tangential information, or lengthy, specific examples.

Paraphrase all information; do not use direct quotes.

Exclude your own opinions, interpretations, or any information not explicitly present in the provided article.

Format and Structure:

Start with a brief introductory paragraph that states the core thesis.

Follow with a bulleted list of the key supporting points.

End with a concluding sentence that captures the article's final message.

Length: The entire summary should be approximately 2-3 paragraphs.

Tone and Audience:

Maintain a neutral, objective, and informative tone throughout.

The summary should be written for an audience that has not read the article and needs to quickly grasp its essential information.

Here is the article to summarize:

{text}`;

// Language-specific instructions
const LANGUAGE_INSTRUCTIONS: Record<string, string> = {
  en: "Summarize in English.",
  es: "Summarize in Spanish.",
  fr: "Summarize in French.",
  de: "Summarize in German.",
  zh: "Summarize in Chinese.",
  ja: "Summarize in Japanese.",
  pt: "Summarize in Portuguese.",
  ru: "Summarize in Russian.",
  hi: "Summarize in Hindi.",
  it: "Summarize in Italian.",
  ko: "Summarize in Korean.",
  ar: "Summarize in Arabic.",
  nl: "Summarize in Dutch.",
  tr: "Summarize in Turkish.",
};

/**
 * POST /api/summary
 * Generate AI summary of article content
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    logger.info({
      contentLength: body.prompt?.length,
      title: body.title,
      language: body.language
    }, 'Summary Request');

    const validationResult = SummaryRequestSchema.safeParse(body);

    if (!validationResult.success) {
      const error = validationResult.error.issues[0]?.message || "Invalid request parameters";
      logger.error({ error: validationResult.error }, 'Validation error');
      return NextResponse.json({ error }, { status: 400 });
    }

    const { prompt: content, title, url, ip, language, source } = validationResult.data;
    const clientIp = ip || request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for") || "unknown";

    // Normalize URL for consistent cache keys
    // Use extractArticleUrl to strip app-specific params and normalize trailing slashes
    // This ensures cache hits work regardless of how the URL was formatted
    // Returns null if no URL provided (content-based caching fallback)
    const normalizedUrl = url ? extractArticleUrl(url) : null;

    // DEBUG: Log request details using logger to ensure it appears in docker logs
    logger.debug({
      action: '[CACHE_DEBUG]',
      step: 'request_received',
      details: { url, normalizedUrl, language, source }
    }, 'Cache Debug: Request Received');

    logger.debug({
      clientIp,
      language,
      source,
      contentLength: content.length,
      url: normalizedUrl
    }, 'Request details');

    // Check cache FIRST (before rate limiting)
    // This ensures cache hits don't count against user's rate limit
    // Cache key includes language AND source for proper differentiation
    const cacheKey = normalizedUrl
      ? `summary:${source}:${language}:${normalizedUrl}`
      : `summary:${source}:${language}:${Buffer.from(content.substring(0, 500)).toString('base64').substring(0, 50)}`;

    logger.debug({
      action: '[CACHE_DEBUG]',
      step: 'key_generated',
      cacheKey
    }, 'Cache Debug: Key Generated');

    // Try to get cached summary, but don't fail if Redis is down
    let cached: string | null = null;
    try {
      logger.debug({
        action: '[CACHE_DEBUG]',
        step: 'redis_get_start'
      }, 'Cache Debug: Attempting Redis GET');

      cached = await withTimeout(
        redis.get<string>(cacheKey),
        REDIS_TIMEOUT_MS,
        'Redis GET'
      );

      logger.debug({
        action: '[CACHE_DEBUG]',
        step: 'redis_get_result',
        result: cached ? 'HIT' : 'MISS',
        length: cached?.length
      }, 'Cache Debug: Redis GET Result');

      if (cached && typeof cached === "string") {
        logger.info({ cacheKey }, 'Cache hit - returning cached summary');
        // Return cached response with [CACHED] prefix so frontend can detect
        // and avoid incrementing usage counter
        return new Response(`[CACHED]${cached}`, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "X-Cache-Hit": "true"
          },
        });
      }
    } catch (redisError) {
      logger.debug({
        action: '[CACHE_DEBUG]',
        step: 'redis_get_error',
        error: redisError
      }, 'Cache Debug: Redis GET Error');

      // If Redis cache retrieval fails, log it but proceed to generate the summary
      logger.warn({ error: redisError }, 'Redis cache retrieval failed/timed out, will generate fresh summary');
    }

    logger.debug({ cacheKey }, 'Cache miss - will generate new summary');

    // CLERK DISABLED - Check if user is premium - always false without auth
    // const { has } = await auth();
    // const isPremium = has?.({ plan: "premium" }) ?? false;
    const isPremium = false;

    // Rate limiting - skip for premium users or when disabled for development
    // Only runs on cache miss to avoid counting cached responses against limit
    const disableRateLimit = process.env.DISABLE_RATE_LIMIT === 'true';
    if (!isPremium && !disableRateLimit) {
      try {
        // Configurable daily limit (default: 20)
        const envLimit = process.env.SUMMARY_DAILY_LIMIT;

        // DEBUG: Enviroment variable check
        logger.debug({
          action: '[ENV_DEBUG]',
          raw: envLimit,
          parsed: parseInt(envLimit || '20', 10)
        }, 'Env Debug: SUMMARY_DAILY_LIMIT');

        const dailyLimit = parseInt(envLimit || '20', 10);

        // We wrap rate limiting in timeout too, since it depends on Redis
        const checkRateLimits = async () => {
          const dailyRatelimit = new Ratelimit({
            redis: redis,
            limiter: Ratelimit.slidingWindow(dailyLimit, "1 d"),
          });

          const minuteRatelimit = new Ratelimit({
            redis: redis,
            limiter: Ratelimit.slidingWindow(6, "1 m"),
          });

          // Run in parallel
          const [dailyResult, minuteResult] = await Promise.all([
            dailyRatelimit.limit(`ratelimit_daily_${clientIp}`),
            minuteRatelimit.limit(`ratelimit_minute_${clientIp}`)
          ]);

          return { dailySuccess: dailyResult.success, minuteSuccess: minuteResult.success };
        };

        const { dailySuccess, minuteSuccess } = await withTimeout(
          checkRateLimits(),
          REDIS_TIMEOUT_MS,
          'Rate Limit Check'
        );

        if (!dailySuccess) {
          logger.warn({ clientIp, dailyLimit }, 'Daily rate limit exceeded');
          return NextResponse.json(
            { error: `Your daily limit of ${dailyLimit} summaries has been reached. Please return tomorrow.` },
            { status: 429 }
          );
        }

        if (!minuteSuccess) {
          logger.warn({ clientIp }, 'Minute rate limit exceeded');
          return NextResponse.json(
            { error: "Your limit of 6 summaries per minute has been reached. Please slow down." },
            { status: 429 }
          );
        }
      } catch (redisError) {
        // If Redis fails, log the error but allow the request to proceed
        // This ensures that Redis outages don't break the summary feature
        logger.warn({ error: redisError, clientIp }, 'Redis rate limiting failed/timed out, allowing request');
      }
    } else if (isPremium) {
      logger.debug({ clientIp }, 'Premium user - skipping rate limits');
    }

    // Content length is already validated by schema (minimum 2000 characters)

    logger.info({ title: title || 'article' }, 'Generating summary');

    // Get language-specific instruction
    const languageInstruction = LANGUAGE_INSTRUCTIONS[language] || LANGUAGE_INSTRUCTIONS.en;

    // Combine base prompt with language instruction
    const userPrompt = `${BASE_SUMMARY_PROMPT}\n\n${languageInstruction}`;

    // Variable to manually accumulate text if onFinish's text is empty
    let fullText = "";

    // Create an abort controller for the stream
    const abortController = new AbortController();

    // Set a timeout to abort the stream if it takes too long
    // Note: This is an overall timeout for the stream initialization/first chunks
    // It's not a perfect "total duration" timeout because streamText keeps the connection open
    setTimeout(() => {
      // Only abort if we haven't finished (though checking if finished here is tricky without external state)
      // The AbortController doesn't hurt if the stream is already done
      abortController.abort();
    }, AI_TIMEOUT_MS);

    // Using OpenRouter's free tier model with automatic provider fallback
    const result = streamText({
      model: openai(process.env.SUMMARIZATION_MODEL || DEFAULT_MODEL),
      messages: [
        {
          role: "user",
          content: userPrompt.replace("{text}", content.substring(0, 6000)),
        },
      ],
      abortSignal: abortController.signal,
      // Manually accumulate text because onFinish seems to receive empty text in some configurations
      onChunk: async ({ chunk }) => {
        if (chunk.type === 'text-delta') {
          fullText += chunk.text;
        }
      },
      onFinish: async ({ text, usage }) => {
        // Fallback to manual accumulation if text is empty
        const validationText = text && text.length > 0 ? text : fullText;

        logger.debug({
          action: '[CACHE_DEBUG]',
          step: 'onFinish',
          providedTextLength: text?.length || 0,
          accumulatedTextLength: fullText.length,
          finalTextLength: validationText.length
        }, 'Cache Debug: Stream Finished');

        // Cache the complete summary after streaming finishes
        // Use 'after' to ensure this background task completes even if the response is closed
        after(async () => {
          logger.debug({
            action: '[CACHE_DEBUG]',
            step: 'after_callback'
          }, 'Cache Debug: Inside after()');

          if (!validationText || validationText.length === 0) {
            logger.debug({
              action: '[CACHE_DEBUG]',
              step: 'abort_cache_empty',
              reason: 'Text is empty'
            }, 'Cache Debug: Aborting cache save (empty text)');
            return;
          }

          logger.info({
            length: validationText.length,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.totalTokens
          }, 'Summary generated with AI');

          // Try to cache, but don't fail if Redis is down
          try {
            logger.debug({
              action: '[CACHE_DEBUG]',
              step: 'redis_set_start',
              cacheKey
            }, 'Cache Debug: Attempting Redis SET');

            // Cache for 30 days (2592000 seconds)
            // Wrap in timeout as well
            await withTimeout(
              redis.set(cacheKey, validationText, { ex: 2592000 }),
              REDIS_TIMEOUT_MS,
              'Redis SET'
            );

            logger.debug({
              action: '[CACHE_DEBUG]',
              step: 'redis_set_success',
              cacheKey,
              contentSnippet: validationText.substring(0, 50) + '...'
            }, 'Cache Debug: Redis SET Success');
            logger.debug('Summary cached successfully');
          } catch (redisError) {
            logger.debug({
              action: '[CACHE_DEBUG]',
              step: 'redis_set_error',
              error: redisError
            }, 'Cache Debug: Redis SET Error');
            // Log the error but don't break the streaming response
            logger.warn({ error: redisError }, 'Failed to cache summary in Redis');
          }
        });
      },
    });

    return result.toTextStreamResponse();
  } catch (error) {
    logger.warn({
      action: '[CACHE_DEBUG]',
      step: 'fatal_api_error',
      error: error
    }, 'Cache Debug: Fatal Error');

    // Distinguish between timeout and other errors
    const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred";
    const isTimeout = errorMessage.includes("timed out");
    const statusCode = isTimeout ? 504 : 500; // 504 Gateway Timeout

    logger.error({ error, isTimeout }, 'Unexpected error / timeout');

    return NextResponse.json(
      { error: isTimeout ? "Request timed out. Please try again." : errorMessage },
      { status: statusCode }
    );
  }
}
