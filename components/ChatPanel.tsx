'use client';

import { useRef, useEffect, forwardRef, useImperativeHandle, useCallback, useState } from 'react';
import { Message } from 'ai';
import { useChat } from '@ai-sdk/react';
import { Session } from '@/lib/types';
import { useAgentStore } from '@/lib/store';

interface ChatPanelProps {
    session: Session;
    onClose?: () => void;
    onMessagesUpdate?: (messages: Message[]) => void;
    onBounce?: (content: string) => void;
    compact?: boolean;
}

export interface ChatPanelRef {
    sendMessage: (content: string) => void;
    isLoading: boolean;
}

// Provider configuration with colors and icons
const PROVIDER_CONFIG: Record<string, { color: string; bgColor: string; icon: string }> = {
    openai: { color: 'text-emerald-500', bgColor: 'bg-emerald-500', icon: '🟢' },
    anthropic: { color: 'text-orange-500', bgColor: 'bg-orange-500', icon: '🟠' },
    google: { color: 'text-blue-500', bgColor: 'bg-blue-500', icon: '🔵' },
    xai: { color: 'text-gray-400', bgColor: 'bg-gray-600', icon: '⚫' },
    local: { color: 'text-purple-500', bgColor: 'bg-purple-500', icon: '🟣' },
};

const getProviderFromModel = (modelId: string): string => {
    if (modelId.includes('gpt') || modelId.includes('o1') || modelId.includes('o3') || modelId.includes('o4')) return 'openai';
    if (modelId.includes('claude')) return 'anthropic';
    if (modelId.includes('gemini')) return 'google';
    if (modelId.includes('grok')) return 'xai';
    return 'local';
};

