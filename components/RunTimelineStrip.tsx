'use client';

import { useCallback, useEffect, useState } from 'react';

interface DecisionTraceEntry {
    id: string;
    createdAt: string;
    requestedModel: string;
    selectedModel: string;
    executedModel: string;
    status: 'success' | 'failed';
    isAuto: boolean;
    durationMs: number;
}

interface DecisionTraceStore {
    entries: DecisionTraceEntry[];
}

interface RunTimelineStripProps {
    isVisible: boolean;
    onOpenTrace: () => void;
}

const ACTIVE_RECENCY_WINDOW_MS = 20_000;
const WARM_RECENCY_WINDOW_MS = 90_000;
const TIMELY_RESPONSE_MAX_MS = 12_000;
const FAST_POLL_MS = 750;
const WARM_POLL_MS = 1_400;
const IDLE_POLL_MS = 3_500;
const HIDDEN_POLL_MS = 6_000;

function formatTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function truncateModel(modelId: string, max = 22): string {
    if (modelId.length <= max) return modelId;
    return `${modelId.slice(0, max - 1)}...`;
}

export function RunTimelineStrip({ isVisible, onOpenTrace }: RunTimelineStripProps) {
    const [entries, setEntries] = useState<DecisionTraceEntry[]>([]);

    const load = useCallback(async () => {
        if (!isVisible) return;
        try {
            const response = await fetch('/api/decision-trace?limit=12', {
                cache: 'no-store',
            });
            const payload = (await response.json()) as DecisionTraceStore;
            setEntries(Array.isArray(payload.entries) ? payload.entries : []);
        } catch {
            // Timeline is best-effort only.
        }
    }, [isVisible]);

    const getNextPollMs = useCallback(() => {
        if (typeof document !== 'undefined' && document.hidden) {
            return HIDDEN_POLL_MS;
        }

        if (entries.length === 0) {
            return IDLE_POLL_MS;
        }

        const newest = entries[0];
        const newestTimestamp = Date.parse(newest.createdAt);
        const recencyMs = Number.isFinite(newestTimestamp) ? Date.now() - newestTimestamp : Number.POSITIVE_INFINITY;
        const recentlyActive = recencyMs <= ACTIVE_RECENCY_WINDOW_MS;
        const recentlyWarm = recencyMs <= WARM_RECENCY_WINDOW_MS;

        const recentSample = entries.slice(0, 4);
        const allTimely = recentSample.length > 0 && recentSample.every((entry) =>
            entry.status === 'success' &&
            Number.isFinite(entry.durationMs) &&
            entry.durationMs > 0 &&
            entry.durationMs <= TIMELY_RESPONSE_MAX_MS
        );

        if (recentlyActive && allTimely) return FAST_POLL_MS;
        if (recentlyWarm) return WARM_POLL_MS;
        return IDLE_POLL_MS;
    }, [entries]);

    useEffect(() => {
        if (!isVisible) return;
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const poll = async () => {
            await load();
            if (cancelled) return;
            timer = setTimeout(() => {
                void poll();
            }, getNextPollMs());
        };

        const frame = requestAnimationFrame(() => {
            void poll();
        });

        return () => {
            cancelled = true;
            cancelAnimationFrame(frame);
            if (timer) {
                clearTimeout(timer);
            }
        };
    }, [isVisible, load, getNextPollMs]);

    if (!isVisible) return null;

    return (
        <div className="timeline-strip px-4 sm:px-6 py-2.5 relative z-20">
            <div className="flex items-center justify-between gap-2 mb-2">
                <div className="text-[11px] uppercase tracking-[0.14em] text-[color:var(--ac-text-muted)]">
                    Recent Runs
                </div>
                <button
                    onClick={onOpenTrace}
                    className="control-chip text-[11px] px-2.5 py-1"
                >
                    Open Trace
                </button>
            </div>
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {entries.length === 0 ? (
                    <span className="text-xs text-[color:var(--ac-text-muted)]">No runs yet.</span>
                ) : (
                    entries.map((entry) => (
                        <div
                            key={entry.id}
                            className="timeline-chip shrink-0 flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px]"
                            title={`${entry.requestedModel} -> ${entry.executedModel} | ${entry.isAuto ? 'auto' : 'explicit'} | ${entry.durationMs}ms`}
                        >
                            <span
                                className={`w-1.5 h-1.5 rounded-full ${entry.status === 'success' ? 'bg-emerald-500' : 'bg-red-500'}`}
                            />
                            <span className="text-[color:var(--ac-text-dim)]">
                                {truncateModel(entry.requestedModel)}
                                <span className="mx-1 text-gray-400">{'->'}</span>
                                {truncateModel(entry.executedModel)}
                            </span>
                            <span className="text-[color:var(--ac-text-muted)]">{entry.durationMs}ms</span>
                            <span className="text-[color:var(--ac-text-muted)]">{formatTime(entry.createdAt)}</span>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
