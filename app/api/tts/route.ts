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
 * Returns audio in mp3 format (no caching - handled by client chunking)
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

        // Limit text length to prevent abuse (single chunk should be small)
        const maxLength = 1024;
        const truncatedText = text.length > maxLength ? text.substring(0, maxLength) : text;

        // Get TTS configuration
        const ttsModel = process.env.TTS_MODEL || DEFAULT_TTS_MODEL;
        const voice = requestVoice || process.env.TTS_VOICE || DEFAULT_VOICE;

        logger.info({
            textLength: truncatedText.length,
            voice,
            model: ttsModel,
        }, 'TTS Request');

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

        // Get the audio as ArrayBuffer
        const audioBuffer = await response.arrayBuffer();
        const audioData = Buffer.from(audioBuffer);

        logger.info({ audioSize: audioData.length }, 'TTS audio generated');

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
