'use client';

import { useChat } from '@ai-sdk/react';
import { useRef, useEffect, useState } from 'react';
import { Message } from 'ai';
import { Session } from '@/lib/types';
import { useAgentStore } from '@/lib/store';
import { formatKnowledgeForPrompt } from '@/lib/consensus-analyzer';
import { scanForPII, PIIFinding } from '@/lib/guardrails';
import { logAuditEvent } from '@/lib/audit-log';

interface ChatWindowProps {
    session: Session;
    onClose?: () => void;
    onBounce?: (content: string) => void;
    onFinish?: (content: string) => void;
    onMessagesUpdate?: (messages: Message[]) => void;
}

// Error display component
function ErrorDisplay({ error, onRetry }: { error: Error; onRetry: () => void }) {
    const errorMessage = error.message || 'An unexpected error occurred';
    const isRateLimit = errorMessage.toLowerCase().includes('rate limit');
    const isApiKey = errorMessage.toLowerCase().includes('api key') || errorMessage.toLowerCase().includes('unauthorized');
    const isNetwork = errorMessage.toLowerCase().includes('network') || errorMessage.toLowerCase().includes('fetch');

    let title = 'Error';
    let suggestion = 'Please try again.';

    if (isRateLimit) {
        title = 'Rate Limited';
        suggestion = 'Wait a moment before trying again, or switch to a different model.';
    } else if (isApiKey) {
        title = 'Authentication Error';
        suggestion = 'Check your API key configuration in .env.local';
    } else if (isNetwork) {
        title = 'Network Error';
        suggestion = 'Check your internet connection and try again.';
    }

    return (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-2">
            <div className="flex items-start gap-2">
                <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-red-800 dark:text-red-200">{title}</p>
                    <p className="text-xs text-red-600 dark:text-red-300 mt-0.5 break-words">{errorMessage}</p>
                    <p className="text-xs text-red-500 dark:text-red-400 mt-1">{suggestion}</p>
                </div>
            </div>
            <button
                onClick={onRetry}
                className="mt-2 w-full text-xs px-3 py-1.5 bg-red-100 dark:bg-red-800/30 hover:bg-red-200 dark:hover:bg-red-800/50 text-red-700 dark:text-red-300 rounded transition-colors"
            >
                Retry
            </button>
        </div>
    );
}

