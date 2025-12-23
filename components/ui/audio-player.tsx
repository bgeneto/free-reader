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

export function AudioPlayer({
    text,
    voice,
    className,
    compact = false,
}: AudioPlayerProps) {
    const [playerState, setPlayerState] = useState<PlayerState>("idle");
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const audioUrlRef = useRef<string | null>(null);

    // Format time as mm:ss
    const formatTime = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, "0")}`;
    };

    // Cleanup audio URL on unmount
    useEffect(() => {
        return () => {
            if (audioUrlRef.current) {
                URL.revokeObjectURL(audioUrlRef.current);
            }
        };
    }, []);

    // Handle audio element events
    const setupAudioListeners = useCallback((audio: HTMLAudioElement) => {
        audio.onloadedmetadata = () => {
            setDuration(audio.duration);
        };

        audio.ontimeupdate = () => {
            setCurrentTime(audio.currentTime);
        };

        audio.onended = () => {
            setPlayerState("paused");
            setCurrentTime(0);
            audio.currentTime = 0;
        };

        audio.onerror = () => {
            setPlayerState("error");
            setErrorMessage("Audio playback failed");
        };

        audio.onplay = () => {
            setPlayerState("playing");
        };

        audio.onpause = () => {
            if (playerState !== "error") {
                setPlayerState("paused");
            }
        };
    }, [playerState]);

    // Generate and play audio
    const handlePlay = async () => {
        // If we already have audio loaded, just play it
        if (audioRef.current && audioUrlRef.current) {
            await audioRef.current.play();
            return;
        }

        setPlayerState("loading");
        setErrorMessage(null);

        try {
            const response = await fetch("/api/tts", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ text, voice }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `TTS failed: ${response.status}`);
            }

            const audioBlob = await response.blob();
            const audioUrl = URL.createObjectURL(audioBlob);

            // Cleanup previous URL
            if (audioUrlRef.current) {
                URL.revokeObjectURL(audioUrlRef.current);
            }
            audioUrlRef.current = audioUrl;

            const audio = new Audio(audioUrl);
            audio.volume = isMuted ? 0 : volume;
            audioRef.current = audio;

            setupAudioListeners(audio);
            await audio.play();
        } catch (error) {
            setPlayerState("error");
            setErrorMessage(error instanceof Error ? error.message : "Failed to generate audio");
        }
    };

    // Pause audio
    const handlePause = () => {
        if (audioRef.current) {
            audioRef.current.pause();
        }
    };

    // Toggle play/pause
    const togglePlayPause = () => {
        if (playerState === "playing") {
            handlePause();
        } else {
            handlePlay();
        }
    };

    // Seek to position
    const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!audioRef.current || duration === 0) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percentage = x / rect.width;
        const newTime = percentage * duration;

        audioRef.current.currentTime = newTime;
        setCurrentTime(newTime);
    };

    // Toggle mute
    const toggleMute = () => {
        if (audioRef.current) {
            audioRef.current.volume = isMuted ? volume : 0;
        }
        setIsMuted(!isMuted);
    };

    // Retry on error
    const handleRetry = () => {
        // Clear previous audio
        if (audioUrlRef.current) {
            URL.revokeObjectURL(audioUrlRef.current);
            audioUrlRef.current = null;
        }
        audioRef.current = null;
        setPlayerState("idle");
        setErrorMessage(null);
        handlePlay();
    };

    const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

    // Compact mode - just a play button
    if (compact) {
        return (
            <Button
                variant="ghost"
                size="icon-sm"
                onClick={togglePlayPause}
                disabled={playerState === "loading"}
                className={cn("transition-all", className)}
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
                disabled={playerState === "loading"}
                className="shrink-0"
                aria-label={playerState === "playing" ? "Pause" : "Play"}
            >
                {playerState === "loading" ? (
                    <Loader2 className="size-4 animate-spin" />
                ) : playerState === "playing" ? (
                    <Pause className="size-4" />
                ) : (
                    <Play className="size-4" />
                )}
            </Button>

            {/* Progress Bar */}
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
                <div className="relative h-1.5 rounded-full bg-accent/50 overflow-hidden">
                    <div
                        className="absolute left-0 top-0 h-full rounded-full bg-accent transition-all duration-100"
                        style={{ width: `${progress}%` }}
                    />
                </div>
            </div>

            {/* Time Display */}
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums min-w-[72px] text-right">
                {formatTime(currentTime)} / {formatTime(duration)}
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
