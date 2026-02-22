'use client';

import { useRef, useEffect, forwardRef, useImperativeHandle, useCallback, useMemo, useState } from 'react';
import { Message } from 'ai';
import { useChat } from '@ai-sdk/react';
import { Session } from '@/lib/types';
import { useSystemPrompt } from '@/lib/useSystemPrompt';

interface ChatPanelProps {
    session: Session;
    initialMessages?: Message[];
    onClose?: () => void;
    onMessagesUpdate?: (messages: Message[]) => void;
    onLoadingChange?: (sessionId: string, isLoading: boolean) => void;
    onBounce?: (content: string) => void;
    compact?: boolean;
}

export interface ChatPanelRef {
    sendMessage: (content: string) => void;
    isLoading: boolean;
}

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

interface DecisionTraceLookupResponse {
    entry: DecisionTraceEntry | null;
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

function extractMessageText(message: Message): string {
    const legacyContent = (message as unknown as { content?: unknown }).content;
    if (typeof legacyContent === 'string') return legacyContent;

    const parts = (message as unknown as {
        parts?: Array<{ type?: string; text?: string }>;
    }).parts;

    if (!Array.isArray(parts)) return '';

    return parts
        .filter((part) => part?.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text as string)
        .join('');
}

export const ChatPanel = forwardRef<ChatPanelRef, ChatPanelProps>(({
    session,
    initialMessages = [],
    onClose,
    onMessagesUpdate,
    onLoadingChange,
    onBounce,
    compact = false,
}, ref) => {
    const systemPrompt = useSystemPrompt(session);
    const scrollRef = useRef<HTMLDivElement>(null);
    const [isHovered, setIsHovered] = useState(false);
    const [routeMeta, setRouteMeta] = useState<DecisionTraceEntry | null>(null);
    const pendingRequestIdRef = useRef<string | null>(null);
    const requestBody = useMemo(() => ({
        model: session.modelId,
        system: systemPrompt,
        config: session.config,
    }), [session.modelId, session.config, systemPrompt]);

    const chatHook = useChat({
        id: session.id,
        api: '/api/chat',
        messages: initialMessages,
    });

    const {
        messages,
        status,
        error,
        regenerate,
        sendMessage: sendChatMessage,
    } = chatHook;
    const isLoading = status === 'submitted' || status === 'streaming';

    const loadRouteMeta = useCallback(async (requestId: string) => {
        for (let attempt = 0; attempt < 6; attempt += 1) {
            try {
                const response = await fetch(`/api/decision-trace?requestId=${encodeURIComponent(requestId)}`, {
                    cache: 'no-store',
                });
                const payload = (await response.json()) as DecisionTraceLookupResponse;
                if (payload?.entry) {
                    setRouteMeta(payload.entry);
                    return;
                }
            } catch {
                // Best-effort UI metadata only.
            }

            await new Promise((resolve) => setTimeout(resolve, 200));
        }
    }, []);

    // Stable sendMessage function
    const sendMessage = useCallback((content: string) => {
        const text = content.trim();
        if (!text) return;
        const requestId = `${session.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        pendingRequestIdRef.current = requestId;
        sendChatMessage({ text }, {
            body: {
                ...requestBody,
                sessionId: session.id,
                requestId,
            },
        });
    }, [requestBody, sendChatMessage, session.id]);

    // Expose methods to parent
    useImperativeHandle(ref, () => ({
        sendMessage,
        isLoading,
    }), [sendMessage, isLoading]);

    // Track last reported message signature to avoid duplicate parent updates.
    const lastReportedSignatureRef = useRef('');

    // Report loading state to parent so global input can remain reactive.
    useEffect(() => {
        onLoadingChange?.(session.id, isLoading);
        return () => {
            onLoadingChange?.(session.id, false);
        };
    }, [session.id, isLoading, onLoadingChange]);

    useEffect(() => {
        if (isLoading) return;
        const requestId = pendingRequestIdRef.current;
        if (!requestId) return;
        pendingRequestIdRef.current = null;
        void loadRouteMeta(requestId);
    }, [isLoading, loadRouteMeta]);

    // Report messages to parent when message content changes.
    useEffect(() => {
        if (!onMessagesUpdate || messages.length === 0) return;
        const signature = messages
            .map((message) => `${message.id}:${message.role}:${extractMessageText(message)}`)
            .join('||');

        if (signature === lastReportedSignatureRef.current) return;
        lastReportedSignatureRef.current = signature;
        onMessagesUpdate(messages);
    }, [messages, onMessagesUpdate]);

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
                panel-shell flex flex-col rounded-2xl overflow-hidden
                ${compact ? 'h-[400px]' : 'h-[600px]'}
                ${isHovered ? 'border-[color:var(--ac-border)]' : ''}
            `}
            style={{
                transition: 'box-shadow 300ms cubic-bezier(0.25, 0.1, 0.25, 1), border-color 250ms cubic-bezier(0.25, 0.1, 0.25, 1)'
            }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            {/* Enhanced header with provider indicator */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[color:var(--ac-border-soft)] bg-[color:var(--ac-surface-strong)]/70">
                <div className="flex items-center gap-3">
                    {/* Provider indicator dot with glow effect when loading */}
                    <div className="relative">
                        <div className={`w-2.5 h-2.5 rounded-full ${providerConfig.bgColor} ${isLoading ? 'animate-pulse' : ''}`} />
                        {isLoading && (
                            <div className={`absolute inset-0 w-2.5 h-2.5 rounded-full ${providerConfig.bgColor} animate-ping opacity-75`} />
                        )}
                    </div>
                    <div className="flex flex-col">
                        <span className="text-sm font-semibold text-[color:var(--ac-text)] truncate max-w-[180px]">
                            {session.title}
                        </span>
                        {isLoading ? (
                            <span className="text-[10px] text-[color:var(--ac-text-muted)]">
                                Generating...
                            </span>
                        ) : routeMeta ? (
                            <span
                                className="text-[10px] text-[color:var(--ac-text-dim)] truncate max-w-[220px]"
                                title={`${routeMeta.requestedModel} -> ${routeMeta.executedModel} (${routeMeta.isAuto ? 'auto' : 'explicit'}) | ${routeMeta.reason}`}
                            >
                                {routeMeta.requestedModel}
                                <span className="mx-1 text-[color:var(--ac-text-muted)]">{'->'}</span>
                                {routeMeta.executedModel}
                                <span className="mx-1 text-[color:var(--ac-text-muted)]">·</span>
                                {routeMeta.durationMs}ms
                                {routeMeta.executedModel !== routeMeta.selectedModel ? (
                                    <>
                                        <span className="mx-1 text-[color:var(--ac-text-muted)]">·</span>
                                        fallback
                                    </>
                                ) : null}
                            </span>
                        ) : null}
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    {error && (
                        <button
                            onClick={() => {
                                const requestId = `${session.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                                pendingRequestIdRef.current = requestId;
                                regenerate({
                                    body: {
                                        ...requestBody,
                                        sessionId: session.id,
                                        requestId,
                                    },
                                });
                            }}
                            className="control-chip p-1.5 text-[color:var(--ac-danger)] hover:scale-105 active:scale-95"
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
                            className="control-chip p-1.5 active:scale-95"
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
                    <div className="h-full flex flex-col items-center justify-center text-[color:var(--ac-text-muted)]">
                        <div className="w-12 h-12 mb-3 rounded-2xl bg-[color:var(--ac-surface-strong)] border border-[color:var(--ac-border-soft)] flex items-center justify-center">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                            </svg>
                        </div>
                        <p className="text-sm font-medium">Waiting for input...</p>
                        <p className="text-xs mt-1 text-[color:var(--ac-text-muted)]">Messages will appear here</p>
                    </div>
                )}

                {error && (
                    <div
                        className="p-4 border rounded-xl animate-fadeIn bg-[color:var(--ac-surface-strong)]"
                        style={{ borderColor: 'color-mix(in srgb, var(--ac-danger) 55%, transparent)' }}
                    >
                        <div className="flex items-start gap-3">
                            <div
                                className="p-1.5 rounded-lg"
                                style={{ background: 'color-mix(in srgb, var(--ac-danger) 22%, transparent)' }}
                            >
                                <svg className="w-4 h-4 text-[color:var(--ac-danger)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            </div>
                            <div>
                                <p className="text-sm font-medium text-[color:var(--ac-danger)]">Error</p>
                                <p className="text-sm text-[color:var(--ac-text-dim)] mt-0.5">{error.message}</p>
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
                                    ? 'bg-cyan-500/10 text-[color:var(--ac-text)] border border-[color:var(--ac-border-soft)] rounded-br-md'
                                    : 'bg-[color:var(--ac-surface-strong)] border border-[color:var(--ac-border-soft)] text-[color:var(--ac-text-dim)] rounded-bl-md shadow-sm'}
                            `}
                            style={{
                                transition: 'background-color 200ms cubic-bezier(0.25, 0.1, 0.25, 1)'
                            }}
                        >
                            <div className="whitespace-pre-wrap break-words leading-relaxed">{extractMessageText(m)}</div>
                            {/* Bounce button for assistant messages - shows on hover */}
                            {m.role === 'assistant' && onBounce && extractMessageText(m).trim() && (
                                <button
                                    onClick={() => onBounce(extractMessageText(m))}
                                    className="absolute -right-2 -bottom-2 opacity-0 group-hover:opacity-100 p-2 rounded-full shadow-lg hover:scale-105 active:scale-95 text-white"
                                    style={{
                                        background: 'linear-gradient(135deg, var(--ac-accent), var(--ac-accent-strong))',
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
                        <div className="px-4 py-3 bg-[color:var(--ac-surface-strong)] border border-[color:var(--ac-border-soft)] rounded-2xl rounded-bl-md shadow-sm">
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