export function ChatWindow({ session, onClose, onBounce, onFinish, onMessagesUpdate }: ChatWindowProps) {
    const sharedContext = useAgentStore((state) => state.sharedContext);
    const sharedKnowledge = useAgentStore((state) => state.sharedKnowledge);
    const [piiWarning, setPiiWarning] = useState<PIIFinding[] | null>(null);
    const [retryCount, setRetryCount] = useState(0);

    const knowledgeBlock = formatKnowledgeForPrompt(sharedKnowledge);
    const systemParts = [
        sharedContext ? `# SHARED PROJECT CONTEXT:\n${sharedContext}` : '',
        knowledgeBlock,
        session.systemPrompt || '',
    ].filter(Boolean).join('\n\n---\n\n');

    const { messages, input, handleInputChange, append, isLoading, setInput, error, reload } = useChat({
        api: '/api/chat',
        body: {
            model: session.modelId,
            system: systemParts,
            config: session.config
        },
        onFinish: (message) => {
            if (onFinish) onFinish(message.content);
        },
        onError: (err) => {
            console.error(`[${session.title}] Chat error:`, err);
        }
    });

    const scrollRef = useRef<HTMLDivElement>(null);

    // Report messages to parent/store whenever they change
    useEffect(() => {
        if (onMessagesUpdate && messages.length > 0) {
            onMessagesUpdate(messages);
        }
    }, [messages, onMessagesUpdate]);

    // Auto-scroll
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    const handleSafeSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!input?.trim()) return;

        const pii = scanForPII(input);

        if (pii.length > 0) {
            setPiiWarning(pii);
            return;
        }

        setRetryCount(0);
        append({ role: 'user', content: input });
        setInput('');
    };

    const confirmSend = () => {
        logAuditEvent('PII_OVERRIDE', `User bypassed PII warning. Findings: ${piiWarning?.map(f => f.type).join(', ')}`, 'high');
        setPiiWarning(null);
        setRetryCount(0);
        append({ role: 'user', content: input });
        setInput('');
    };

    const cancelSend = () => {
        setPiiWarning(null);
    };

    const handleRetry = () => {
        setRetryCount(prev => prev + 1);
        reload();
    };

    return (
        <div className="flex flex-col h-[600px] bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden flex-shrink-0 min-w-[350px] relative">

            {/* PII Warning Overlay */}
            {piiWarning && (
                <div className="absolute inset-0 z-[100] bg-white/95 dark:bg-gray-900/95 flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-200">
                    <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-full mb-4">
                        <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                    </div>
                    <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">Sentinel Guardrail Alert</h3>
                    <p className="text-sm text-gray-500 mb-4 max-w-xs">
                        Cipher has detected sensitive information (PII) in your message:
                    </p>
                    <div className="bg-gray-100 dark:bg-gray-800 rounded-md p-3 mb-6 w-full max-w-xs text-left text-xs font-mono border border-gray-200 dark:border-gray-700">
                        {piiWarning.map((f, i) => (
                            <div key={i} className="text-red-500 flex justify-between">
                                <span>{f.type.toUpperCase()}:</span>
                                <span>{f.value}</span>
                            </div>
                        ))}
                    </div>
                    <div className="flex gap-3">
                        <button
                            onClick={cancelSend}
                            className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-300 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={confirmSend}
                            className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
                        >
                            Send Anyway (Unsafe)
                        </button>
                    </div>
                </div>
            )}

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
                <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full animate-pulse ${session.isPersona ? 'bg-purple-500' : 'bg-green-500'}`}></div>
                    <div>
                        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200 flex items-center gap-2">
                            {session.title}
                            <span className="text-[10px] bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 px-1.5 py-0.5 rounded border border-green-200 dark:border-green-800" title="Shield Active">🛡️</span>
                        </h3>
                        <p className="text-[10px] text-gray-400 capitalize">{session.modelId}</p>
                    </div>
                </div>
                {/* Close Button */}
                <div className="flex items-center gap-2">
                    {error && (
                        <span className="text-[10px] text-red-500 flex items-center gap-1">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                            Error
                        </span>
                    )}
                    {onClose && (
                        <button
                            onClick={onClose}
                            className="text-gray-400 hover:text-red-500 transition-colors"
                            title="Close Chat"
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    )}
                </div>
            </div>

            {/* Messages */}
            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50/30 dark:bg-black/20"
            >
                {messages.length === 0 && !error && (
                    <div className="h-full flex flex-col items-center justify-center text-gray-400 text-xs text-center px-4">
                        <p>Start a conversation with {session.title}</p>
                        <p className="mt-2 text-[10px] text-green-500 opacity-70">🛡️ Sentinel PII Scanner Active</p>
                    </div>
                )}

                {/* Error Display */}
                {error && messages.length === 0 && (
                    <ErrorDisplay error={error} onRetry={handleRetry} />
                )}

                {messages.map(m => (
                    <div
                        key={m.id}
                        className={`flex flex-col gap-1 relative group ${m.role === 'user' ? 'items-end' : 'items-start'}`}
                    >
                        <div
                            className={`
                                max-w-[90%] rounded-2xl px-3 py-2 text-sm leading-relaxed
                                ${m.role === 'user'
                                    ? 'bg-blue-600 text-white rounded-br-none'
                                    : 'bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-bl-none prose dark:prose-invert'}
                            `}
                        >
                            <div className="whitespace-pre-wrap">{m.content}</div>
                        </div>

                        {/* Bounce Button */}
                        {m.role !== 'user' && onBounce && (
                            <button
                                onClick={() => onBounce(m.content)}
                                className="opacity-0 group-hover:opacity-100 transition-opacity absolute -bottom-5 left-0 text-[10px] text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 flex items-center gap-1.5 px-2 py-1 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-md transition-all"
                                title="Pass the baton to a specialist agent"
                            >
                                <svg className="w-3 h-3 rotate-45" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.5 4.5L4.5 13.5m0 0l-2.25 2.25a1.5 1.5 0 002.25 2.25l2.25-2.25m9-9l2.25-2.25a1.5 1.5 0 00-2.25-2.25L13.5 4.5" />
                                </svg>
                                <span className="font-medium">Pass Baton</span>
                            </button>
                        )}
                    </div>
                ))}

                {/* Error after messages */}
                {error && messages.length > 0 && (
                    <ErrorDisplay error={error} onRetry={handleRetry} />
                )}

                {isLoading && (
                    <div className="flex justify-start">
                        <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl rounded-bl-none px-3 py-2 shadow-sm flex items-center gap-1">
                            <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                            <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                            <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                    </div>
                )}
            </div>

            {/* Input */}
            <div className="p-3 bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800">
                <form onSubmit={handleSafeSubmit} className="relative">
                    <input
                        className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-blue-400 focus:border-blue-500 rounded-lg pl-3 pr-10 py-2 text-sm focus:outline-none transition-all placeholder:text-gray-400"
                        value={input}
                        onChange={handleInputChange}
                        placeholder="Type a message..."
                    />
                    <button
                        type="submit"
                        disabled={isLoading || !input?.trim()}
                        className="absolute right-1.5 top-1.5 p-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white rounded-md transition-colors w-7 h-7 flex items-center justify-center"
                    >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                        </svg>
                    </button>
                </form>
            </div>
        </div>
    );
}
