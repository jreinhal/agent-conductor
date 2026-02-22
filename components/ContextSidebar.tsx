'use client';

import { useAgentStore } from '@/lib/store';
import { SharedKnowledgeEntry } from '@/lib/bounce-types';

export function ContextSidebar() {
    const sharedContext = useAgentStore((state) => state.sharedContext);
    const setSharedContext = useAgentStore((state) => state.setSharedContext);
    const sharedKnowledge = useAgentStore((state) => state.sharedKnowledge);
    const removeKnowledgeEntry = useAgentStore((state) => state.removeKnowledgeEntry);
    const clearKnowledge = useAgentStore((state) => state.clearKnowledge);
    const isSidebarOpen = useAgentStore((state) => state.ui.isSidebarOpen);
    const toggleSidebar = useAgentStore((state) => state.toggleSidebar);

    return (
        <>
            {/* Backdrop */}
            <div
                className={`fixed inset-0 bg-black/20 backdrop-blur-sm z-40 transition-opacity duration-300 ${isSidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
                    }`}
                onClick={toggleSidebar}
            />

            {/* Sidebar Panel */}
            <div
                className={`fixed inset-y-0 right-0 z-50 w-full md:w-96 ac-modal-shell border-l border-[color:var(--ac-border-soft)] transform transition-transform duration-300 ease-in-out shadow-2xl ${isSidebarOpen ? 'translate-x-0' : 'translate-x-full'
                    }`}
            >
                <div className="flex flex-col h-full">
                    {/* Header */}
                    <div className="flex items-center justify-between p-4 border-b border-[color:var(--ac-border-soft)] bg-[color:var(--ac-surface)]/90 backdrop-blur-md">
                        <h2 className="text-lg font-semibold text-[color:var(--ac-text)] flex items-center gap-2">
                            <span className="text-xl">🧠</span> Project Memory
                        </h2>
                        <button
                            onClick={toggleSidebar}
                            className="control-chip p-2 rounded-full transition-colors"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>

                    {/* Content */}
                    <div className="flex-1 p-4 overflow-y-auto">
                        {/* Shared Context */}
                        <div className="mb-6">
                            <div className="prose prose-sm dark:prose-invert mb-4">
                                <p className="text-[color:var(--ac-text-dim)] text-sm">
                                    Instructions added here will be injected into <strong>every</strong> agent&apos;s system prompt.
                                    Use this to define your tech stack, coding standards, or project goals.
                                </p>
                            </div>

                            <textarea
                                value={sharedContext}
                                onChange={(e) => setSharedContext(e.target.value)}
                                placeholder="# Project Context&#10;&#10;- Tech Stack: Next.js 14, Tailwind&#10;- Style: Functional components&#10;- Rules: No useEffect without dependency array..."
                                className="ac-input w-full h-48 p-4 resize-none font-mono text-sm leading-relaxed transition-all"
                            />
                        </div>

                        {/* Debate Knowledge Base */}
                        <div>
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-sm font-semibold text-[color:var(--ac-text-dim)] flex items-center gap-1.5">
                                    <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                    </svg>
                                    Debate Findings
                                    {sharedKnowledge.length > 0 && (
                                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300">
                                            {sharedKnowledge.length}
                                        </span>
                                    )}
                                </h3>
                                {sharedKnowledge.length > 0 && (
                                    <button
                                        onClick={clearKnowledge}
                                        className="text-xs text-[color:var(--ac-text-muted)] hover:text-red-500 transition-colors"
                                    >
                                        Clear all
                                    </button>
                                )}
                            </div>

                            {sharedKnowledge.length === 0 ? (
                                <p className="text-xs text-[color:var(--ac-text-muted)] italic">
                                    No findings yet. Run a debate and add agreed-upon points to build shared knowledge.
                                </p>
                            ) : (
                                <div className="space-y-2">
                                    {sharedKnowledge.map((entry) => (
                                        <KnowledgeEntryCard
                                            key={entry.id}
                                            entry={entry}
                                            onRemove={() => removeKnowledgeEntry(entry.id)}
                                        />
                                    ))}
                                </div>
                            )}

                            {sharedKnowledge.length > 0 && (
                                <p className="text-xs text-[color:var(--ac-text-muted)] mt-3">
                                    These findings are automatically injected into all model prompts.
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="p-4 border-t border-[color:var(--ac-border-soft)] bg-[color:var(--ac-surface)]/70 text-xs text-center text-[color:var(--ac-text-muted)]">
                        Auto-saved locally
                    </div>
                </div>
            </div>
        </>
    );
}

function KnowledgeEntryCard({
    entry,
    onRemove,
}: {
    entry: SharedKnowledgeEntry;
    onRemove: () => void;
}) {
    const date = new Date(entry.capturedAt);
    const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

    return (
        <div className="group relative p-3 ac-soft-surface rounded-lg">
            <button
                onClick={onRemove}
                className="absolute top-2 right-2 p-1 rounded-full opacity-0 group-hover:opacity-100 hover:bg-red-100 dark:hover:bg-red-900/30 text-[color:var(--ac-text-muted)] hover:text-red-500 transition-all"
                title="Remove finding"
            >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
            <p className="text-sm text-[color:var(--ac-text-dim)] pr-6">{entry.finding}</p>
            <div className="mt-1.5 flex items-center gap-2 text-xs text-[color:var(--ac-text-muted)]">
                <span>{Math.round(entry.confidence * 100)}% consensus</span>
                <span>·</span>
                <span>{entry.participants.join(', ')}</span>
                <span>·</span>
                <span>{dateStr}</span>
            </div>
            <div className="mt-1 text-xs text-[color:var(--ac-text-muted)] truncate" title={entry.debateTopic}>
                From: {entry.debateTopic.slice(0, 60)}{entry.debateTopic.length > 60 ? '...' : ''}
            </div>
        </div>
    );
}
