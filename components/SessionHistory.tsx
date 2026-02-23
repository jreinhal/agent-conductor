'use client';

import { useState } from 'react';
import { Clock, FileJson, FileText, Play, Trash2, X } from 'lucide-react';
import { useAgentStore } from '@/lib/store';
import { exportAsJSON, exportAsMarkdown } from '@/lib/export-utils';
import type { SerializedBounceSession } from '@/lib/bounce-types';

interface SessionHistoryProps {
    isOpen: boolean;
    onClose: () => void;
    onReplayDebate?: (session: SerializedBounceSession) => void;
}

export function SessionHistory({ isOpen, onClose, onReplayDebate }: SessionHistoryProps) {
    const sessions = useAgentStore((state) => state.sessions);
    const bounceHistory = useAgentStore((state) => state.debate.bounceHistory);
    const clearSessions = useAgentStore((state) => state.clearSessions);
    const clearBounceHistory = useAgentStore((state) => state.clearBounceHistory);
    const removeSession = useAgentStore((state) => state.removeSession);

    const [confirmClear, setConfirmClear] = useState(false);

    if (!isOpen) return null;

    const totalMessages = sessions.reduce(
        (sum, s) => sum + s.messages.length,
        0,
    );

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
                onClick={onClose}
                onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
                role="button"
                tabIndex={-1}
                aria-label="Close session history"
            />

            {/* Slide-over panel from left */}
            <div
                className="fixed inset-y-0 left-0 z-50 flex ac-slide-panel-enter-left"
                style={{ width: 'min(24rem, 90vw)' }}
            >
                <div className="flex-1 flex flex-col bg-[color:var(--ac-bg)] border-r border-[color:var(--ac-border)] shadow-2xl overflow-hidden">
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-[color:var(--ac-border-soft)]">
                        <div className="flex items-center gap-2">
                            <Clock className="w-4 h-4 text-[color:var(--ac-accent)]" />
                            <span className="font-semibold text-sm text-[color:var(--ac-text)]">
                                Session History
                            </span>
                        </div>
                        <button
                            onClick={onClose}
                            className="control-chip p-1.5 rounded-md"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Summary bar */}
                    <div className="px-4 py-2 border-b border-[color:var(--ac-border-soft)] flex items-center gap-3 text-xs text-[color:var(--ac-text-dim)]">
                        <span>{sessions.length} session{sessions.length !== 1 ? 's' : ''}</span>
                        <span className="w-px h-3 bg-[color:var(--ac-border)]" />
                        <span>{totalMessages} message{totalMessages !== 1 ? 's' : ''}</span>
                        <span className="w-px h-3 bg-[color:var(--ac-border)]" />
                        <span>{bounceHistory.length} debate{bounceHistory.length !== 1 ? 's' : ''}</span>
                    </div>

                    {/* Export buttons */}
                    <div className="px-4 py-2 border-b border-[color:var(--ac-border-soft)] flex items-center gap-2">
                        <button
                            onClick={() => exportAsJSON(sessions, bounceHistory)}
                            className="control-chip px-2.5 py-1.5 text-xs font-medium flex items-center gap-1.5"
                            disabled={sessions.length === 0 && bounceHistory.length === 0}
                        >
                            <FileJson className="w-3.5 h-3.5" />
                            Export JSON
                        </button>
                        <button
                            onClick={() => exportAsMarkdown(sessions, bounceHistory)}
                            className="control-chip px-2.5 py-1.5 text-xs font-medium flex items-center gap-1.5"
                            disabled={sessions.length === 0 && bounceHistory.length === 0}
                        >
                            <FileText className="w-3.5 h-3.5" />
                            Export Markdown
                        </button>
                        <div className="flex-1" />
                        {confirmClear ? (
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => {
                                        clearSessions();
                                        clearBounceHistory();
                                        setConfirmClear(false);
                                    }}
                                    className="px-2 py-1 text-xs font-medium text-red-400 hover:text-red-300 transition-colors"
                                >
                                    Confirm
                                </button>
                                <button
                                    onClick={() => setConfirmClear(false)}
                                    className="px-2 py-1 text-xs font-medium text-[color:var(--ac-text-muted)] hover:text-[color:var(--ac-text)] transition-colors"
                                >
                                    Cancel
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={() => setConfirmClear(true)}
                                className="control-chip p-1.5 text-red-400 hover:text-red-300"
                                title="Clear all history"
                                disabled={sessions.length === 0 && bounceHistory.length === 0}
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>

                    {/* Session list */}
                    <div className="flex-1 overflow-y-auto">
                        {sessions.length === 0 && bounceHistory.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-center px-6">
                                <Clock className="w-8 h-8 text-[color:var(--ac-text-muted)] mb-3" />
                                <p className="text-sm text-[color:var(--ac-text-dim)]">
                                    No sessions yet
                                </p>
                                <p className="text-xs text-[color:var(--ac-text-muted)] mt-1">
                                    Sessions and debates will appear here
                                </p>
                            </div>
                        ) : (
                            <div className="p-3 space-y-1.5">
                                {/* Active sessions */}
                                {sessions.length > 0 && (
                                    <>
                                        <p className="px-2 py-1 text-[10px] uppercase tracking-wider text-[color:var(--ac-text-muted)] font-medium">
                                            Active Sessions
                                        </p>
                                        {sessions.map((session) => {
                                            const lastMsg = session.messages[session.messages.length - 1];
                                            const preview = lastMsg
                                                ? (lastMsg.content as string).slice(0, 80)
                                                : 'No messages';
                                            return (
                                                <div
                                                    key={session.id}
                                                    className="group flex items-start gap-2.5 px-2.5 py-2 rounded-lg hover:bg-[color:var(--ac-surface)] transition-colors"
                                                >
                                                    <div className="w-2 h-2 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-1.5">
                                                            <span className="text-xs font-medium text-[color:var(--ac-text)] truncate">
                                                                {session.title}
                                                            </span>
                                                            <span className="text-[10px] text-[color:var(--ac-text-muted)]">
                                                                {session.messages.length} msg
                                                            </span>
                                                        </div>
                                                        <p className="text-[11px] text-[color:var(--ac-text-dim)] truncate mt-0.5">
                                                            {preview}
                                                        </p>
                                                    </div>
                                                    <button
                                                        onClick={() => removeSession(session.id)}
                                                        className="opacity-0 group-hover:opacity-100 p-1 text-[color:var(--ac-text-muted)] hover:text-red-400 transition-all"
                                                        title="Remove session"
                                                    >
                                                        <X className="w-3 h-3" />
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </>
                                )}

                                {/* Debate history */}
                                {bounceHistory.length > 0 && (
                                    <>
                                        <p className="px-2 py-1 mt-3 text-[10px] uppercase tracking-wider text-[color:var(--ac-text-muted)] font-medium">
                                            Past Debates
                                        </p>
                                        {bounceHistory.map((debate, i) => (
                                            <div
                                                key={`debate-${i}`}
                                                className="group flex items-start gap-2.5 px-2.5 py-2 rounded-lg hover:bg-[color:var(--ac-surface)] transition-colors"
                                            >
                                                <div className="w-2 h-2 rounded-full bg-[color:var(--ac-accent)] mt-1.5 shrink-0" />
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-xs font-medium text-[color:var(--ac-text)] truncate">
                                                            {debate.topic.slice(0, 60)}{debate.topic.length > 60 ? '...' : ''}
                                                        </span>
                                                    </div>
                                                    <p className="text-[11px] text-[color:var(--ac-text-dim)] mt-0.5">
                                                        {debate.rounds.length} round{debate.rounds.length !== 1 ? 's' : ''} &middot; {Math.round(debate.metrics.finalConsensusScore * 100)}% consensus
                                                    </p>
                                                </div>
                                                {onReplayDebate && (
                                                    <button
                                                        onClick={() => onReplayDebate(debate)}
                                                        className="opacity-0 group-hover:opacity-100 p-1 text-[color:var(--ac-text-muted)] hover:text-[color:var(--ac-accent)] transition-all"
                                                        title="Replay debate"
                                                    >
                                                        <Play className="w-3 h-3" />
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
