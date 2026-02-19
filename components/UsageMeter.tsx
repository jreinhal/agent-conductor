'use client';

import { useState, useEffect } from 'react';

interface TokenUsage {
    sessionId: string;
    modelId: string;
    modelName: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCost: number;
}

interface UsageMeterProps {
    sessions: { id: string; modelId: string; title: string }[];
    tokenUsage: Map<string, TokenUsage>;
}

// Approximate costs per 1M tokens (as of February 2026)
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
    // OpenAI
    'gpt-5.2': { input: 10, output: 30 },
    'gpt-5.2-pro': { input: 15, output: 45 },
    'gpt-4.1': { input: 5, output: 15 },
    'o3': { input: 20, output: 80 },
    'o3-pro': { input: 30, output: 120 },
    'o4-mini': { input: 1.10, output: 4.40 },
    'gpt-4o': { input: 2.5, output: 10 },
    'gpt-4o-mini': { input: 0.15, output: 0.6 },
    // Anthropic
    'claude-sonnet-4.5': { input: 3, output: 15 },
    'claude-opus-4.5': { input: 15, output: 75 },
    'claude-haiku-4.5': { input: 0.80, output: 4 },
    // Google
    'gemini-3-pro': { input: 1.25, output: 5 },
    'gemini-3-flash': { input: 0.10, output: 0.40 },
    'gemini-2.5-flash': { input: 0.075, output: 0.30 },
    'gemini-2.5-pro': { input: 1.25, output: 5 },
    // xAI
    'grok-4.1-fast': { input: 3, output: 15 },
    'grok-3': { input: 2, output: 10 },
    'grok-3-mini': { input: 0.30, output: 0.50 },
    'grok-code': { input: 0.30, output: 0.50 },
    // Local (free)
    'llama3.3': { input: 0, output: 0 },
    'deepseek-r1': { input: 0, output: 0 },
    'qwen2.5': { input: 0, output: 0 },
};

export function calculateCost(modelId: string, promptTokens: number, completionTokens: number): number {
    const costs = MODEL_COSTS[modelId] || { input: 5, output: 15 }; // Default estimate
    return (promptTokens * costs.input + completionTokens * costs.output) / 1_000_000;
}

export function UsageMeter({ sessions, tokenUsage }: UsageMeterProps) {
    const [isExpanded, setIsExpanded] = useState(false);

    // Calculate totals
    const totals = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCost: 0,
    };

    tokenUsage.forEach((usage) => {
        totals.promptTokens += usage.promptTokens;
        totals.completionTokens += usage.completionTokens;
        totals.totalTokens += usage.totalTokens;
        totals.estimatedCost += usage.estimatedCost;
    });

    if (sessions.length === 0) return null;

    return (
        <div className="relative">
            {/* Collapsed view - just the badge */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors text-sm"
            >
                <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                <span className="text-gray-600 dark:text-gray-300 font-mono">
                    {formatTokens(totals.totalTokens)}
                </span>
                <span className="text-gray-400">·</span>
                <span className="text-green-600 dark:text-green-400 font-mono">
                    ${totals.estimatedCost.toFixed(4)}
                </span>
                <svg
                    className={`w-3 h-3 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {/* Expanded view - breakdown per model */}
            {isExpanded && (
                <div className="absolute top-full right-0 mt-2 w-80 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl z-50">
                    <div className="p-3 border-b border-gray-100 dark:border-gray-800">
                        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200">Session Usage</h3>
                    </div>

                    <div className="max-h-64 overflow-y-auto">
                        {sessions.map((session) => {
                            const usage = tokenUsage.get(session.id);
                            if (!usage) {
                                return (
                                    <div key={session.id} className="px-3 py-2 border-b border-gray-50 dark:border-gray-800 last:border-0">
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm text-gray-600 dark:text-gray-300 truncate max-w-[150px]">
                                                {session.title}
                                            </span>
                                            <span className="text-xs text-gray-400">No usage yet</span>
                                        </div>
                                    </div>
                                );
                            }

                            return (
                                <div key={session.id} className="px-3 py-2 border-b border-gray-50 dark:border-gray-800 last:border-0">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-sm text-gray-600 dark:text-gray-300 truncate max-w-[150px]">
                                            {session.title}
                                        </span>
                                        <span className="text-xs font-mono text-green-600 dark:text-green-400">
                                            ${usage.estimatedCost.toFixed(4)}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-3 text-[10px] text-gray-400">
                                        <span>↑ {formatTokens(usage.promptTokens)}</span>
                                        <span>↓ {formatTokens(usage.completionTokens)}</span>
                                        <span>= {formatTokens(usage.totalTokens)}</span>
                                    </div>
                                    {/* Token bar */}
                                    <div className="mt-1 h-1 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-gradient-to-r from-blue-500 to-purple-500"
                                            style={{
                                                width: `${Math.min((usage.totalTokens / 10000) * 100, 100)}%`
                                            }}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Totals footer */}
                    <div className="p-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 rounded-b-xl">
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-gray-500">Total</span>
                            <div className="flex items-center gap-3">
                                <span className="font-mono text-gray-600 dark:text-gray-300">
                                    {formatTokens(totals.totalTokens)} tokens
                                </span>
                                <span className="font-mono text-green-600 dark:text-green-400 font-medium">
                                    ${totals.estimatedCost.toFixed(4)}
                                </span>
                            </div>
                        </div>
                        <div className="mt-1 text-[10px] text-gray-400 text-right">
                            ↑ {formatTokens(totals.promptTokens)} input · ↓ {formatTokens(totals.completionTokens)} output
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function formatTokens(tokens: number): string {
    if (tokens >= 1_000_000) {
        return `${(tokens / 1_000_000).toFixed(1)}M`;
    }
    if (tokens >= 1_000) {
        return `${(tokens / 1_000).toFixed(1)}K`;
    }
    return tokens.toString();
}

// Hook to track usage from streaming responses
export function useTokenTracking() {
    const [usage, setUsage] = useState<Map<string, TokenUsage>>(new Map());

    const trackUsage = (sessionId: string, modelId: string, modelName: string, prompt: number, completion: number) => {
        setUsage(prev => {
            const next = new Map(prev);
            const existing = next.get(sessionId) || {
                sessionId,
                modelId,
                modelName,
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0,
                estimatedCost: 0,
            };

            existing.promptTokens += prompt;
            existing.completionTokens += completion;
            existing.totalTokens = existing.promptTokens + existing.completionTokens;
            existing.estimatedCost = calculateCost(modelId, existing.promptTokens, existing.completionTokens);

            next.set(sessionId, existing);
            return next;
        });
    };

    const clearUsage = (sessionId?: string) => {
        if (sessionId) {
            setUsage(prev => {
                const next = new Map(prev);
                next.delete(sessionId);
                return next;
            });
        } else {
            setUsage(new Map());
        }
    };

    return { usage, trackUsage, clearUsage };
}
