'use client';

import { useMemo, useState } from 'react';
import {
    MessageCircle,
    ThumbsUp,
    ThumbsDown,
    Minus,
    RefreshCw,
    Merge,
    Clock,
    TrendingUp,
    TrendingDown,
    AlertCircle,
    CheckCircle2,
    Sparkles,
} from 'lucide-react';
import { useBounceState } from '@/lib/store';
import {
    BounceRound,
    BounceResponse,
    ConsensusAnalysis,
    DebateFindings as DebateFindingsType,
} from '@/lib/bounce-types';
import { formatStance } from '@/lib/bounce-prompts';
import { extractDebateFindings } from '@/lib/consensus-analyzer';
import { DebateFindings } from './DebateFindings';

interface BouncePanelProps {
    /** Maximum height before scrolling */
    maxHeight?: string;
}

export function BouncePanel({ maxHeight = '600px' }: BouncePanelProps) {
    const bounceState = useBounceState();
    const [dismissedDebateId, setDismissedDebateId] = useState<number | null>(null);

    const { rounds, consensus, finalAnswer, originalTopic, status } = bounceState;

    const findings = useMemo<DebateFindingsType | null>(() => {
        if (status !== 'complete' || !consensus || rounds.length === 0) return null;
        const debateId = `bounce-${bounceState.startedAt}`;
        return extractDebateFindings(debateId, originalTopic, rounds, consensus);
    }, [status, consensus, rounds, originalTopic, bounceState.startedAt]);

    if (rounds.length === 0 && !finalAnswer) {
        return null;
    }

    return (
        <div
            className="panel-shell rounded-xl overflow-hidden"
            style={{ maxHeight }}
        >
            {/* Header */}
            <div
                className="sticky top-0 z-10 px-4 py-3 text-white"
                style={{
                    background:
                        'linear-gradient(120deg, color-mix(in srgb, var(--ac-accent) 66%, #0c1430), color-mix(in srgb, var(--ac-accent-strong) 88%, #122854))',
                }}
            >
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <MessageCircle className="w-5 h-5" />
                        <h3 className="font-semibold">Debate Progress</h3>
                    </div>
                    {consensus && (
                        <ConsensusChip consensus={consensus} />
                    )}
                </div>
                {originalTopic && (
                    <p className="mt-1 text-sm text-white/80 line-clamp-2">
                        {originalTopic}
                    </p>
                )}
            </div>

            {/* Content */}
            <div className="overflow-y-auto" style={{ maxHeight: `calc(${maxHeight} - 80px)` }}>
                {/* Rounds */}
                {rounds.map((round, index) => (
                    <RoundDisplay key={`${round.roundNumber}-${round.timestamp}-${index}`} round={round} />
                ))}

                {/* Final Answer */}
                {finalAnswer && (
                    <FinalAnswerDisplay
                        answer={finalAnswer}
                        consensus={consensus}
                    />
                )}

                {/* Debate Findings - add to knowledge base */}
                {findings && dismissedDebateId !== bounceState.startedAt && findings.agreements.length > 0 && (
                    <div className="p-4">
                        <DebateFindings
                            findings={findings}
                            onDismiss={() => setDismissedDebateId(bounceState.startedAt)}
                        />
                    </div>
                )}

                {/* Loading state */}
                {status === 'running' && (
                    <div className="p-4 flex items-center justify-center gap-2 text-[color:var(--ac-text-dim)]">
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span className="text-sm">Thinking...</span>
                    </div>
                )}

                {/* Judging state */}
                {status === 'judging' && (
                    <div
                        className="p-4 flex items-center justify-center gap-2"
                        style={{
                            background: 'color-mix(in srgb, var(--ac-accent) 14%, var(--ac-surface))',
                            color: 'var(--ac-accent)',
                        }}
                    >
                        <Sparkles className="w-4 h-4 animate-pulse" />
                        <span className="text-sm font-medium">Synthesizing final answer...</span>
                    </div>
                )}
            </div>
        </div>
    );
}

// ============================================================================
// Sub-components
// ============================================================================

