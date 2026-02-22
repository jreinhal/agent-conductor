'use client';

import { useState } from 'react';

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
    // OpenAI (GPT 5.2+)
    'gpt-5.3-codex': { input: 15, output: 45 },
    'gpt-5.2': { input: 10, output: 30 },

    // Anthropic (Claude 4.5+)
    'claude-sonnet-4.5': { input: 3, output: 15 },
    'claude-opus-4.5': { input: 15, output: 75 },
    'claude-opus-4.6': { input: 15, output: 75 },
    'claude-haiku-4.5': { input: 0.80, output: 4 },

    // Google (Gemini 3+)
    'gemini-3-pro': { input: 1.25, output: 5 },
    'gemini-3-flash': { input: 0.10, output: 0.40 },

    // xAI (Grok 4+)
    'grok-4.1-fast': { input: 3, output: 15 },
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

    // Hide meter when no billable usage has been tracked (e.g. CLI-only sessions).
    if (sessions.length === 0 || totals.totalTokens === 0) return null;

    return (
        <div className="relative">
            {/* Collapsed view - just the badge */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="status-pill flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm hover:border-[color:var(--ac-border)]"
            >
                <svg className="w-4 h-4 text-[color:var(--ac-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                <span className="text-[color:var(--ac-text-dim)] font-mono">
                    {formatTokens(totals.totalTokens)}
                </span>
                <span className="text-[color:var(--ac-text-muted)]">·</span>
                <span className="text-[color:var(--ac-success)] font-mono">
                    ${totals.estimatedCost.toFixed(4)}
                </span>
                <svg
                    className={`w-3 h-3 text-[color:var(--ac-text-muted)] transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {/* Expanded view - breakdown per model */}
            {isExpanded && (
                <div className="absolute top-full right-0 mt-2 w-80 panel-shell rounded-xl shadow-xl z-50">
                    <div className="p-3 border-b border-[color:var(--ac-border-soft)]">
                        <h3 className="text-sm font-medium text-[color:var(--ac-text)]">Session Usage</h3>
                    </div>

                    <div className="max-h-64 overflow-y-auto">
                        {sessions.map((session) => {
                            const usage = tokenUsage.get(session.id);
                            if (!usage) {
                                return (
                                    <div key={session.id} className="px-3 py-2 border-b border-[color:var(--ac-border-soft)]/60 last:border-0">
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm text-[color:var(--ac-text-dim)] truncate max-w-[150px]">
                                                {session.title}
                                            </span>
                                            <span className="text-xs text-[color:var(--ac-text-muted)]">No usage yet</span>
                                        </div>
                                    </div>
                                );
                            }

                            return (
                                <div key={session.id} className="px-3 py-2 border-b border-[color:var(--ac-border-soft)]/60 last:border-0">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-sm text-[color:var(--ac-text-dim)] truncate max-w-[150px]">
                                            {session.title}
                                        </span>
                                        <span className="text-xs font-mono text-[color:var(--ac-success)]">
                                            ${usage.estimatedCost.toFixed(4)}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-3 text-[10px] text-[color:var(--ac-text-muted)]">
                                        <span>↑ {formatTokens(usage.promptTokens)}</span>
                                        <span>↓ {formatTokens(usage.completionTokens)}</span>
                                        <span>= {formatTokens(usage.totalTokens)}</span>
                                    </div>
                                    {/* Token bar */}
                                    <div className="mt-1 h-1 bg-[color:var(--ac-surface-strong)] rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-gradient-to-r from-cyan-500 to-emerald-500"
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
                    <div className="p-3 border-t border-[color:var(--ac-border-soft)] bg-[color:var(--ac-surface-strong)]/60 rounded-b-xl">
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-[color:var(--ac-text-muted)]">Total</span>
                            <div className="flex items-center gap-3">
                                <span className="font-mono text-[color:var(--ac-text-dim)]">
                                    {formatTokens(totals.totalTokens)} tokens
                                </span>
                                <span className="font-mono text-[color:var(--ac-success)] font-medium">
                                    ${totals.estimatedCost.toFixed(4)}
                                </span>
                            </div>
                        </div>
                        <div className="mt-1 text-[10px] text-[color:var(--ac-text-muted)] text-right">
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
