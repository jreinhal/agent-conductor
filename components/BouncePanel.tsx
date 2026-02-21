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
    ResponseStance,
    ConsensusAnalysis,
    DebateFindings as DebateFindingsType,
} from '@/lib/bounce-types';
import { formatStance, getStanceEmoji } from '@/lib/bounce-prompts';
import { extractDebateFindings } from '@/lib/consensus-analyzer';
import { DebateFindings } from './DebateFindings';

interface BouncePanelProps {
    /** Maximum height before scrolling */
    maxHeight?: string;
}

export function BouncePanel({ maxHeight = '600px' }: BouncePanelProps) {
    const bounceState = useBounceState();
    const [findingsDismissed, setFindingsDismissed] = useState(false);

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
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg overflow-hidden"
            style={{ maxHeight }}
        >
            {/* Header */}
            <div className="sticky top-0 z-10 px-4 py-3 bg-gradient-to-r from-indigo-500 to-purple-600 text-white">
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
                {rounds.map((round) => (
                    <RoundDisplay key={round.roundNumber} round={round} />
                ))}

                {/* Final Answer */}
                {finalAnswer && (
                    <FinalAnswerDisplay
                        answer={finalAnswer}
                        consensus={consensus}
                    />
                )}

                {/* Debate Findings - add to knowledge base */}
                {findings && !findingsDismissed && findings.agreements.length > 0 && (
                    <div className="p-4">
                        <DebateFindings
                            findings={findings}
                            onDismiss={() => setFindingsDismissed(true)}
                        />
                    </div>
                )}

                {/* Loading state */}
                {status === 'running' && (
                    <div className="p-4 flex items-center justify-center gap-2 text-gray-500 dark:text-gray-400">
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span className="text-sm">Thinking...</span>
                    </div>
                )}

                {/* Judging state */}
                {status === 'judging' && (
                    <div className="p-4 bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center gap-2 text-purple-600 dark:text-purple-400">
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
        <div className="border-b border-gray-200 dark:border-gray-700">
            {/* Round header */}
            <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800/50 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                    Round {round.roundNumber}
                </span>
                <div className="flex items-center gap-2">
                    <ConsensusBar score={round.consensusAtEnd.score} size="sm" />
                    <TrendIndicator trend={round.consensusAtEnd.trend} />
                </div>
            </div>

            {/* Responses */}
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
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
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                        {response.modelTitle}
                    </span>
                    {stanceIcon}
                    <span className="text-xs text-gray-500 dark:text-gray-400 px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded-full">
                        {formatStance(response.stance)}
                    </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Clock className="w-3 h-3" />
                    <span>{(response.durationMs / 1000).toFixed(1)}s</span>
                </div>
            </div>

            {/* Content */}
            <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
                {response.content}
            </div>

            {/* Key points */}
            {response.keyPoints.length > 0 && (
                <div className="mt-3">
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Key Points:</span>
                    <ul className="mt-1 space-y-1">
                        {response.keyPoints.map((point, idx) => (
                            <li key={idx} className="text-xs text-gray-600 dark:text-gray-400 flex items-start gap-1">
                                <span className="text-gray-400">•</span>
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
                                    <li key={idx} className="text-gray-600 dark:text-gray-400">• {a}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {response.disagreements.length > 0 && (
                        <div className="flex-1">
                            <span className="text-red-600 dark:text-red-400 font-medium">Disagrees with:</span>
                            <ul className="mt-1 space-y-0.5">
                                {response.disagreements.map((d, idx) => (
                                    <li key={idx} className="text-gray-600 dark:text-gray-400">• {d}</li>
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
        <div className="bg-gradient-to-b from-purple-50 to-white dark:from-purple-900/20 dark:to-gray-900">
            {/* Header */}
            <div className="px-4 py-3 border-b border-purple-200 dark:border-purple-800 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-500" />
                <span className="font-semibold text-purple-700 dark:text-purple-300">
                    Final Synthesis
                </span>
                {consensus && (
                    <span className="ml-auto text-xs text-purple-500">
                        {Math.round(consensus.score * 100)}% consensus
                    </span>
                )}
            </div>

            {/* Answer */}
            <div className="p-4">
                <div className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">
                    {answer}
                </div>
            </div>

            {/* Consensus summary */}
            {consensus && (
                <div className="px-4 pb-4">
                    <div className="p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                        {consensus.agreedPoints.length > 0 && (
                            <div className="mb-2">
                                <div className="flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400 mb-1">
                                    <CheckCircle2 className="w-3 h-3" />
                                    Points of Agreement
                                </div>
                                <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-0.5">
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
                                <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-0.5">
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
        <div className={`${width} ${height} bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden`}>
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