export const ChatPanel = forwardRef<ChatPanelRef, ChatPanelProps>(({
    session,
    onClose,
    onMessagesUpdate,
    onBounce,
    compact = false,
}, ref) => {
    const sharedContext = useAgentStore((state) => state.sharedContext);
    const scrollRef = useRef<HTMLDivElement>(null);
    const [isHovered, setIsHovered] = useState(false);

    const chatHook = useChat({
        api: '/api/chat',
        body: {
            model: session.modelId,
            system: `${sharedContext ? `# SHARED PROJECT CONTEXT:\n${sharedContext}\n\n---\n\n` : ''}${session.systemPrompt || ''}`,
            config: session.config
        },
    });

    const { messages, isLoading, error, reload } = chatHook;

    // Stable sendMessage function
    const sendMessage = useCallback((content: string) => {
        if (chatHook.append && typeof chatHook.append === 'function') {
            chatHook.append({ role: 'user', content });
        }
    }, [chatHook]);

    // Expose methods to parent
    useImperativeHandle(ref, () => ({
        sendMessage,
        isLoading,
    }), [sendMessage, isLoading]);

    // Track last reported message count to avoid infinite loops
    const lastReportedCountRef = useRef(0);

    // Report messages to parent only when message count changes
    useEffect(() => {
        if (onMessagesUpdate && messages.length > 0 && messages.length !== lastReportedCountRef.current) {
            lastReportedCountRef.current = messages.length;
            onMessagesUpdate(messages);
        }
    }, [messages.length, onMessagesUpdate]);

    // Auto-scroll
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    const provider = getProviderFromModel(session.modelId);
    const providerConfig = PROVIDER_CONFIG[provider] || PROVIDER_CONFIG.local;

    return (
        <div
            className={`
                flex flex-col bg-white dark:bg-[#14141a] rounded-xl border border-gray-200 dark:border-[#2a2a38] overflow-hidden
                shadow-sm hover:shadow-md
                ${compact ? 'h-[400px]' : 'h-[600px]'}
                ${isHovered ? 'border-gray-300 dark:border-[#3a3a48]' : ''}
            `}
            style={{
                transition: 'box-shadow 300ms cubic-bezier(0.25, 0.1, 0.25, 1), border-color 250ms cubic-bezier(0.25, 0.1, 0.25, 1)'
            }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            {/* Enhanced header with provider indicator */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-[#1f1f2a] bg-gray-50/50 dark:bg-[#18181f]/50">
                <div className="flex items-center gap-3">
                    {/* Provider indicator dot with glow effect when loading */}
                    <div className="relative">
                        <div className={`w-2.5 h-2.5 rounded-full ${providerConfig.bgColor} ${isLoading ? 'animate-pulse' : ''}`} />
                        {isLoading && (
                            <div className={`absolute inset-0 w-2.5 h-2.5 rounded-full ${providerConfig.bgColor} animate-ping opacity-75`} />
                        )}
                    </div>
                    <div className="flex flex-col">
                        <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate max-w-[180px]">
                            {session.title}
                        </span>
                        {isLoading && (
                            <span className="text-[10px] text-gray-400 dark:text-gray-500">
                                Generating...
                            </span>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    {error && (
                        <button
                            onClick={() => reload()}
                            className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg hover:scale-105 active:scale-95"
                            style={{
                                transition: 'transform 250ms cubic-bezier(0.175, 0.885, 0.32, 1.1), background-color 150ms cubic-bezier(0.25, 0.1, 0.25, 1)',
                                WebkitTapHighlightColor: 'transparent'
                            }}
                            title="Retry"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                        </button>
                    )}
                    {onClose && (
                        <button
                            onClick={onClose}
                            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#2a2a38] rounded-lg active:scale-95"
                            style={{
                                transition: 'color 200ms cubic-bezier(0.25, 0.1, 0.25, 1), background-color 150ms cubic-bezier(0.25, 0.1, 0.25, 1), transform 100ms cubic-bezier(0, 0, 0.2, 1)',
                                WebkitTapHighlightColor: 'transparent'
                            }}
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    )}
                </div>
            </div>

            {/* Messages with iOS scroll behavior */}
            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto p-4 space-y-4 scrollable"
                style={{ WebkitOverflowScrolling: 'touch' }}
            >
                {messages.length === 0 && !error && (
                    <div className="h-full flex flex-col items-center justify-center text-gray-400 dark:text-gray-500">
                        <div className="w-12 h-12 mb-3 rounded-full bg-gray-100 dark:bg-[#1f1f2a] flex items-center justify-center">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                            </svg>
                        </div>
                        <p className="text-sm font-medium">Waiting for input...</p>
                        <p className="text-xs mt-1 text-gray-400 dark:text-gray-600">Messages will appear here</p>
                    </div>
                )}

                {error && messages.length === 0 && (
                    <div className="p-4 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/50 rounded-xl animate-fadeIn">
                        <div className="flex items-start gap-3">
                            <div className="p-1.5 bg-red-100 dark:bg-red-900/30 rounded-lg">
                                <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            </div>
                            <div>
                                <p className="text-sm font-medium text-red-700 dark:text-red-400">Error</p>
                                <p className="text-sm text-red-600 dark:text-red-300 mt-0.5">{error.message}</p>
                            </div>
                        </div>
                    </div>
                )}

                {messages.map((m, index) => (
                    <div
                        key={m.id}
                        className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} group`}
                        style={{
                            animation: `slideInUp 300ms cubic-bezier(0.32, 0.72, 0, 1) forwards`,
                            animationDelay: `${index * 40}ms`,
                            opacity: 0
                        }}
                    >
                        <div
                            className={`
                                max-w-[88%] rounded-2xl px-4 py-2.5 text-sm relative
                                ${m.role === 'user'
                                    ? 'bg-gray-100 dark:bg-[#2a2a38] text-gray-900 dark:text-gray-100 rounded-br-md'
                                    : 'bg-white dark:bg-[#1a1a24] border border-gray-100 dark:border-[#2a2a38] text-gray-700 dark:text-gray-300 rounded-bl-md shadow-sm'}
                            `}
                            style={{
                                transition: 'background-color 200ms cubic-bezier(0.25, 0.1, 0.25, 1)'
                            }}
                        >
                            <div className="whitespace-pre-wrap break-words leading-relaxed">{m.content}</div>
                            {/* Bounce button for assistant messages - shows on hover */}
                            {m.role === 'assistant' && onBounce && (
                                <button
                                    onClick={() => onBounce(m.content)}
                                    className="absolute -right-2 -bottom-2 opacity-0 group-hover:opacity-100 p-2 bg-purple-500 hover:bg-purple-600 text-white rounded-full shadow-lg hover:scale-105 active:scale-95 hover:shadow-purple-500/25"
                                    style={{
                                        transition: 'opacity 200ms cubic-bezier(0.25, 0.1, 0.25, 1), transform 250ms cubic-bezier(0.175, 0.885, 0.32, 1.1), background-color 150ms cubic-bezier(0.25, 0.1, 0.25, 1)',
                                        WebkitTapHighlightColor: 'transparent'
                                    }}
                                    title="Start Multi-Model Debate"
                                >
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                                    </svg>
                                </button>
                            )}
                        </div>
                    </div>
                ))}

                {isLoading && (
                    <div className="flex justify-start animate-fadeIn">
                        <div className="px-4 py-3 bg-white dark:bg-[#1a1a24] border border-gray-100 dark:border-[#2a2a38] rounded-2xl rounded-bl-md shadow-sm">
                            <div className="flex items-center gap-1.5">
                                <div className={`w-2 h-2 rounded-full ${providerConfig.bgColor} animate-bounce`} style={{ animationDelay: '0ms' }} />
                                <div className={`w-2 h-2 rounded-full ${providerConfig.bgColor} animate-bounce`} style={{ animationDelay: '150ms' }} />
                                <div className={`w-2 h-2 rounded-full ${providerConfig.bgColor} animate-bounce`} style={{ animationDelay: '300ms' }} />
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
});

ChatPanel.displayName = 'ChatPanel';
