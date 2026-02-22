'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

interface DecisionTraceAttempt {
    modelId: string;
    ok: boolean;
    error?: string;
}

interface DecisionTraceScores {
    codingIntent: number;
    deepReasoning: number;
    speedPreference: number;
    factualPrecision: number;
}

interface DecisionTraceEntry {
    id: string;
    createdAt: string;
    requestId?: string;
    sessionId?: string;
    requestedModel: string;
    selectedModel: string;
    executedModel: string;
    fallbackModels: string[];
    isAuto: boolean;
    reason: string;
    scores: DecisionTraceScores;
    status: 'success' | 'failed';
    attempts: DecisionTraceAttempt[];
    durationMs: number;
    latestUserMessagePreview?: string;
}

interface DecisionTraceStore {
    entries: DecisionTraceEntry[];
    updatedAt: string;
}

interface DecisionTracePanelProps {
    isOpen: boolean;
    onClose: () => void;
}

function formatDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
}

function truncate(text: string | undefined, max = 180): string {
    if (!text) return '';
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length <= max) return normalized;
    return `${normalized.slice(0, max - 1)}...`;
}

export function DecisionTracePanel({ isOpen, onClose }: DecisionTracePanelProps) {
    const [store, setStore] = useState<DecisionTraceStore | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [clearing, setClearing] = useState(false);

    const load = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const response = await fetch('/api/decision-trace', { cache: 'no-store' });
            const payload = (await response.json()) as DecisionTraceStore;
            setStore(payload);
        } catch (loadError) {
            const message = loadError instanceof Error ? loadError.message : String(loadError);
            setError(message || 'Failed to load decision trace.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!isOpen) return;
        void load();
    }, [isOpen, load]);

    const clearAll = useCallback(async () => {
        try {
            setClearing(true);
            setError(null);
            const response = await fetch('/api/decision-trace', { method: 'DELETE' });
            const payload = (await response.json()) as DecisionTraceStore;
            setStore(payload);
        } catch (clearError) {
            const message = clearError instanceof Error ? clearError.message : String(clearError);
            setError(message || 'Failed to clear decision trace.');
        } finally {
            setClearing(false);
        }
    }, []);

    const stats = useMemo(() => {
        const entries = store?.entries || [];
        const success = entries.filter((entry) => entry.status === 'success').length;
        const failed = entries.filter((entry) => entry.status === 'failed').length;
        return { total: entries.length, success, failed };
    }, [store]);

    if (!isOpen) return null;

    return (
        <div className="ac-overlay fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div
                className="ac-modal-shell w-full max-w-4xl max-h-[85vh] rounded-2xl overflow-hidden"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="px-5 py-4 border-b border-[color:var(--ac-border-soft)] flex items-center justify-between">
                    <div>
                        <h2 className="text-base font-semibold text-[color:var(--ac-text)]">Routing Trace</h2>
                        <p className="text-xs text-[color:var(--ac-text-dim)] mt-0.5">
                            Audits auto-router decisions, fallbacks, and outcomes
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => void load()}
                            className="control-chip px-3 py-1.5 text-xs"
                        >
                            Refresh
                        </button>
                        <button
                            onClick={() => void clearAll()}
                            disabled={clearing}
                            className="ac-btn-danger px-3 py-1.5 text-xs rounded-lg disabled:opacity-60"
                            style={{ background: 'color-mix(in srgb, var(--ac-danger) 16%, transparent)', color: 'var(--ac-danger)' }}
                        >
                            {clearing ? 'Clearing...' : 'Clear'}
                        </button>
                        <button
                            onClick={onClose}
                            className="control-chip p-1.5"
                            aria-label="Close"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>

                <div className="px-5 py-3 border-b border-[color:var(--ac-border-soft)] flex items-center gap-4 text-xs">
                    <span className="text-[color:var(--ac-text-dim)]">Total: <span className="text-[color:var(--ac-text)] font-medium">{stats.total}</span></span>
                    <span className="text-emerald-500">Success: {stats.success}</span>
                    <span className="text-[color:var(--ac-danger)]">Failed: {stats.failed}</span>
                    <span className="text-[color:var(--ac-text-muted)]">
                        Updated: {store?.updatedAt ? formatDate(store.updatedAt) : '-'}
                    </span>
                </div>

                <div className="overflow-y-auto max-h-[65vh] p-4 space-y-3">
                    {loading && (
                        <div className="text-sm text-[color:var(--ac-text-dim)]">Loading trace entries...</div>
                    )}
                    {error && (
                        <div className="text-sm text-[color:var(--ac-danger)]">{error}</div>
                    )}
                    {!loading && !error && (store?.entries?.length || 0) === 0 && (
                        <div className="text-sm text-[color:var(--ac-text-dim)]">No routing trace entries yet.</div>
                    )}

                    {store?.entries?.map((entry) => (
                        <div key={entry.id} className="rounded-xl border border-[color:var(--ac-border-soft)] bg-[color:var(--ac-surface-strong)]/70 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="text-xs text-[color:var(--ac-text-muted)]">{formatDate(entry.createdAt)}</div>
                                <div className={`text-xs px-2 py-0.5 rounded-full ${entry.status === 'success' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'}`}>
                                    {entry.status}
                                </div>
                            </div>

                            <div className="mt-2 text-sm text-[color:var(--ac-text)]">
                                <span className="font-medium">{entry.requestedModel}</span>
                                <span className="text-[color:var(--ac-text-muted)]"> {'->'} </span>
                                <span className="font-medium">{entry.executedModel}</span>
                                <span className="ml-2 text-xs text-[color:var(--ac-text-dim)]">({entry.isAuto ? 'auto' : 'explicit'})</span>
                            </div>

                            <div className="mt-1 text-xs text-[color:var(--ac-text-dim)]">
                                {entry.reason} · {entry.durationMs}ms
                            </div>

                            {(entry.sessionId || entry.requestId) && (
                                <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-[color:var(--ac-text-muted)]">
                                    {entry.sessionId && (
                                        <span className="ac-badge px-2 py-1 rounded">
                                            session {entry.sessionId}
                                        </span>
                                    )}
                                    {entry.requestId && (
                                        <span className="ac-badge px-2 py-1 rounded">
                                            request {entry.requestId}
                                        </span>
                                    )}
                                </div>
                            )}

                            {entry.latestUserMessagePreview && (
                                <div className="mt-2 text-xs text-[color:var(--ac-text-dim)] ac-soft-surface rounded-lg px-2 py-1.5">
                                    {truncate(entry.latestUserMessagePreview)}
                                </div>
                            )}

                            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[color:var(--ac-text-muted)]">
                                <span className="ac-badge px-2 py-1 rounded">code {entry.scores.codingIntent}</span>
                                <span className="ac-badge px-2 py-1 rounded">reason {entry.scores.deepReasoning}</span>
                                <span className="ac-badge px-2 py-1 rounded">speed {entry.scores.speedPreference}</span>
                                <span className="ac-badge px-2 py-1 rounded">facts {entry.scores.factualPrecision ?? 0}</span>
                            </div>

                            <div className="mt-2 flex flex-wrap gap-2">
                                {entry.attempts.map((attempt, index) => (
                                    <span
                                        key={`${entry.id}-${attempt.modelId}-${index}`}
                                        className={`text-[11px] px-2 py-1 rounded ${attempt.ok ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'}`}
                                        title={attempt.error || ''}
                                    >
                                        {attempt.ok ? 'OK' : 'FAIL'} {attempt.modelId}
                                    </span>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
