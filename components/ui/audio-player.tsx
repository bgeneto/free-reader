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
const FIRST_CHUNK_MULTIPLIER = 1.4; // First chunk is larger to give time for second to load

/**
 * Split text into chunks intelligently by stop tokens
 * Respects min/max size constraints while preferring natural boundaries
 * First chunk is larger (FIRST_CHUNK_MULTIPLIER) to ensure smooth streaming
 */
function splitTextIntoChunks(text: string): string[] {
    const chunks: string[] = [];
    let remaining = text.trim();
    let isFirstChunk = true;

    while (remaining.length > 0) {
        const maxSize = isFirstChunk
            ? Math.floor(MAX_CHUNK_SIZE * FIRST_CHUNK_MULTIPLIER)
            : MAX_CHUNK_SIZE;
        const minSize = isFirstChunk
            ? Math.floor(MIN_CHUNK_SIZE * FIRST_CHUNK_MULTIPLIER)
            : MIN_CHUNK_SIZE;

        // If remaining text is small enough, use it all
        if (remaining.length <= maxSize) {
            chunks.push(remaining);
            break;
        }

        // Find the best split point within the max size
        let splitIndex = -1;

        // Search for stop tokens from the end of the max range backwards
        for (const token of STOP_TOKENS) {
            // Look for the last occurrence of this token within maxSize
            const searchEnd = Math.min(maxSize, remaining.length);

            // Find last occurrence between min and max
            let searchPos = remaining.lastIndexOf(token, searchEnd);

            if (searchPos >= minSize) {
                splitIndex = searchPos + token.length;
                break; // Use the first (highest priority) token found
            }
        }

        // If no good split point found, force split at max size
        if (splitIndex <= minSize) {
            // Try to at least split at a word boundary
            const spaceIndex = remaining.lastIndexOf(' ', maxSize);
            splitIndex = spaceIndex > minSize ? spaceIndex + 1 : maxSize;
        }

        chunks.push(remaining.substring(0, splitIndex).trim());
        remaining = remaining.substring(splitIndex).trim();
        isFirstChunk = false;
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
    const [loadedDuration, setLoadedDuration] = useState(0);

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const isPlayingRef = useRef(false);
    const chunksRef = useRef<AudioChunk[]>([]); // Keep a ref for real-time access in callbacks

    // Keep chunksRef in sync with chunks state
    useEffect(() => {
        chunksRef.current = chunks;
    }, [chunks]);

    // Format time as mm:ss
    const formatTime = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, "0")}`;
    };

    // Initialize chunks when text changes
    useEffect(() => {
        const textChunks = splitTextIntoChunks(text);
        const initialChunks: AudioChunk[] = textChunks.map((chunkText) => ({
            text: chunkText,
            duration: 0,
            startOffset: 0,
            status: 'pending',
        }));
        setChunks(initialChunks);
        chunksRef.current = initialChunks;
        setCurrentChunkIndex(0);
        setCurrentTime(0);
        setTotalDuration(0);
        setLoadedDuration(0);
        setPlayerState("idle");
    }, [text]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            chunksRef.current.forEach(chunk => {
                if (chunk.blob) {
                    URL.revokeObjectURL(URL.createObjectURL(chunk.blob));
                }
            });
        };
    }, []);

    // Load a specific chunk
    const loadChunk = useCallback(async (index: number): Promise<AudioChunk | null> => {
        const currentChunks = chunksRef.current;
        if (index < 0 || index >= currentChunks.length) return null;

        const chunk = currentChunks[index];
        if (chunk.status === 'ready' || chunk.status === 'loading') {
            return chunk;
        }

        // Update status to loading
        setChunks(prev => {
            const updated = [...prev];
            updated[index] = { ...updated[index], status: 'loading' };
            chunksRef.current = updated;
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
                setTimeout(() => resolve(), 5000);
            });

            const duration = audio.duration || 0;

            // Update chunk with audio data and recalculate offsets
            setChunks(prev => {
                const updated = [...prev];

                // Calculate start offset based on previous chunks' actual durations
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
                        total += c.duration;
                    } else {
                        // Estimate ~15 chars/second for pending chunks
                        total += c.text.length / 15;
                    }
                });
                setTotalDuration(total);
                setLoadedDuration(loaded);

                // Recalculate all startOffsets for consistency
                let offset = 0;
                for (let i = 0; i < updated.length; i++) {
                    updated[i].startOffset = offset;
                    offset += updated[i].duration || (updated[i].text.length / 15);
                }

                chunksRef.current = updated;
                return updated;
            });

            return { ...chunk, blob, audio, duration, startOffset: 0, status: 'ready' as const };
        } catch (error) {
            setChunks(prev => {
                const updated = [...prev];
                updated[index] = { ...updated[index], status: 'error' };
                chunksRef.current = updated;
                return updated;
            });
            throw error;
        }
    }, [voice]);

    // Play a specific chunk
    const playChunk = useCallback(async (index: number, startPosition = 0) => {
        const currentChunks = chunksRef.current;

        if (index >= currentChunks.length) {
            // All chunks played - reset to beginning
            setPlayerState("paused");
            setCurrentChunkIndex(0);
            // Calculate total played duration
            let totalPlayed = 0;
            for (const c of chunksRef.current) {
                totalPlayed += c.duration;
            }
            setCurrentTime(totalPlayed);
            isPlayingRef.current = false;
            return;
        }

        let chunk = currentChunks[index];

        // Load chunk if needed
        if (chunk.status !== 'ready') {
            setPlayerState("loading");
            try {
                const loadedChunk = await loadChunk(index);
                if (!loadedChunk || loadedChunk.status !== 'ready') {
                    throw new Error('Failed to load chunk');
                }
                // Get updated chunk from ref after loading
                chunk = chunksRef.current[index];
            } catch (error) {
                setPlayerState("error");
                setErrorMessage(error instanceof Error ? error.message : "Failed to load audio");
                return;
            }
        }

        const audio = chunk.audio;
        if (!audio) {
            setPlayerState("error");
            setErrorMessage("Audio not available");
            return;
        }

        // Stop current audio if playing different chunk
        if (audioRef.current && audioRef.current !== audio) {
            audioRef.current.pause();
            audioRef.current.ontimeupdate = null;
            audioRef.current.onended = null;
        }

        audioRef.current = audio;
        audio.volume = isMuted ? 0 : volume;
        audio.currentTime = startPosition;

        // Set up event listeners - use chunksRef for real-time access
        audio.ontimeupdate = () => {
            const chunkTime = audio.currentTime;
            // Get the startOffset of current chunk from ref (most up-to-date)
            const currentChunk = chunksRef.current[index];
            const startOffset = currentChunk?.startOffset || 0;
            setCurrentTime(startOffset + chunkTime);
        };

        audio.onended = () => {
            if (isPlayingRef.current) {
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

            // Prefetch next chunk while playing (if not already loaded/loading)
            const nextChunk = chunksRef.current[index + 1];
            if (nextChunk && nextChunk.status === 'pending') {
                loadChunk(index + 1).catch(() => { });
            }
        } catch (error) {
            setPlayerState("error");
            setErrorMessage(error instanceof Error ? error.message : "Failed to play audio");
        }
    }, [isMuted, volume, loadChunk]);

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
        if (totalDuration === 0) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percentage = x / rect.width;

        // Calculate target time based on TOTAL duration
        const targetTime = percentage * totalDuration;

        // Find which chunk contains this time
        let accumulatedTime = 0;
        let targetChunkIndex = 0;
        let positionInChunk = 0;

        const currentChunks = chunksRef.current;
        for (let i = 0; i < currentChunks.length; i++) {
            const chunk = currentChunks[i];
            const chunkDuration = chunk.duration || (chunk.text.length / 15);

            if (accumulatedTime + chunkDuration > targetTime) {
                targetChunkIndex = i;
                positionInChunk = targetTime - accumulatedTime;

                // If seeking to unloaded chunk, clamp to loaded area
                if (chunk.status !== 'ready') {
                    // Find the last loaded chunk
                    for (let j = i - 1; j >= 0; j--) {
                        if (currentChunks[j].status === 'ready') {
                            targetChunkIndex = j;
                            positionInChunk = currentChunks[j].duration; // Seek to end of last loaded
                            break;
                        }
                    }
                }
                break;
            }
            accumulatedTime += chunkDuration;
        }

        const targetChunk = currentChunks[targetChunkIndex];
        if (!targetChunk || targetChunk.status !== 'ready') {
            return; // Can't seek to unloaded chunk
        }

        // Clamp position within chunk duration
        positionInChunk = Math.max(0, Math.min(positionInChunk, targetChunk.duration));

        // If we're on a different chunk, switch to it
        if (targetChunkIndex !== currentChunkIndex) {
            setCurrentChunkIndex(targetChunkIndex);
            if (playerState === "playing") {
                playChunk(targetChunkIndex, positionInChunk);
            } else if (targetChunk.audio) {
                // Just set up the audio at the right position
                if (audioRef.current && audioRef.current !== targetChunk.audio) {
                    audioRef.current.pause();
                }
                audioRef.current = targetChunk.audio;
                targetChunk.audio.currentTime = positionInChunk;
                setCurrentTime(targetChunk.startOffset + positionInChunk);
            }
        } else {
            // Same chunk, just seek within it
            if (audioRef.current) {
                audioRef.current.currentTime = positionInChunk;
                setCurrentTime(targetChunk.startOffset + positionInChunk);
            }
        }
    }, [totalDuration, currentChunkIndex, playerState, playChunk]);

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
        setChunks(prev => {
            const updated = prev.map(chunk =>
                chunk.status === 'error' ? { ...chunk, status: 'pending' as const } : chunk
            );
            chunksRef.current = updated;
            return updated;
        });

        handlePlay();
    }, [handlePlay]);

    // Calculate progress percentages
    const progress = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0;
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
                        style={{ width: `${Math.min(progress, 100)}%` }}
                    />
                    {/* Loading indicator - subtle pulse when loading */}
                    {playerState === "loading" && (
                        <div
                            className="absolute top-0 h-full w-8 bg-gradient-to-r from-transparent via-accent/50 to-transparent animate-pulse"
                            style={{ left: `${Math.min(loadedProgress, 92)}%` }}
                        />
                    )}
                </div>
            </div>

            {/* Time Display */}
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums min-w-[72px] text-right">
                {formatTime(currentTime)} / {formatTime(totalDuration)}
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
