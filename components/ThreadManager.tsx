'use client';

import { useState, useCallback } from 'react';
import { Message } from 'ai';

export interface Thread {
    id: string;
    title: string;
    modelId: string;
    messages: Message[];
    createdAt: number;
    updatedAt: number;
    isPinned: boolean;
    isArchived: boolean;
}

interface ThreadManagerProps {
    threads: Thread[];
    activeThreadId: string | null;
    onSelectThread: (threadId: string) => void;
    onCreateThread: () => void;
    onRenameThread: (threadId: string, newTitle: string) => void;
    onPinThread: (threadId: string) => void;
    onArchiveThread: (threadId: string) => void;
    onDeleteThread: (threadId: string) => void;
    showArchived?: boolean;
}

export function ThreadManager({
    threads,
    activeThreadId,
    onSelectThread,
    onCreateThread,
    onRenameThread,
    onPinThread,
    onArchiveThread,
    onDeleteThread,
    showArchived = false,
}: ThreadManagerProps) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editTitle, setEditTitle] = useState('');
    const [showArchivedLocal, setShowArchivedLocal] = useState(showArchived);

    // Filter and sort threads
    const activeThreads = threads
        .filter(t => !t.isArchived)
        .sort((a, b) => {
            // Pinned first, then by updated date
            if (a.isPinned && !b.isPinned) return -1;
            if (!a.isPinned && b.isPinned) return 1;
            return b.updatedAt - a.updatedAt;
        });

    const archivedThreads = threads
        .filter(t => t.isArchived)
        .sort((a, b) => b.updatedAt - a.updatedAt);

    const handleStartRename = useCallback((thread: Thread) => {
        setEditingId(thread.id);
        setEditTitle(thread.title);
    }, []);

    const handleFinishRename = useCallback(() => {
        if (editingId && editTitle.trim()) {
            onRenameThread(editingId, editTitle.trim());
        }
        setEditingId(null);
        setEditTitle('');
    }, [editingId, editTitle, onRenameThread]);

    const getModelColor = (modelId: string): string => {
        if (modelId.includes('gpt')) return 'bg-green-500';
        if (modelId.includes('claude')) return 'bg-orange-500';
        if (modelId.includes('gemini')) return 'bg-blue-500';
        if (modelId.includes('grok')) return 'bg-gray-700';
        return 'bg-purple-500';
    };

    const formatDate = (timestamp: number): string => {
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString();
    };

    return (
        <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800">
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-gray-800">
                <h2 className="text-sm font-medium text-gray-700 dark:text-gray-200">Threads</h2>
                <button
                    onClick={onCreateThread}
                    className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                    title="New Thread"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                    </svg>
                </button>
            </div>

            {/* Thread list */}
            <div className="flex-1 overflow-y-auto">
                {activeThreads.length === 0 ? (
                    <div className="p-4 text-center text-sm text-gray-400">
                        No active threads
                    </div>
                ) : (
                    <div className="py-1">
                        {activeThreads.map(thread => (
                            <ThreadItem
                                key={thread.id}
                                thread={thread}
                                isActive={thread.id === activeThreadId}
                                isEditing={editingId === thread.id}
                                editTitle={editTitle}
                                onSelect={() => onSelectThread(thread.id)}
                                onStartRename={() => handleStartRename(thread)}
                                onFinishRename={handleFinishRename}
                                onEditTitleChange={setEditTitle}
                                onPin={() => onPinThread(thread.id)}
                                onArchive={() => onArchiveThread(thread.id)}
                                onDelete={() => onDeleteThread(thread.id)}
                                getModelColor={getModelColor}
                                formatDate={formatDate}
                            />
                        ))}
                    </div>
                )}

                {/* Archived section */}
                {archivedThreads.length > 0 && (
                    <div className="border-t border-gray-200 dark:border-gray-800">
                        <button
                            onClick={() => setShowArchivedLocal(!showArchivedLocal)}
                            className="w-full flex items-center justify-between px-3 py-2 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                        >
                            <span>Archived ({archivedThreads.length})</span>
                            <svg
                                className={`w-3 h-3 transition-transform ${showArchivedLocal ? 'rotate-180' : ''}`}
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>

                        {showArchivedLocal && (
                            <div className="py-1 bg-gray-100/50 dark:bg-gray-800/50">
                                {archivedThreads.map(thread => (
                                    <ThreadItem
                                        key={thread.id}
                                        thread={thread}
                                        isActive={thread.id === activeThreadId}
                                        isEditing={editingId === thread.id}
                                        editTitle={editTitle}
                                        onSelect={() => onSelectThread(thread.id)}
                                        onStartRename={() => handleStartRename(thread)}
                                        onFinishRename={handleFinishRename}
                                        onEditTitleChange={setEditTitle}
                                        onPin={() => onPinThread(thread.id)}
                                        onArchive={() => onArchiveThread(thread.id)}
                                        onDelete={() => onDeleteThread(thread.id)}
                                        getModelColor={getModelColor}
                                        formatDate={formatDate}
                                        isArchived
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

interface ThreadItemProps {
    thread: Thread;
    isActive: boolean;
    isEditing: boolean;
    editTitle: string;
    onSelect: () => void;
    onStartRename: () => void;
    onFinishRename: () => void;
    onEditTitleChange: (title: string) => void;
    onPin: () => void;
    onArchive: () => void;
    onDelete: () => void;
    getModelColor: (modelId: string) => string;
    formatDate: (timestamp: number) => string;
    isArchived?: boolean;
}

function ThreadItem({
    thread,
    isActive,
    isEditing,
    editTitle,
    onSelect,
    onStartRename,
    onFinishRename,
    onEditTitleChange,
    onPin,
    onArchive,
    onDelete,
    getModelColor,
    formatDate,
    isArchived = false,
}: ThreadItemProps) {
    const [showMenu, setShowMenu] = useState(false);

    return (
        <div
            className={`
                group relative px-3 py-2 cursor-pointer transition-colors
                ${isActive
                    ? 'bg-blue-50 dark:bg-blue-900/20 border-l-2 border-blue-500'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-800 border-l-2 border-transparent'}
                ${isArchived ? 'opacity-60' : ''}
            `}
            onClick={onSelect}
        >
            <div className="flex items-start gap-2">
                {/* Model indicator */}
                <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${getModelColor(thread.modelId)}`} />

                <div className="flex-1 min-w-0">
                    {/* Title */}
                    {isEditing ? (
                        <input
                            type="text"
                            value={editTitle}
                            onChange={(e) => onEditTitleChange(e.target.value)}
                            onBlur={onFinishRename}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') onFinishRename();
                                if (e.key === 'Escape') onFinishRename();
                            }}
                            className="w-full text-sm bg-white dark:bg-gray-800 border border-blue-500 rounded px-1 py-0.5 focus:outline-none"
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                        />
                    ) : (
                        <div className="flex items-center gap-1">
                            {thread.isPinned && (
                                <svg className="w-3 h-3 text-yellow-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                    <path d="M10 2a1 1 0 00-1 1v1.323l-3.954 1.582A1 1 0 004 6.82V7.5l3.5 2L5 14l1-1 2.5 1.5L10 18l1.5-3.5L14 13l-1 1-2.5-4.5 3.5-2v-.68a1 1 0 00-1.046-.915L10 4.323V3a1 1 0 00-1-1z" />
                                </svg>
                            )}
                            <span className="text-sm text-gray-700 dark:text-gray-200 truncate">
                                {thread.title}
                            </span>
                        </div>
                    )}

                    {/* Meta info */}
                    <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-400">
                        <span>{thread.messages.length} messages</span>
                        <span>·</span>
                        <span>{formatDate(thread.updatedAt)}</span>
                    </div>
                </div>

                {/* Actions menu */}
                <div className="relative">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setShowMenu(!showMenu);
                        }}
                        className="p-1 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded transition-all"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                        </svg>
                    </button>

                    {showMenu && (
                        <>
                            <div
                                className="fixed inset-0 z-10"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setShowMenu(false);
                                }}
                            />
                            <div className="absolute right-0 top-full mt-1 w-32 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-20 py-1">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onStartRename();
                                        setShowMenu(false);
                                    }}
                                    className="w-full px-3 py-1.5 text-left text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                                >
                                    Rename
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onPin();
                                        setShowMenu(false);
                                    }}
                                    className="w-full px-3 py-1.5 text-left text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                                >
                                    {thread.isPinned ? 'Unpin' : 'Pin'}
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onArchive();
                                        setShowMenu(false);
                                    }}
                                    className="w-full px-3 py-1.5 text-left text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                                >
                                    {isArchived ? 'Unarchive' : 'Archive'}
                                </button>
                                <div className="border-t border-gray-100 dark:border-gray-700 my-1" />
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onDelete();
                                        setShowMenu(false);
                                    }}
                                    className="w-full px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                                >
                                    Delete
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
