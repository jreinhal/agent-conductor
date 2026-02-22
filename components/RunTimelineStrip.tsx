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

    useEffect(() => {
        if (!isVisible) return;
        const frame = requestAnimationFrame(() => {
            void load();
        });
        const interval = setInterval(() => {
            void load();
        }, 4000);
        return () => {
            cancelAnimationFrame(frame);
            clearInterval(interval);
        };
    }, [isVisible, load]);

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
