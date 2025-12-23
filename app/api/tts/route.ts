import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { redis } from "@/lib/redis";

const logger = createLogger('api:tts');

// Default TTS model - supports OpenAI-compatible TTS endpoints
const DEFAULT_TTS_MODEL = "tts-1";
const DEFAULT_VOICE = "alloy";

// Cache TTL: 7 days (audio doesn't change for same input)
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

// Request validation
interface TTSRequest {
    text: string;
    voice?: string;
}

/**
 * Create a simple hash from text for cache key
 * Uses first 100 chars + length + simple checksum for uniqueness
 */
function createTextHash(text: string): string {
    // Simple hash: use text length + first/last chars + checksum
    const len = text.length;
    const prefix = text.substring(0, 50).replace(/[^a-zA-Z0-9]/g, '');
    const suffix = text.substring(Math.max(0, len - 20)).replace(/[^a-zA-Z0-9]/g, '');

    // Simple checksum
    let sum = 0;
    for (let i = 0; i < text.length; i += 10) {
        sum += text.charCodeAt(i);
    }

    return `${prefix}_${suffix}_${len}_${sum}`;
}

/**
 * POST /api/tts
 * Generate text-to-speech audio from text
 * Returns audio in mp3 format (with Redis caching)
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json() as TTSRequest;
        const { text, voice: requestVoice } = body;

        if (!text || text.trim().length === 0) {
            return NextResponse.json(
                { error: "Text is required" },
                { status: 400 }
            );
        }

        // Limit text length to prevent abuse (approx 5 minutes of speech)
        const maxLength = 4096;
        const truncatedText = text.length > maxLength ? text.substring(0, maxLength) : text;

        // Get TTS configuration
        const ttsModel = process.env.TTS_MODEL || DEFAULT_TTS_MODEL;
        const voice = requestVoice || process.env.TTS_VOICE || DEFAULT_VOICE;

        // Create cache key based on text content, voice, and model
        const textHash = createTextHash(truncatedText);
        const cacheKey = `tts:${ttsModel}:${voice}:${textHash}`;

        // Check cache first
        try {
            const cached = await redis.get<string>(cacheKey);
            if (cached) {
                logger.info({ cacheKey }, 'TTS cache hit');
                // Convert base64 back to binary
                const audioBuffer = Buffer.from(cached, 'base64');
                return new Response(audioBuffer, {
                    headers: {
                        "Content-Type": "audio/mpeg",
                        "Content-Length": audioBuffer.length.toString(),
                        "X-Cache-Hit": "true",
                    },
                });
            }
        } catch (cacheError) {
            logger.warn({ error: cacheError }, 'Redis cache check failed, proceeding with TTS generation');
        }

        logger.info({
            textLength: truncatedText.length,
            voice,
            model: ttsModel,
        }, 'TTS Request - cache miss');

        // Determine the base URL - use the configured OpenAI-compatible endpoint
        const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
        const apiKey = process.env.OPENAI_API_KEY;

        if (!apiKey) {
            logger.error('OPENAI_API_KEY is required for TTS');
            return NextResponse.json(
                { error: "TTS is not configured. Please set OPENAI_API_KEY." },
                { status: 503 }
            );
        }

        // Call OpenAI TTS API
        const response = await fetch(`${baseUrl}/audio/speech`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: ttsModel.replace("openai/", ""), // Remove provider prefix if present
                input: truncatedText,
                voice: voice,
                response_format: "mp3",
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            logger.error({ status: response.status, error: errorText }, 'TTS API error');
            return NextResponse.json(
                { error: `TTS generation failed: ${response.status}` },
                { status: response.status }
            );
        }

        // Get the audio as ArrayBuffer for caching
        const audioBuffer = await response.arrayBuffer();
        const audioData = Buffer.from(audioBuffer);

        logger.info({ audioSize: audioData.length }, 'TTS audio generated');

        // Cache the audio as base64 (Redis stores strings efficiently)
        try {
            const base64Audio = audioData.toString('base64');
            await redis.set(cacheKey, base64Audio, { ex: CACHE_TTL_SECONDS });
            logger.debug({ cacheKey }, 'TTS audio cached');
        } catch (cacheError) {
            logger.warn({ error: cacheError }, 'Failed to cache TTS audio');
        }

        // Return the audio response
        return new Response(audioData, {
            headers: {
                "Content-Type": "audio/mpeg",
                "Content-Length": audioData.length.toString(),
            },
        });
    } catch (error) {
        logger.error({ error }, 'TTS error');
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "An unexpected error occurred" },
            { status: 500 }
        );
    }
}
