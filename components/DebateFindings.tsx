'use client';

import { useState, useMemo } from 'react';
import {
    CheckCircle2,
    AlertCircle,
    Brain,
    Plus,
    X,
    ChevronDown,
    ChevronUp,
} from 'lucide-react';
import { useAgentStore } from '@/lib/store';
import { DebateFindings as DebateFindingsType } from '@/lib/bounce-types';

interface DebateFindingsProps {
    findings: DebateFindingsType;
    onDismiss?: () => void;
}

export function DebateFindings({ findings, onDismiss }: DebateFindingsProps) {
    const addKnowledgeEntries = useAgentStore((state) => state.addKnowledgeEntries);
    const sharedKnowledge = useAgentStore((state) => state.sharedKnowledge);

    const [selectedIds, setSelectedIds] = useState<Set<string>>(() =>
        new Set(findings.agreements.map(a => a.id))
    );
    const [expanded, setExpanded] = useState(true);
    const [added, setAdded] = useState(false);

    const alreadySaved = useMemo(() => {
        const savedIds = new Set(sharedKnowledge.map(e => e.id));
        return findings.agreements.filter(a => savedIds.has(a.id));
    }, [sharedKnowledge, findings.agreements]);

    const newFindings = useMemo(() => {
        const savedIds = new Set(sharedKnowledge.map(e => e.id));
        return findings.agreements.filter(a => !savedIds.has(a.id));
    }, [sharedKnowledge, findings.agreements]);

    const toggleSelection = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleAddToKnowledge = () => {
        const entriesToAdd = findings.agreements.filter(a => selectedIds.has(a.id));
        if (entriesToAdd.length > 0) {
            addKnowledgeEntries(entriesToAdd);
            setAdded(true);
        }
    };

    const selectableCount = newFindings.filter(f => selectedIds.has(f.id)).length;

    if (findings.agreements.length === 0 && findings.disputes.length === 0) {
        return null;
    }

    return (
        <div className="bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 rounded-lg overflow-hidden">
            {/* Header */}
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-indigo-100/50 dark:hover:bg-indigo-900/30 transition-colors"
            >
                <div className="flex items-center gap-2">
                    <Brain className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    <span className="text-sm font-semibold text-indigo-700 dark:text-indigo-300">
                        Debate Findings
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-200 dark:bg-indigo-800 text-indigo-700 dark:text-indigo-300">
                        {findings.agreements.length} agreed, {findings.disputes.length} disputed
                    </span>
                </div>
                {expanded
                    ? <ChevronUp className="w-4 h-4 text-indigo-500" />
                    : <ChevronDown className="w-4 h-4 text-indigo-500" />
                }
            </button>

            {expanded && (
                <div className="px-4 pb-4">
                    {/* Agreed Points */}
                    {newFindings.length > 0 && (
                        <div className="mb-3">
                            <div className="flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400 mb-2">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Points of Agreement
                            </div>
                            <div className="space-y-1.5">
                                {newFindings.map((entry) => (
                                    <label
                                        key={entry.id}
                                        className="flex items-start gap-2 p-2 rounded-md bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.has(entry.id)}
                                            onChange={() => toggleSelection(entry.id)}
                                            disabled={added}
                                            className="mt-0.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                        />
                                        <div className="flex-1 min-w-0">
                                            <span className="text-sm text-gray-700 dark:text-gray-300">
                                                {entry.finding}
                                            </span>
                                            <div className="text-xs text-gray-400 mt-0.5">
                                                {Math.round(entry.confidence * 100)}% consensus
                                            </div>
                                        </div>
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Already saved */}
                    {alreadySaved.length > 0 && (
                        <div className="mb-3">
                            <div className="text-xs text-gray-400 mb-1">Already in knowledge base:</div>
                            <div className="space-y-1">
                                {alreadySaved.map((entry) => (
                                    <div
                                        key={entry.id}
                                        className="flex items-start gap-2 p-2 rounded-md bg-gray-50 dark:bg-gray-800/30 text-gray-400 text-sm"
                                    >
                                        <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-green-400" />
                                        {entry.finding}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Disputed Points */}
                    {findings.disputes.length > 0 && (
                        <div className="mb-3">
                            <div className="flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400 mb-2">
                                <AlertCircle className="w-3.5 h-3.5" />
                                Remaining Disputes
                            </div>
                            <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1 pl-5 list-disc">
                                {findings.disputes.map((point, idx) => (
                                    <li key={idx}>{point}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 mt-3">
                        {!added && newFindings.length > 0 ? (
                            <button
                                onClick={handleAddToKnowledge}
                                disabled={selectableCount === 0}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 dark:disabled:bg-indigo-800 text-white text-sm font-medium rounded-lg transition-colors"
                            >
                                <Plus className="w-3.5 h-3.5" />
                                Add {selectableCount} to Knowledge Base
                            </button>
                        ) : added ? (
                            <span className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400 font-medium">
                                <CheckCircle2 className="w-4 h-4" />
                                Added to knowledge base
                            </span>
                        ) : null}
                        {onDismiss && (
                            <button
                                onClick={onDismiss}
                                className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                            >
                                <X className="w-3.5 h-3.5" />
                                Dismiss
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
