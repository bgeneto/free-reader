import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const logger = createLogger('api:tts');

// Default TTS model - supports OpenAI-compatible TTS endpoints
const DEFAULT_TTS_MODEL = "tts-1";
const DEFAULT_VOICE = "alloy";

// Request validation
interface TTSRequest {
    text: string;
    voice?: string;
}

/**
 * POST /api/tts
 * Generate text-to-speech audio from text
 * Returns streaming audio in mp3 format
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

        logger.info({
            textLength: truncatedText.length,
            voice: requestVoice || process.env.TTS_VOICE || DEFAULT_VOICE,
        }, 'TTS Request');

        // Get TTS configuration
        const ttsModel = process.env.TTS_MODEL || DEFAULT_TTS_MODEL;
        const voice = requestVoice || process.env.TTS_VOICE || DEFAULT_VOICE;

        // Determine the base URL - use OpenAI directly for TTS
        // OpenRouter doesn't support TTS, so we need to use OpenAI's endpoint
        const baseUrl = process.env.TTS_BASE_URL || "https://api.openai.com/v1";
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

        // Stream the audio response
        const audioStream = response.body;
        if (!audioStream) {
            return NextResponse.json(
                { error: "No audio stream received" },
                { status: 500 }
            );
        }

        logger.info('TTS audio streaming started');

        // Return streaming response with proper audio headers
        return new Response(audioStream, {
            headers: {
                "Content-Type": "audio/mpeg",
                "Transfer-Encoding": "chunked",
                "Cache-Control": "no-cache",
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
