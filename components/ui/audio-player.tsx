"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Play, Pause, Volume2, VolumeX, RotateCcw, Loader2 } from "lucide-react";

interface AudioPlayerProps {
    /** Text to convert to speech */
    text: string;
    /** Optional voice override */
    voice?: string;
    /** Additional className for the container */
    className?: string;
    /** Compact mode - just play button */
    compact?: boolean;
}

type PlayerState = "idle" | "loading" | "playing" | "paused" | "error";

interface AudioChunk {
    text: string;
    blob?: Blob;
    audio?: HTMLAudioElement;
    duration: number;
    startOffset: number; // cumulative offset in total timeline
    status: 'pending' | 'loading' | 'ready' | 'error';
}

// Stop tokens for intelligent text splitting (in priority order)
const STOP_TOKENS = ['\n\n', '\n', '. ', '! ', '? ', '; ', ', '];
const MIN_CHUNK_SIZE = 150;
const MAX_CHUNK_SIZE = 400;

/**
 * Split text into chunks intelligently by stop tokens
 * Respects min/max size constraints while preferring natural boundaries
 */
function splitTextIntoChunks(text: string): string[] {
    const chunks: string[] = [];
    let remaining = text.trim();

    while (remaining.length > 0) {
        // If remaining text is small enough, use it all
        if (remaining.length <= MAX_CHUNK_SIZE) {
            chunks.push(remaining);
            break;
        }

        // Find the best split point within the max size
        let splitIndex = -1;

        // Search for stop tokens from the end of the max range backwards
        for (const token of STOP_TOKENS) {
            // Look for the last occurrence of this token within MAX_CHUNK_SIZE
            const searchEnd = Math.min(MAX_CHUNK_SIZE, remaining.length);
            const searchStart = MIN_CHUNK_SIZE;

            // Find last occurrence between MIN and MAX
            let lastIndex = -1;
            let searchPos = remaining.lastIndexOf(token, searchEnd);

            if (searchPos >= searchStart) {
                lastIndex = searchPos + token.length;
            }

            if (lastIndex > splitIndex) {
                splitIndex = lastIndex;
                break; // Use the first (highest priority) token found
            }
        }

        // If no good split point found, force split at max size
        if (splitIndex <= MIN_CHUNK_SIZE) {
            // Try to at least split at a word boundary
            const spaceIndex = remaining.lastIndexOf(' ', MAX_CHUNK_SIZE);
            splitIndex = spaceIndex > MIN_CHUNK_SIZE ? spaceIndex + 1 : MAX_CHUNK_SIZE;
        }

        chunks.push(remaining.substring(0, splitIndex).trim());
        remaining = remaining.substring(splitIndex).trim();
    }

    return chunks.filter(chunk => chunk.length > 0);
}

