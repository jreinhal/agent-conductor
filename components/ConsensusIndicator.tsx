'use client';

import { useMemo } from 'react';
import { Message } from 'ai';

interface ConsensusIndicatorProps {
    sessions: {
        id: string;
        title: string;
        messages: Message[];
    }[];
}

// Simple similarity check between responses (word overlap)
function calculateSimilarity(text1: string, text2: string): number {
    if (!text1 || !text2) return 0;

    const words1 = new Set(text1.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const words2 = new Set(text2.toLowerCase().split(/\s+/).filter(w => w.length > 3));

    if (words1.size === 0 || words2.size === 0) return 0;

    const intersection = [...words1].filter(w => words2.has(w));
    const union = new Set([...words1, ...words2]);

    return intersection.length / union.size;
}

// Get sentiment/stance from response
function getStance(text: string): 'positive' | 'negative' | 'neutral' {
    const lower = text.toLowerCase();

    const positiveSignals = ['yes', 'agree', 'correct', 'good', 'recommend', 'should', 'definitely'];
    const negativeSignals = ['no', 'disagree', 'wrong', 'bad', 'avoid', 'should not', "don't"];

    const positiveCount = positiveSignals.filter(s => lower.includes(s)).length;
    const negativeCount = negativeSignals.filter(s => lower.includes(s)).length;

    if (positiveCount > negativeCount + 1) return 'positive';
    if (negativeCount > positiveCount + 1) return 'negative';
    return 'neutral';
}

type ConsensusLevel = 'high' | 'medium' | 'low' | 'pending';

interface AnalysisResult {
    level: ConsensusLevel;
    score: number;
    responses: { id: string; title: string; content: string; stance: string }[];
    stanceCounts?: {
        positive: number;
        negative: number;
        neutral: number;
    };
}

export function ConsensusIndicator({ sessions }: ConsensusIndicatorProps) {
    const analysis = useMemo((): AnalysisResult => {
        // Get latest assistant message from each session
        const responses = sessions
            .map(s => {
                const lastAssistant = [...s.messages].reverse().find(m => m.role === 'assistant');
                const content = lastAssistant?.content || '';
                return {
                    id: s.id,
                    title: s.title,
                    content,
                    stance: content ? getStance(content) : 'neutral',
                };
            })
            .filter(r => r.content.length > 0);

        if (responses.length < 2) {
            return { level: 'pending', score: 0, responses };
        }

        // Calculate pairwise similarities
        let totalSimilarity = 0;
        let pairs = 0;

        for (let i = 0; i < responses.length; i++) {
            for (let j = i + 1; j < responses.length; j++) {
                totalSimilarity += calculateSimilarity(responses[i].content, responses[j].content);
                pairs++;
            }
        }

        const avgSimilarity = pairs > 0 ? totalSimilarity / pairs : 0;

        // Check stance alignment
        const stances = responses.map(r => r.stance);
        const stanceCounts = {
            positive: stances.filter(s => s === 'positive').length,
            negative: stances.filter(s => s === 'negative').length,
            neutral: stances.filter(s => s === 'neutral').length,
        };
        const maxStance = Math.max(stanceCounts.positive, stanceCounts.negative, stanceCounts.neutral);
        const stanceAlignment = maxStance / responses.length;

        // Combined consensus score
        const score = (avgSimilarity * 0.6 + stanceAlignment * 0.4);

        let level: 'low' | 'medium' | 'high' | 'pending' = 'pending';
        if (score >= 0.6) level = 'high';
        else if (score >= 0.35) level = 'medium';
        else level = 'low';

        return { level, score, responses, stanceCounts };
    }, [sessions]);

    if (analysis.responses.length < 2) {
        return null;
    }

    const colors: Record<ConsensusLevel, string> = {
        high: 'bg-green-500',
        medium: 'bg-yellow-500',
        low: 'bg-red-500',
        pending: 'bg-gray-400',
    };

    const labels: Record<ConsensusLevel, string> = {
        high: 'Strong Consensus',
        medium: 'Partial Agreement',
        low: 'Divergent Views',
        pending: 'Analyzing...',
    };

    return (
        <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
            {/* Consensus bar */}
            <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                        {labels[analysis.level]}
                    </span>
                    <span className="text-xs text-gray-400">
                        {Math.round(analysis.score * 100)}%
                    </span>
                </div>
                <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                        className={`h-full ${colors[analysis.level]} transition-all duration-500`}
                        style={{ width: `${analysis.score * 100}%` }}
                    />
                </div>
            </div>

            {/* Stance breakdown */}
            {analysis.stanceCounts && (
                <div className="flex items-center gap-1 text-xs">
                    {analysis.stanceCounts.positive > 0 && (
                        <span className="px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded">
                            +{analysis.stanceCounts.positive}
                        </span>
                    )}
                    {analysis.stanceCounts.neutral > 0 && (
                        <span className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded">
                            ~{analysis.stanceCounts.neutral}
                        </span>
                    )}
                    {analysis.stanceCounts.negative > 0 && (
                        <span className="px-1.5 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded">
                            -{analysis.stanceCounts.negative}
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}
