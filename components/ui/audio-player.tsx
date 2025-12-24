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
    startOffset: number;
    status: 'pending' | 'loading' | 'ready' | 'error';
}

// Stop tokens for intelligent text splitting (in priority order)
const STOP_TOKENS = ['\n\n', '\n', '. ', '! ', '? ', '; ', ': ', ', '];
const MIN_CHUNK_SIZE = 150;
const MAX_CHUNK_SIZE = 400;
const FIRST_CHUNK_MULTIPLIER = 1.4;

/**
 * Split text into chunks intelligently by stop tokens
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

        if (remaining.length <= maxSize) {
            chunks.push(remaining);
            break;
        }

        let splitIndex = -1;

        for (const token of STOP_TOKENS) {
            const searchEnd = Math.min(maxSize, remaining.length);
            const searchPos = remaining.lastIndexOf(token, searchEnd);

            if (searchPos >= minSize) {
                splitIndex = searchPos + token.length;
                break;
            }
        }

        if (splitIndex <= minSize) {
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
    const [playbackSpeed, setPlaybackSpeed] = useState(1);

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const isPlayingRef = useRef(false);
    const chunksRef = useRef<AudioChunk[]>([]);
    const loadingPromises = useRef<Map<number, Promise<AudioChunk | null>>>(new Map());
    const playbackSpeedRef = useRef(1);

    useEffect(() => {
        chunksRef.current = chunks;
    }, [chunks]);

    // Keep speed ref in sync with state
    useEffect(() => {
        playbackSpeedRef.current = playbackSpeed;
    }, [playbackSpeed]);

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
        loadingPromises.current.clear();
        setCurrentChunkIndex(0);
        setCurrentTime(0);
        setTotalDuration(0);
        setLoadedDuration(0);
        setPlayerState("idle");
    }, [text]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            chunksRef.current.forEach((chunk: AudioChunk) => {
                if (chunk.blob) {
                    URL.revokeObjectURL(URL.createObjectURL(chunk.blob));
                }
            });
        };
    }, []);

    // Update durations and offsets in state
    const updateChunkMetrics = useCallback((updatedChunks: AudioChunk[]) => {
        let total = 0;
        let loaded = 0;
        let offset = 0;

        for (let i = 0; i < updatedChunks.length; i++) {
            updatedChunks[i].startOffset = offset;
            if (updatedChunks[i].status === 'ready') {
                loaded += updatedChunks[i].duration;
                total += updatedChunks[i].duration;
                offset += updatedChunks[i].duration;
            } else {
                const estimated = updatedChunks[i].text.length / 15;
                total += estimated;
                offset += estimated;
            }
        }

        setTotalDuration(total);
        setLoadedDuration(loaded);
    }, []);

    // Load a specific chunk - returns the loaded chunk with audio
    const loadChunk = useCallback(async (index: number): Promise<AudioChunk | null> => {
        const currentChunks = chunksRef.current;
        if (index < 0 || index >= currentChunks.length) return null;

        const chunk = currentChunks[index];

        // If already ready, return the chunk from ref (it has the audio)
        if (chunk.status === 'ready') {
            return chunksRef.current[index];
        }

        // If already loading, wait for the existing promise
        if (chunk.status === 'loading') {
            const existingPromise = loadingPromises.current.get(index);
            if (existingPromise) {
                return existingPromise;
            }
        }

        // Start loading
        const loadPromise = (async (): Promise<AudioChunk | null> => {
            // Update status to loading
            setChunks((prev: AudioChunk[]) => {
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
                const audioUrl = URL.createObjectURL(blob);
                const audio = new Audio(audioUrl);

                // Wait for metadata to get duration
                await new Promise<void>((resolve, reject) => {
                    audio.onloadedmetadata = () => resolve();
                    audio.onerror = () => reject(new Error('Failed to load audio'));
                    setTimeout(() => resolve(), 5000);
                });

                const duration = audio.duration || 0;

                // Create the updated chunk object
                const updatedChunk: AudioChunk = {
                    text: chunk.text,
                    blob,
                    audio,
                    duration,
                    startOffset: 0, // Will be calculated
                    status: 'ready',
                };

                // Update state with the loaded chunk
                setChunks((prev: AudioChunk[]) => {
                    const updated = [...prev];
                    updated[index] = updatedChunk;

                    // Calculate startOffset based on previous chunks
                    let startOffset = 0;
                    for (let i = 0; i < index; i++) {
                        startOffset += updated[i].duration || (updated[i].text.length / 15);
                    }
                    updated[index].startOffset = startOffset;

                    updateChunkMetrics(updated);
                    chunksRef.current = updated;
                    return updated;
                });

                // Return the chunk with correct startOffset
                updatedChunk.startOffset = chunksRef.current[index]?.startOffset || 0;
                return updatedChunk;

            } catch (error) {
                setChunks((prev: AudioChunk[]) => {
                    const updated = [...prev];
                    updated[index] = { ...updated[index], status: 'error' };
                    chunksRef.current = updated;
                    return updated;
                });
                loadingPromises.current.delete(index);
                throw error;
            }
        })();

        loadingPromises.current.set(index, loadPromise);

        try {
            const result = await loadPromise;
            loadingPromises.current.delete(index);
            return result;
        } catch (error) {
            loadingPromises.current.delete(index);
            throw error;
        }
    }, [voice, updateChunkMetrics]);

    // Play a specific chunk
    const playChunk = useCallback(async (index: number, startPosition = 0) => {
        const currentChunks = chunksRef.current;

        if (index >= currentChunks.length) {
            // All chunks played - reset to beginning
            setPlayerState("paused");
            setCurrentChunkIndex(0);
            let totalPlayed = 0;
            for (const c of chunksRef.current) {
                totalPlayed += c.duration;
            }
            setCurrentTime(totalPlayed);
            isPlayingRef.current = false;
            return;
        }

        let chunk = currentChunks[index];
        let audio = chunk.audio;

        // Load chunk if needed
        if (chunk.status !== 'ready' || !audio) {
            setPlayerState("loading");
            try {
                const loadedChunk = await loadChunk(index);
                if (!loadedChunk || loadedChunk.status !== 'ready' || !loadedChunk.audio) {
                    throw new Error('Failed to load chunk');
                }
                chunk = loadedChunk;
                audio = loadedChunk.audio;
            } catch (error) {
                setPlayerState("error");
                setErrorMessage(error instanceof Error ? error.message : "Failed to load audio");
                return;
            }
        }

        // Stop current audio if playing different chunk
        if (audioRef.current && audioRef.current !== audio) {
            audioRef.current.pause();
            audioRef.current.ontimeupdate = null;
            audioRef.current.onended = null;
        }

        audioRef.current = audio;
        audio.volume = isMuted ? 0 : volume;
        // Use ref for speed to always get current value (not stale closure)
        audio.playbackRate = playbackSpeedRef.current;
        audio.currentTime = startPosition;

        // Capture values for callbacks
        const chunkIndex = index;
        const chunkStartOffset = chunk.startOffset;

        // Set up event listeners
        audio.ontimeupdate = () => {
            const chunkTime = audio!.currentTime;
            setCurrentTime(chunkStartOffset + chunkTime);
        };

        audio.onended = () => {
            if (isPlayingRef.current) {
                setCurrentChunkIndex(chunkIndex + 1);
                playChunk(chunkIndex + 1, 0);
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
            const nextChunk = chunksRef.current[index + 1];
            if (nextChunk && nextChunk.status === 'pending') {
                loadChunk(index + 1).catch(() => { });
            }
        } catch (error) {
            console.error('Play error:', error);
            setPlayerState("error");
            setErrorMessage(error instanceof Error ? error.message : "Failed to play audio");
        }
    }, [isMuted, volume, playbackSpeed, loadChunk]);

    // Handle play button click - always use playChunk to ensure listeners are set up
    const handlePlay = useCallback(async () => {
        // Get the current position within the chunk (if any)
        const currentPosition = audioRef.current?.currentTime || 0;
        // Always go through playChunk to ensure onended listener is properly set
        await playChunk(currentChunkIndex, currentPosition);
    }, [currentChunkIndex, playChunk]);

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
        const targetTime = percentage * totalDuration;

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
                    for (let j = i - 1; j >= 0; j--) {
                        if (currentChunks[j].status === 'ready') {
                            targetChunkIndex = j;
                            positionInChunk = currentChunks[j].duration;
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
            return;
        }

        positionInChunk = Math.max(0, Math.min(positionInChunk, targetChunk.duration));

        if (targetChunkIndex !== currentChunkIndex) {
            setCurrentChunkIndex(targetChunkIndex);
            if (playerState === "playing") {
                playChunk(targetChunkIndex, positionInChunk);
            } else if (targetChunk.audio) {
                if (audioRef.current && audioRef.current !== targetChunk.audio) {
                    audioRef.current.pause();
                }
                audioRef.current = targetChunk.audio;
                targetChunk.audio.currentTime = positionInChunk;
                setCurrentTime(targetChunk.startOffset + positionInChunk);
            }
        } else {
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

    // Cycle playback speed: 1 -> 1.5 -> 2 -> 1
    const cycleSpeed = useCallback(() => {
        const speeds = [1, 1.5, 2];
        const currentIndex = speeds.indexOf(playbackSpeed);
        const nextIndex = (currentIndex + 1) % speeds.length;
        const newSpeed = speeds[nextIndex];
        setPlaybackSpeed(newSpeed);
        if (audioRef.current) {
            audioRef.current.playbackRate = newSpeed;
        }
    }, [playbackSpeed]);

    // Retry on error
    const handleRetry = useCallback(() => {
        setPlayerState("idle");
        setErrorMessage(null);

        setChunks((prev: AudioChunk[]) => {
            const updated = prev.map((chunk: AudioChunk) =>
                chunk.status === 'error' ? { ...chunk, status: 'pending' as const } : chunk
            );
            chunksRef.current = updated;
            return updated;
        });

        handlePlay();
    }, [handlePlay]);

    const progress = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0;
    const loadedProgress = totalDuration > 0 ? (loadedDuration / totalDuration) * 100 : 0;

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

    return (
        <div className={cn("flex items-center gap-3", className)}>
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
                    <div
                        className="absolute left-0 top-0 h-full rounded-full bg-accent/30 transition-all duration-300"
                        style={{ width: `${loadedProgress}%` }}
                    />
                    <div
                        className="absolute left-0 top-0 h-full rounded-full bg-accent transition-all duration-100"
                        style={{ width: `${Math.min(progress, 100)}%` }}
                    />
                    {playerState === "loading" && (
                        <div
                            className="absolute top-0 h-full w-8 bg-gradient-to-r from-transparent via-accent/50 to-transparent animate-pulse"
                            style={{ left: `${Math.min(loadedProgress, 92)}%` }}
                        />
                    )}
                </div>
            </div>

            <span className="shrink-0 text-xs text-muted-foreground tabular-nums min-w-[72px] text-right">
                {formatTime(currentTime)} / {formatTime(totalDuration)}
            </span>

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

            {/* Playback Speed Button */}
            <Button
                variant="ghost"
                size="icon-sm"
                onClick={cycleSpeed}
                className="shrink-0 text-xs font-medium tabular-nums min-w-[32px]"
                aria-label={`Playback speed: ${playbackSpeed}x`}
            >
                {playbackSpeed}x
            </Button>

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
