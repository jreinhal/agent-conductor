'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, SkipForward, SkipBack, X, Clock } from 'lucide-react';
import type { SerializedBounceSession, BounceRound, BounceResponse } from '@/lib/bounce-types';

interface DebateReplayProps {
    session: SerializedBounceSession;
    onClose: () => void;
}

type PlaybackSpeed = 0.5 | 1 | 2 | 4;

export function DebateReplay({ session, onClose }: DebateReplayProps) {
    const [currentRound, setCurrentRound] = useState(0);
    const [currentResponse, setCurrentResponse] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [speed, setSpeed] = useState<PlaybackSpeed>(1);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const totalRounds = session.rounds.length;
    const activeRound = session.rounds[currentRound] as BounceRound | undefined;
    const totalResponses = activeRound?.responses.length ?? 0;

    // All responses up to and including current position
    const visibleResponses: { round: number; response: BounceResponse }[] = [];
    for (let r = 0; r <= currentRound && r < totalRounds; r++) {
        const round = session.rounds[r];
        const maxResp = r < currentRound ? round.responses.length : currentResponse + 1;
        for (let i = 0; i < Math.min(maxResp, round.responses.length); i++) {
            visibleResponses.push({ round: r, response: round.responses[i] });
        }
    }

    const isAtEnd = currentRound >= totalRounds - 1 && currentResponse >= totalResponses - 1;

    const advance = useCallback(() => {
        if (currentResponse < totalResponses - 1) {
            setCurrentResponse((prev) => prev + 1);
        } else if (currentRound < totalRounds - 1) {
            setCurrentRound((prev) => prev + 1);
            setCurrentResponse(0);
        } else {
            setIsPlaying(false);
        }
    }, [currentRound, currentResponse, totalRounds, totalResponses]);

    // Playback timer
    useEffect(() => {
        if (!isPlaying) {
            if (timerRef.current) clearTimeout(timerRef.current);
            return;
        }

        const delay = 1500 / speed;
        timerRef.current = setTimeout(advance, delay);

        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [isPlaying, speed, advance]);

    const handlePlay = () => {
        if (isAtEnd) {
            setCurrentRound(0);
            setCurrentResponse(0);
        }
        setIsPlaying(true);
    };

    const handlePrevRound = () => {
        setIsPlaying(false);
        if (currentRound > 0) {
            setCurrentRound((prev) => prev - 1);
            setCurrentResponse(0);
        } else {
            setCurrentResponse(0);
        }
    };

    const handleNextRound = () => {
        setIsPlaying(false);
        if (currentRound < totalRounds - 1) {
            setCurrentRound((prev) => prev + 1);
            setCurrentResponse(0);
        }
    };

    const consensusAtRound = activeRound?.consensusAtEnd;
    const progressPct = totalRounds > 0
        ? ((currentRound + (totalResponses > 0 ? (currentResponse + 1) / totalResponses : 0)) / totalRounds) * 100
        : 0;

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[color:var(--ac-border-soft)]">
                <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-[color:var(--ac-accent)]" />
                    <span className="font-semibold text-sm text-[color:var(--ac-text)]">
                        Debate Replay
                    </span>
                    <span className="text-xs text-[color:var(--ac-text-muted)]">
                        {session.topic.slice(0, 50)}{session.topic.length > 50 ? '...' : ''}
                    </span>
                </div>
                <button onClick={onClose} className="control-chip p-1.5 rounded-md">
                    <X className="w-4 h-4" />
                </button>
            </div>

            {/* Progress bar */}
            <div className="px-4 py-2 border-b border-[color:var(--ac-border-soft)]">
                <div className="flex items-center gap-3">
                    <span className="text-[10px] text-[color:var(--ac-text-muted)] w-16">
                        Round {currentRound + 1}/{totalRounds}
                    </span>
                    <div className="flex-1 h-1.5 rounded-full bg-[color:var(--ac-surface)] overflow-hidden">
                        <div
                            className="h-full rounded-full bg-[color:var(--ac-accent)] transition-all duration-300"
                            style={{ width: `${Math.min(100, progressPct)}%` }}
                        />
                    </div>
                    {consensusAtRound && (
                        <span className="text-[10px] text-[color:var(--ac-text-dim)]">
                            Score: {Math.round(consensusAtRound.score * 100)}%
                        </span>
                    )}
                </div>
            </div>

            {/* Playback controls */}
            <div className="flex items-center justify-center gap-3 px-4 py-2 border-b border-[color:var(--ac-border-soft)]">
                <button
                    onClick={handlePrevRound}
                    className="control-chip p-1.5"
                    disabled={currentRound === 0 && currentResponse === 0}
                    title="Previous round"
                >
                    <SkipBack className="w-4 h-4" />
                </button>

                {isPlaying ? (
                    <button onClick={() => setIsPlaying(false)} className="ac-btn-primary p-2 rounded-full">
                        <Pause className="w-4 h-4" />
                    </button>
                ) : (
                    <button onClick={handlePlay} className="ac-btn-primary p-2 rounded-full">
                        <Play className="w-4 h-4" />
                    </button>
                )}

                <button
                    onClick={handleNextRound}
                    className="control-chip p-1.5"
                    disabled={currentRound >= totalRounds - 1}
                    title="Next round"
                >
                    <SkipForward className="w-4 h-4" />
                </button>

                {/* Speed selector */}
                <div className="flex items-center gap-1 ml-4">
                    {([0.5, 1, 2, 4] as PlaybackSpeed[]).map((s) => (
                        <button
                            key={s}
                            onClick={() => setSpeed(s)}
                            className={`px-1.5 py-0.5 text-[10px] rounded ${
                                speed === s
                                    ? 'bg-[color:var(--ac-accent)] text-white'
                                    : 'text-[color:var(--ac-text-muted)] hover:text-[color:var(--ac-text)]'
                            }`}
                        >
                            {s}x
                        </button>
                    ))}
                </div>
            </div>

            {/* Response timeline */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {visibleResponses.map(({ round, response }, i) => {
                    const stanceColor =
                        response.stance === 'agree' || response.stance === 'strongly_agree'
                            ? 'text-emerald-400 border-emerald-400/30'
                            : response.stance === 'disagree' || response.stance === 'strongly_disagree'
                                ? 'text-rose-400 border-rose-400/30'
                                : 'text-amber-400 border-amber-400/30';

                    return (
                        <div
                            key={`${round}-${response.participantSessionId}-${i}`}
                            className="rounded-lg ac-soft-surface p-3 transition-all"
                            style={{
                                animation: i === visibleResponses.length - 1
                                    ? 'fadeIn 300ms ease-out'
                                    : undefined,
                            }}
                        >
                            <div className="flex items-center justify-between mb-1.5">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-medium text-[color:var(--ac-text)]">
                                        {response.modelTitle}
                                    </span>
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${stanceColor}`}>
                                        {response.stance.replace(/_/g, ' ')}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 text-[10px] text-[color:var(--ac-text-muted)]">
                                    <span>R{round + 1}</span>
                                    <span>{Math.round(response.confidence * 100)}% conf</span>
                                    <span>{response.durationMs}ms</span>
                                </div>
                            </div>
                            <p className="text-xs text-[color:var(--ac-text-dim)] leading-relaxed">
                                {response.content.slice(0, 300)}
                                {response.content.length > 300 ? '...' : ''}
                            </p>
                            {response.keyPoints.length > 0 && (
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                    {response.keyPoints.slice(0, 3).map((kp, j) => (
                                        <span
                                            key={j}
                                            className="text-[9px] px-1.5 py-0.5 rounded bg-[color:var(--ac-surface)] text-[color:var(--ac-text-muted)]"
                                        >
                                            {kp.slice(0, 40)}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}

                {/* Final answer */}
                {isAtEnd && session.finalAnswer && (
                    <div className="rounded-lg border border-[color:var(--ac-accent)]/30 bg-[color:var(--ac-accent)]/5 p-3 mt-4">
                        <p className="text-xs font-medium text-[color:var(--ac-accent)] mb-1">Final Synthesis</p>
                        <p className="text-xs text-[color:var(--ac-text-dim)] leading-relaxed">
                            {session.finalAnswer.slice(0, 500)}
                            {session.finalAnswer.length > 500 ? '...' : ''}
                        </p>
                    </div>
                )}
            </div>

            {/* Consensus trend footer */}
            {session.metrics && (
                <div className="px-4 py-2 border-t border-[color:var(--ac-border-soft)] flex items-center gap-4 text-[10px] text-[color:var(--ac-text-muted)]">
                    <span>{session.metrics.totalResponses} responses</span>
                    <span>{session.metrics.totalRounds} rounds</span>
                    <span>
                        Final: {Math.round(session.metrics.finalConsensusScore * 100)}%
                    </span>
                    {session.metrics.consensusTrend.length > 0 && (
                        <div className="flex items-center gap-0.5">
                            <span>Trend:</span>
                            {session.metrics.consensusTrend.map((score, i) => (
                                <div
                                    key={i}
                                    className="w-1.5 rounded-full bg-[color:var(--ac-accent)]"
                                    style={{
                                        height: `${Math.max(4, score * 16)}px`,
                                        opacity: 0.4 + score * 0.6,
                                    }}
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
