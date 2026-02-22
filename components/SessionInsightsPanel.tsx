'use client';

import { Message } from 'ai';
import { useEffect, useMemo, useState } from 'react';

const API_ENDPOINT = '/api/session-insights';

interface SessionRef {
    id: string;
    modelId: string;
    title: string;
}

interface TokenUsageSnapshot {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCost: number;
}

interface InsightMetrics {
    activeSessions: number;
    totalMessages: number;
    userMessages: number;
    assistantMessages: number;
    totalTokens: number;
    estimatedCost: number;
    topModel: string;
}

interface InsightEntry {
    id: string;
    createdAt: string;
    note: string;
    metrics?: InsightMetrics;
}

interface SessionInsightsPanelProps {
    isOpen: boolean;
    onClose: () => void;
    sessions: SessionRef[];
    sessionMessages: Map<string, Message[]>;
    tokenUsage: Map<string, TokenUsageSnapshot>;
}

function formatDate(iso: string) {
    try {
        return new Date(iso).toLocaleString();
    } catch {
        return iso;
    }
}

export function SessionInsightsPanel({
    isOpen,
    onClose,
    sessions,
    sessionMessages,
    tokenUsage,
}: SessionInsightsPanelProps) {
    const [entries, setEntries] = useState<InsightEntry[]>([]);
    const [note, setNote] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);

    const metrics = useMemo<InsightMetrics>(() => {
        const modelMessageCounts = new Map<string, number>();
        let totalMessages = 0;
        let userMessages = 0;
        let assistantMessages = 0;
        let totalTokens = 0;
        let estimatedCost = 0;

        sessions.forEach((session) => {
            const messages = sessionMessages.get(session.id) || [];
            totalMessages += messages.length;
            messages.forEach((message) => {
                if (message.role === 'user') userMessages += 1;
                if (message.role === 'assistant') assistantMessages += 1;
            });

            const modelCount = modelMessageCounts.get(session.title) || 0;
            modelMessageCounts.set(session.title, modelCount + messages.length);

            const usage = tokenUsage.get(session.id);
            if (usage) {
                totalTokens += usage.totalTokens;
                estimatedCost += usage.estimatedCost;
            }
        });

        let topModel = 'n/a';
        let topCount = -1;
        modelMessageCounts.forEach((count, model) => {
            if (count > topCount) {
                topCount = count;
                topModel = model;
            }
        });

        return {
            activeSessions: sessions.length,
            totalMessages,
            userMessages,
            assistantMessages,
            totalTokens,
            estimatedCost,
            topModel,
        };
    }, [sessions, sessionMessages, tokenUsage]);

    useEffect(() => {
        if (!isOpen) return;

        let cancelled = false;
        const load = async () => {
            try {
                const response = await fetch(API_ENDPOINT, { cache: 'no-store' });
                if (!response.ok) throw new Error('Failed to load insights.');
                const payload = (await response.json()) as { entries?: InsightEntry[] };
                if (!cancelled) {
                    setEntries(Array.isArray(payload.entries) ? payload.entries : []);
                }
            } catch {
                if (!cancelled) {
                    setNotice('Could not load saved insights.');
                }
            }
        };

        void load();
        return () => {
            cancelled = true;
        };
    }, [isOpen]);

    const saveNote = async () => {
        if (!note.trim() || isSaving) return;

        setIsSaving(true);
        setNotice(null);
        try {
            const response = await fetch(API_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    note: note.trim(),
                    metrics,
                }),
            });
            if (!response.ok) throw new Error('Save failed.');
            const payload = (await response.json()) as { entries?: InsightEntry[] };
            setEntries(Array.isArray(payload.entries) ? payload.entries : entries);
            setNote('');
            setNotice('Insight saved.');
        } catch {
            setNotice('Could not save insight.');
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div
            className="ac-overlay fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={onClose}
        >
            <div
                className="ac-modal-shell w-full max-w-4xl h-[82vh] rounded-2xl flex flex-col overflow-hidden"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="px-5 py-3 border-b border-[color:var(--ac-border-soft)] flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-semibold text-[color:var(--ac-text)]">Session Insights</h2>
                        <p className="text-xs text-[color:var(--ac-text-dim)]">
                            Persistent learnings and run metrics for future sessions
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="control-chip p-2"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {notice && (
                    <div className="px-5 py-2 text-xs border-b border-[color:var(--ac-border-soft)] text-[color:var(--ac-text-dim)] bg-[color:var(--ac-surface)]">
                        {notice}
                    </div>
                )}

                <div className="p-5 border-b border-[color:var(--ac-border-soft)] grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                    <MetricTile label="Active Sessions" value={String(metrics.activeSessions)} />
                    <MetricTile label="Total Messages" value={String(metrics.totalMessages)} />
                    <MetricTile label="Assistant Turns" value={String(metrics.assistantMessages)} />
                    <MetricTile label="User Turns" value={String(metrics.userMessages)} />
                    <MetricTile label="Total Tokens" value={String(metrics.totalTokens)} />
                    <MetricTile label="Estimated Cost" value={`$${metrics.estimatedCost.toFixed(4)}`} />
                    <MetricTile label="Top Model" value={metrics.topModel} />
                </div>

                <div className="p-5 border-b border-[color:var(--ac-border-soft)] space-y-2">
                    <label className="text-xs text-[color:var(--ac-text-dim)] block">Capture Learning</label>
                    <textarea
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        rows={3}
                        placeholder="What worked, what slowed down, and what should we apply next session?"
                        className="ac-input px-3 py-2 text-sm resize-y"
                    />
                    <div className="flex justify-end">
                        <button
                            onClick={saveNote}
                            disabled={!note.trim() || isSaving}
                            className="ac-btn-primary px-3 py-1.5 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
                        >
                            {isSaving ? 'Saving...' : 'Save Insight'}
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-3">
                    {entries.length === 0 && (
                        <div className="text-sm text-[color:var(--ac-text-muted)]">
                            No saved insights yet.
                        </div>
                    )}
                    {entries.map((entry) => (
                        <div
                            key={entry.id}
                            className="ac-soft-surface rounded-xl p-4"
                        >
                            <div className="text-[11px] text-[color:var(--ac-text-muted)] mb-2">
                                {formatDate(entry.createdAt)}
                            </div>
                            <div className="text-sm text-[color:var(--ac-text)] whitespace-pre-wrap">
                                {entry.note}
                            </div>
                            {entry.metrics && (
                                <div className="mt-3 text-[11px] text-[color:var(--ac-text-muted)]">
                                    sessions={entry.metrics.activeSessions} | messages={entry.metrics.totalMessages} | tokens={entry.metrics.totalTokens} | cost=${entry.metrics.estimatedCost.toFixed(4)} | top={entry.metrics.topModel}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function MetricTile({ label, value }: { label: string; value: string }) {
    return (
        <div className="ac-soft-surface rounded-lg p-3">
            <div className="text-[11px] text-[color:var(--ac-text-muted)]">{label}</div>
            <div className="text-sm font-medium text-[color:var(--ac-text)] truncate">{value}</div>
        </div>
    );
}