export function AudioPlayer({
    text,
    voice,
    className,
    compact = false,
}: AudioPlayerProps) {
    const [playerState, setPlayerState] = useState<PlayerState>("idle");
    const [currentTime, setCurrentTime] = useState(0);
    const [totalDuration, setTotalDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [chunks, setChunks] = useState<AudioChunk[]>([]);
    const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
    const [loadedDuration, setLoadedDuration] = useState(0); // For visual loading indicator

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const isPlayingRef = useRef(false);

    // Format time as mm:ss
    const formatTime = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, "0")}`;
    };

    // Initialize chunks when text changes
    useEffect(() => {
        const textChunks = splitTextIntoChunks(text);
        const initialChunks: AudioChunk[] = textChunks.map((chunkText, index) => ({
            text: chunkText,
            duration: 0,
            startOffset: 0,
            status: 'pending',
        }));
        setChunks(initialChunks);
        setCurrentChunkIndex(0);
        setCurrentTime(0);
        setTotalDuration(0);
        setLoadedDuration(0);
        setPlayerState("idle");
    }, [text]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            chunks.forEach(chunk => {
                if (chunk.blob) {
                    URL.revokeObjectURL(URL.createObjectURL(chunk.blob));
                }
            });
        };
    }, []);

    // Load a specific chunk
    const loadChunk = useCallback(async (index: number): Promise<AudioChunk | null> => {
        if (index < 0 || index >= chunks.length) return null;

        const chunk = chunks[index];
        if (chunk.status === 'ready' || chunk.status === 'loading') {
            return chunk;
        }

        // Update status to loading
        setChunks(prev => {
            const updated = [...prev];
            updated[index] = { ...updated[index], status: 'loading' };
            return updated;
        });

        try {
            const response = await fetch("/api/tts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: chunk.text, voice }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `TTS failed: ${response.status}`);
            }

            const blob = await response.blob();
            const audio = new Audio(URL.createObjectURL(blob));

            // Wait for metadata to get duration
            await new Promise<void>((resolve, reject) => {
                audio.onloadedmetadata = () => resolve();
                audio.onerror = () => reject(new Error('Failed to load audio'));
                // Fallback timeout
                setTimeout(() => resolve(), 5000);
            });

            const duration = audio.duration || 0;

            // Update chunk with audio data
            setChunks(prev => {
                const updated = [...prev];

                // Calculate start offset based on previous chunks
                let startOffset = 0;
                for (let i = 0; i < index; i++) {
                    startOffset += updated[i].duration;
                }

                updated[index] = {
                    ...updated[index],
                    blob,
                    audio,
                    duration,
                    startOffset,
                    status: 'ready',
                };

                // Recalculate total duration and loaded duration
                let total = 0;
                let loaded = 0;
                updated.forEach(c => {
                    if (c.status === 'ready') {
                        loaded += c.duration;
                    }
                    total += c.duration || (c.text.length / 15); // Estimate ~15 chars/second
                });
                setTotalDuration(total);
                setLoadedDuration(loaded);

                return updated;
            });

            return { ...chunk, blob, audio, duration, status: 'ready' as const };
        } catch (error) {
            setChunks(prev => {
                const updated = [...prev];
                updated[index] = { ...updated[index], status: 'error' };
                return updated;
            });
            throw error;
        }
    }, [chunks, voice]);

    // Play a specific chunk
    const playChunk = useCallback(async (index: number, startPosition = 0) => {
        if (index >= chunks.length) {
            // All chunks played
            setPlayerState("paused");
            setCurrentChunkIndex(0);
            setCurrentTime(0);
            isPlayingRef.current = false;
            return;
        }

        let chunk = chunks[index];

        // Load chunk if needed
        if (chunk.status !== 'ready') {
            setPlayerState("loading");
            try {
                const loadedChunk = await loadChunk(index);
                if (!loadedChunk || loadedChunk.status !== 'ready') {
                    throw new Error('Failed to load chunk');
                }
                chunk = loadedChunk;
            } catch (error) {
                setPlayerState("error");
                setErrorMessage(error instanceof Error ? error.message : "Failed to load audio");
                return;
            }
        }

        // Get the latest chunk data from state
        const currentChunks = chunks;
        const latestChunk = currentChunks[index];
        if (!latestChunk?.audio) {
            // Chunk might have been updated, try to get it from loadChunk result
            if (!chunk.audio) {
                setPlayerState("error");
                setErrorMessage("Audio not available");
                return;
            }
        }

        const audio = latestChunk?.audio || chunk.audio!;

        // Stop current audio if playing
        if (audioRef.current && audioRef.current !== audio) {
            audioRef.current.pause();
        }

        audioRef.current = audio;
        audio.volume = isMuted ? 0 : volume;
        audio.currentTime = startPosition;

        // Set up event listeners
        audio.ontimeupdate = () => {
            const chunkTime = audio.currentTime;
            // Calculate total time across all chunks
            let totalTime = 0;
            for (let i = 0; i < index; i++) {
                totalTime += currentChunks[i]?.duration || 0;
            }
            totalTime += chunkTime;
            setCurrentTime(totalTime);
        };

        audio.onended = () => {
            if (isPlayingRef.current) {
                // Prefetch next chunk started earlier, now play it
                setCurrentChunkIndex(index + 1);
                playChunk(index + 1, 0);
            }
        };

        audio.onerror = () => {
            setPlayerState("error");
            setErrorMessage("Audio playback failed");
        };

        try {
            setCurrentChunkIndex(index);
            setPlayerState("playing");
            isPlayingRef.current = true;
            await audio.play();

            // Prefetch next chunk while playing
            if (index + 1 < chunks.length && chunks[index + 1]?.status === 'pending') {
                loadChunk(index + 1).catch(() => { });
            }
        } catch (error) {
            setPlayerState("error");
            setErrorMessage(error instanceof Error ? error.message : "Failed to play audio");
        }
    }, [chunks, isMuted, volume, loadChunk]);

    // Handle play button click
    const handlePlay = useCallback(async () => {
        // If we're paused on a chunk, resume it
        if (playerState === "paused" && audioRef.current) {
            try {
                isPlayingRef.current = true;
                setPlayerState("playing");
                await audioRef.current.play();
                return;
            } catch {
                // Fall through to start from current chunk
            }
        }

        // Start playing from current chunk
        await playChunk(currentChunkIndex, audioRef.current?.currentTime || 0);
    }, [playerState, currentChunkIndex, playChunk]);

    // Handle pause
    const handlePause = useCallback(() => {
        if (audioRef.current) {
            audioRef.current.pause();
        }
        isPlayingRef.current = false;
        setPlayerState("paused");
    }, []);

    // Toggle play/pause
    const togglePlayPause = useCallback(() => {
        if (playerState === "playing") {
            handlePause();
        } else {
            handlePlay();
        }
    }, [playerState, handlePause, handlePlay]);

    // Handle seek (only within loaded chunks)
    const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (loadedDuration === 0) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percentage = x / rect.width;

        // Calculate target time based on loaded duration (not total)
        const targetTime = percentage * loadedDuration;

        // Find which chunk contains this time
        let accumulatedTime = 0;
        let targetChunkIndex = 0;
        let positionInChunk = 0;

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            if (chunk.status !== 'ready') break; // Can't seek past loaded chunks

            if (accumulatedTime + chunk.duration > targetTime) {
                targetChunkIndex = i;
                positionInChunk = targetTime - accumulatedTime;
                break;
            }
            accumulatedTime += chunk.duration;
        }

        // If we're on a different chunk, switch to it
        if (targetChunkIndex !== currentChunkIndex) {
            setCurrentChunkIndex(targetChunkIndex);
            if (playerState === "playing") {
                playChunk(targetChunkIndex, positionInChunk);
            } else {
                // Just set up the audio at the right position
                const chunk = chunks[targetChunkIndex];
                if (chunk?.audio) {
                    if (audioRef.current && audioRef.current !== chunk.audio) {
                        audioRef.current.pause();
                    }
                    audioRef.current = chunk.audio;
                    chunk.audio.currentTime = positionInChunk;
                    setCurrentTime(targetTime);
                }
            }
        } else {
            // Same chunk, just seek within it
            if (audioRef.current) {
                audioRef.current.currentTime = positionInChunk;
                setCurrentTime(targetTime);
            }
        }
    }, [chunks, currentChunkIndex, loadedDuration, playerState, playChunk]);

    // Toggle mute
    const toggleMute = useCallback(() => {
        if (audioRef.current) {
            audioRef.current.volume = isMuted ? volume : 0;
        }
        setIsMuted(!isMuted);
    }, [isMuted, volume]);

    // Retry on error
    const handleRetry = useCallback(() => {
        setPlayerState("idle");
        setErrorMessage(null);

        // Reset failed chunks to pending
        setChunks(prev => prev.map(chunk =>
            chunk.status === 'error' ? { ...chunk, status: 'pending' as const } : chunk
        ));

        handlePlay();
    }, [handlePlay]);

    // Calculate progress percentages
    const progress = loadedDuration > 0 ? (currentTime / loadedDuration) * 100 : 0;
    const loadedProgress = totalDuration > 0 ? (loadedDuration / totalDuration) * 100 : 0;

    // Compact mode - just a play button with loading indicator
    if (compact) {
        return (
            <Button
                variant="ghost"
                size="icon-sm"
                onClick={togglePlayPause}
                disabled={playerState === "loading"}
                className={cn("transition-all relative", className)}
                aria-label={playerState === "playing" ? "Pause" : "Play"}
            >
                {playerState === "loading" ? (
                    <Loader2 className="size-4 animate-spin" />
                ) : playerState === "playing" ? (
                    <Pause className="size-4" />
                ) : playerState === "error" ? (
                    <RotateCcw className="size-4 text-destructive" onClick={handleRetry} />
                ) : (
                    <Play className="size-4" />
                )}
            </Button>
        );
    }

    // Full player mode
    return (
        <div className={cn("flex items-center gap-3", className)}>
            {/* Play/Pause Button */}
            <Button
                variant="ghost"
                size="icon-sm"
                onClick={togglePlayPause}
                disabled={playerState === "loading" && currentChunkIndex === 0}
                className="shrink-0"
                aria-label={playerState === "playing" ? "Pause" : "Play"}
            >
                {playerState === "loading" && currentChunkIndex === 0 ? (
                    <Loader2 className="size-4 animate-spin" />
                ) : playerState === "playing" ? (
                    <Pause className="size-4" />
                ) : (
                    <Play className="size-4" />
                )}
            </Button>

            {/* Progress Bar with Loading Indicator */}
            <div
                className="flex-1 cursor-pointer"
                onClick={handleSeek}
                role="slider"
                aria-label="Audio progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
                tabIndex={0}
            >
                <div className="relative h-1.5 rounded-full bg-muted/30 overflow-hidden">
                    {/* Loaded chunks indicator (lighter) */}
                    <div
                        className="absolute left-0 top-0 h-full rounded-full bg-accent/30 transition-all duration-300"
                        style={{ width: `${loadedProgress}%` }}
                    />
                    {/* Playback progress (solid) */}
                    <div
                        className="absolute left-0 top-0 h-full rounded-full bg-accent transition-all duration-100"
                        style={{ width: `${Math.min(progress, loadedProgress)}%` }}
                    />
                    {/* Loading indicator - subtle pulse when loading */}
                    {playerState === "loading" && (
                        <div
                            className="absolute top-0 h-full w-8 bg-gradient-to-r from-transparent via-accent/50 to-transparent animate-pulse"
                            style={{ left: `${loadedProgress}%` }}
                        />
                    )}
                </div>
            </div>

            {/* Time Display */}
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums min-w-[72px] text-right">
                {formatTime(currentTime)} / {formatTime(loadedDuration || totalDuration)}
            </span>

            {/* Volume Toggle */}
            <Button
                variant="ghost"
                size="icon-sm"
                onClick={toggleMute}
                className="shrink-0"
                aria-label={isMuted ? "Unmute" : "Mute"}
            >
                {isMuted ? (
                    <VolumeX className="size-4" />
                ) : (
                    <Volume2 className="size-4" />
                )}
            </Button>

            {/* Error State */}
            {playerState === "error" && (
                <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={handleRetry}
                    className="shrink-0 text-destructive"
                    aria-label="Retry"
                >
                    <RotateCcw className="size-4" />
                </Button>
            )}
        </div>
    );
}
