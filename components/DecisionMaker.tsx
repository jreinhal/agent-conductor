'use client';

import { useState } from 'react';
import { Model } from '@/lib/models'; // Use shared Model interface

interface DecisionMakerProps {
    models: Model[];
    activeSessionsCount: number;
    onDecide: (judgeModelId: string) => void;
    isProcessing: boolean;
}

export function DecisionMaker({ models, activeSessionsCount, onDecide, isProcessing }: DecisionMakerProps) {
    // Default to a strong model if available
    const defaultModel = models.find((m) =>
        m.id === 'gpt-5.3-codex' || m.id === 'claude-opus-4.6' || m.id === 'gemini-3-pro'
    )?.id || models[0]?.id;
    const [selectedJudgeId, setSelectedJudgeId] = useState<string>(defaultModel);

    // Filter for "smart" models that make good judges (optional, but good UX)
    // For now, allow all, but maybe highlight reasoning ones?
    // Let's just use the full list but sort by reasoning tag priority if we wanted.

    const handleDecide = () => {
        if (!selectedJudgeId) return;
        onDecide(selectedJudgeId);
    };

    if (activeSessionsCount < 2) return null; // Need at least 2 to debate/synthesize

    return (
        <div className="panel-shell flex items-center gap-3 rounded-xl p-2 pl-4 animate-fade-in">
            <div className="flex flex-col">
                <span className="text-[10px] uppercase font-bold tracking-wider text-[color:var(--ac-accent)]">
                    Final Decision Maker
                </span>
                <select
                    value={selectedJudgeId}
                    onChange={(e) => setSelectedJudgeId(e.target.value)}
                    className="text-xs font-medium bg-transparent border-none focus:ring-0 p-0 text-[color:var(--ac-text-dim)] cursor-pointer"
                >
                    {models.map(m => (
                        <option key={m.id} value={m.id}>
                            {m.name} {m.tags?.includes('reasoning') ? '(Recommended)' : ''}
                        </option>
                    ))}
                </select>
            </div>

            <button
                onClick={handleDecide}
                disabled={isProcessing}
                className="ac-btn-primary text-white text-xs font-bold px-4 py-2 rounded-lg flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {isProcessing ? (
                    <>
                        <svg className="animate-spin h-3 w-3 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Judging...
                    </>
                ) : (
                    <>
                        <span>Synthesize & Decide</span>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </>
                )}
            </button>
        </div>
    );
}