function RoundDisplay({ round }: { round: BounceRound }) {
    return (
        <div className="border-b border-[color:var(--ac-border-soft)]">
            {/* Round header */}
            <div className="px-4 py-2 bg-[color:var(--ac-surface)] flex items-center justify-between">
                <span className="text-sm font-medium text-[color:var(--ac-text-dim)]">
                    Round {round.roundNumber}
                </span>
                <div className="flex items-center gap-2">
                    <ConsensusBar score={round.consensusAtEnd.score} size="sm" />
                    <TrendIndicator trend={round.consensusAtEnd.trend} />
                </div>
            </div>

            {/* Responses */}
            <div className="divide-y divide-[color:var(--ac-border-soft)]">
                {round.responses.map((response, idx) => (
                    <ResponseDisplay key={`${response.participantSessionId}-${idx}`} response={response} />
                ))}
            </div>
        </div>
    );
}

function ResponseDisplay({ response }: { response: BounceResponse }) {
    const stanceIcon = useMemo(() => {
        switch (response.stance) {
            case 'strongly_agree':
            case 'agree':
                return <ThumbsUp className="w-4 h-4 text-green-500" />;
            case 'strongly_disagree':
            case 'disagree':
                return <ThumbsDown className="w-4 h-4 text-red-500" />;
            case 'refine':
                return <RefreshCw className="w-4 h-4 text-blue-500" />;
            case 'synthesize':
                return <Merge className="w-4 h-4 text-purple-500" />;
            default:
                return <Minus className="w-4 h-4 text-gray-400" />;
        }
    }, [response.stance]);

    const stanceColor = useMemo(() => {
        switch (response.stance) {
            case 'strongly_agree':
            case 'agree':
                return 'border-l-green-500 bg-green-50/50 dark:bg-green-900/10';
            case 'strongly_disagree':
            case 'disagree':
                return 'border-l-red-500 bg-red-50/50 dark:bg-red-900/10';
            case 'refine':
                return 'border-l-blue-500 bg-blue-50/50 dark:bg-blue-900/10';
            case 'synthesize':
                return 'border-l-purple-500 bg-purple-50/50 dark:bg-purple-900/10';
            default:
                return 'border-l-gray-300 dark:border-l-gray-600';
        }
    }, [response.stance]);

    return (
        <div className={`p-4 border-l-4 ${stanceColor}`}>
            {/* Header */}
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <span className="font-medium text-[color:var(--ac-text)]">
                        {response.modelTitle}
                    </span>
                    {stanceIcon}
                    <span className="ac-badge text-xs px-2 py-0.5 rounded-full">
                        {formatStance(response.stance)}
                    </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-[color:var(--ac-text-muted)]">
                    <Clock className="w-3 h-3" />
                    <span>{(response.durationMs / 1000).toFixed(1)}s</span>
                </div>
            </div>

            {/* Content */}
            <div className="text-sm text-[color:var(--ac-text-dim)] whitespace-pre-wrap leading-relaxed">
                {response.content}
            </div>

            {/* Key points */}
            {response.keyPoints.length > 0 && (
                <div className="mt-3">
                    <span className="text-xs font-medium text-[color:var(--ac-text-muted)]">Key Points:</span>
                    <ul className="mt-1 space-y-1">
                        {response.keyPoints.map((point, idx) => (
                            <li key={idx} className="text-xs text-[color:var(--ac-text-dim)] flex items-start gap-1">
                                <span className="text-[color:var(--ac-text-muted)]">•</span>
                                <span>{point}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Agreements/Disagreements */}
            {(response.agreements.length > 0 || response.disagreements.length > 0) && (
                <div className="mt-3 flex gap-4 text-xs">
                    {response.agreements.length > 0 && (
                        <div className="flex-1">
                            <span className="text-green-600 dark:text-green-400 font-medium">Agrees with:</span>
                                <ul className="mt-1 space-y-0.5">
                                    {response.agreements.map((a, idx) => (
                                        <li key={idx} className="text-[color:var(--ac-text-dim)]">• {a}</li>
                                    ))}
                                </ul>
                            </div>
                    )}
                    {response.disagreements.length > 0 && (
                        <div className="flex-1">
                            <span className="text-red-600 dark:text-red-400 font-medium">Disagrees with:</span>
                                <ul className="mt-1 space-y-0.5">
                                    {response.disagreements.map((d, idx) => (
                                        <li key={idx} className="text-[color:var(--ac-text-dim)]">• {d}</li>
                                    ))}
                                </ul>
                            </div>
                    )}
                </div>
            )}
        </div>
    );
}

function FinalAnswerDisplay({
    answer,
    consensus,
}: {
    answer: string;
    consensus: ConsensusAnalysis | null;
}) {
    return (
        <div style={{ background: 'linear-gradient(180deg, color-mix(in srgb, var(--ac-accent) 10%, transparent), transparent)' }}>
            {/* Header */}
            <div className="px-4 py-3 border-b border-[color:var(--ac-border-soft)] flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-[color:var(--ac-accent)]" />
                <span className="font-semibold text-[color:var(--ac-text)]">
                    Final Synthesis
                </span>
                {consensus && (
                    <span className="ml-auto text-xs text-[color:var(--ac-accent)]">
                        {Math.round(consensus.score * 100)}% consensus
                    </span>
                )}
            </div>

            {/* Answer */}
            <div className="p-4">
                <div className="text-[color:var(--ac-text-dim)] whitespace-pre-wrap leading-relaxed">
                    {answer}
                </div>
            </div>

            {/* Consensus summary */}
            {consensus && (
                <div className="px-4 pb-4">
                    <div className="ac-soft-surface p-3 rounded-lg">
                        {consensus.agreedPoints.length > 0 && (
                            <div className="mb-2">
                                <div className="flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400 mb-1">
                                    <CheckCircle2 className="w-3 h-3" />
                                    Points of Agreement
                                </div>
                                <ul className="text-xs text-[color:var(--ac-text-dim)] space-y-0.5">
                                    {consensus.agreedPoints.map((point, idx) => (
                                        <li key={idx}>• {point}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {consensus.disputedPoints.length > 0 && (
                            <div>
                                <div className="flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400 mb-1">
                                    <AlertCircle className="w-3 h-3" />
                                    Remaining Disputes
                                </div>
                                <ul className="text-xs text-[color:var(--ac-text-dim)] space-y-0.5">
                                    {consensus.disputedPoints.map((point, idx) => (
                                        <li key={idx}>• {point}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

function ConsensusChip({ consensus }: { consensus: ConsensusAnalysis }) {
    const levelColors: Record<ConsensusAnalysis['level'], string> = {
        unanimous: 'bg-green-400',
        strong: 'bg-green-400',
        partial: 'bg-yellow-400',
        low: 'bg-orange-400',
        none: 'bg-red-400',
    };

    return (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium text-white ${levelColors[consensus.level]}`}>
            {Math.round(consensus.score * 100)}% {consensus.level}
        </span>
    );
}

function ConsensusBar({ score, size = 'md' }: { score: number; size?: 'sm' | 'md' }) {
    const height = size === 'sm' ? 'h-1.5' : 'h-2';
    const width = size === 'sm' ? 'w-16' : 'w-24';

    return (
        <div className={`${width} ${height} rounded-full overflow-hidden ac-soft-surface`}>
            <div
                className={`h-full transition-all duration-500 ${
                    score >= 0.7 ? 'bg-green-500' : score >= 0.4 ? 'bg-yellow-500' : 'bg-red-500'
                }`}
                style={{ width: `${score * 100}%` }}
            />
        </div>
    );
}

function TrendIndicator({ trend }: { trend: 'improving' | 'stable' | 'degrading' }) {
    if (trend === 'improving') {
        return <TrendingUp className="w-3 h-3 text-green-500" />;
    }
    if (trend === 'degrading') {
        return <TrendingDown className="w-3 h-3 text-red-500" />;
    }
    return <Minus className="w-3 h-3 text-gray-400" />;
}

// Export individual components for flexibility
export { RoundDisplay, ResponseDisplay, FinalAnswerDisplay, ConsensusChip, ConsensusBar };
