'use client';

import { useState, useEffect } from 'react';
import { CheckCircle2, XCircle, Loader2, ExternalLink } from 'lucide-react';

const FIRST_RUN_KEY = 'agent-conductor-initialized';

/** Provider status from /api/provider-status */
interface ProviderStatus {
    openai: boolean;
    anthropic: boolean;
    google: boolean;
    xai: boolean;
    ollama: boolean;
}

const PROVIDER_LABELS: Record<string, { name: string; envVar: string; docsUrl: string }> = {
    openai: { name: 'OpenAI', envVar: 'OPENAI_API_KEY', docsUrl: 'https://platform.openai.com/api-keys' },
    anthropic: { name: 'Anthropic', envVar: 'ANTHROPIC_API_KEY', docsUrl: 'https://console.anthropic.com/settings/keys' },
    google: { name: 'Google AI', envVar: 'GOOGLE_GENERATIVE_AI_API_KEY', docsUrl: 'https://aistudio.google.com/app/apikey' },
    xai: { name: 'xAI (Grok)', envVar: 'XAI_API_KEY', docsUrl: 'https://console.x.ai/team' },
    ollama: { name: 'Ollama (Local)', envVar: 'OLLAMA_BASE_URL', docsUrl: 'https://ollama.com/download' },
};

interface FirstRunWizardProps {
    onComplete: () => void;
}

export function useFirstRun() {
    const [isFirstRun, setIsFirstRun] = useState(false);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            const initialized = localStorage.getItem(FIRST_RUN_KEY);
            if (!initialized) {
                setIsFirstRun(true);
            }
        }
    }, []);

    const markComplete = () => {
        localStorage.setItem(FIRST_RUN_KEY, new Date().toISOString());
        setIsFirstRun(false);
    };

    return { isFirstRun, markComplete };
}

export function FirstRunWizard({ onComplete }: FirstRunWizardProps) {
    const [status, setStatus] = useState<ProviderStatus | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('/api/provider-status')
            .then((r) => r.json())
            .then((data) => {
                setStatus(data);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, []);

    const connectedCount = status
        ? Object.values(status).filter(Boolean).length
        : 0;

    return (
        <>
            {/* Backdrop */}
            <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md" />

            {/* Modal */}
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <div
                    className="ac-modal-shell rounded-2xl w-full max-w-lg overflow-hidden"
                    style={{ animation: 'modalEnter 400ms cubic-bezier(0.32, 0.72, 0, 1) forwards' }}
                >
                    {/* Header */}
                    <div className="px-6 pt-6 pb-4 text-center">
                        <div
                            className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center shadow-lg"
                            style={{ background: 'linear-gradient(135deg, var(--ac-accent), var(--ac-accent-strong))' }}
                        >
                            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                            </svg>
                        </div>
                        <h2 className="text-xl font-semibold text-[color:var(--ac-text)]">
                            Welcome to Agent Conductor
                        </h2>
                        <p className="text-sm text-[color:var(--ac-text-dim)] mt-2 max-w-sm mx-auto">
                            Run prompts across multiple AI models in parallel, compare responses, and orchestrate structured debates.
                        </p>
                    </div>

                    {/* Provider status */}
                    <div className="px-6 pb-4">
                        <h3 className="text-xs font-medium text-[color:var(--ac-text-muted)] uppercase tracking-wider mb-3">
                            Provider Status
                        </h3>
                        {loading ? (
                            <div className="flex items-center justify-center py-6">
                                <Loader2 className="w-5 h-5 animate-spin text-[color:var(--ac-text-muted)]" />
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {Object.entries(PROVIDER_LABELS).map(([key, info]) => {
                                    const connected = status?.[key as keyof ProviderStatus] ?? false;
                                    return (
                                        <div
                                            key={key}
                                            className={`flex items-center justify-between px-3 py-2.5 rounded-lg border transition-colors ${
                                                connected
                                                    ? 'border-emerald-800/40 bg-emerald-900/10'
                                                    : 'border-[color:var(--ac-border-soft)] ac-soft-surface'
                                            }`}
                                        >
                                            <div className="flex items-center gap-2.5">
                                                {connected ? (
                                                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                                                ) : (
                                                    <XCircle className="w-4 h-4 text-[color:var(--ac-text-muted)]" />
                                                )}
                                                <span className="text-sm text-[color:var(--ac-text)]">
                                                    {info.name}
                                                </span>
                                            </div>
                                            {!connected && (
                                                <a
                                                    href={info.docsUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="flex items-center gap-1 text-xs text-[color:var(--ac-accent)] hover:underline"
                                                >
                                                    Get key <ExternalLink className="w-3 h-3" />
                                                </a>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {!loading && connectedCount === 0 && (
                            <p className="text-xs text-amber-400 mt-3">
                                No providers configured. Add API keys to <code className="px-1 py-0.5 rounded bg-black/20">.env.local</code> and restart the server.
                            </p>
                        )}
                        {!loading && connectedCount > 0 && (
                            <p className="text-xs text-emerald-400 mt-3">
                                {connectedCount} provider{connectedCount !== 1 ? 's' : ''} ready. You can add more later in Settings.
                            </p>
                        )}
                    </div>

                    {/* Quick tips */}
                    <div className="px-6 pb-4">
                        <h3 className="text-xs font-medium text-[color:var(--ac-text-muted)] uppercase tracking-wider mb-2">
                            Quick Start
                        </h3>
                        <div className="grid grid-cols-2 gap-2 text-[11px] text-[color:var(--ac-text-dim)]">
                            <div className="px-2.5 py-2 rounded-lg ac-soft-surface">
                                <kbd className="px-1 py-0.5 rounded bg-black/10 dark:bg-white/10 text-[color:var(--ac-text)]">@</kbd> to add models
                            </div>
                            <div className="px-2.5 py-2 rounded-lg ac-soft-surface">
                                <kbd className="px-1 py-0.5 rounded bg-black/10 dark:bg-white/10 text-[color:var(--ac-text)]">$</kbd> for personas
                            </div>
                            <div className="px-2.5 py-2 rounded-lg ac-soft-surface">
                                <kbd className="px-1 py-0.5 rounded bg-black/10 dark:bg-white/10 text-[color:var(--ac-text)]">#</kbd> start workflow
                            </div>
                            <div className="px-2.5 py-2 rounded-lg ac-soft-surface">
                                <kbd className="px-1 py-0.5 rounded bg-black/10 dark:bg-white/10 text-[color:var(--ac-text)]">Cmd+K</kbd> palette
                            </div>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="px-6 py-4 border-t border-[color:var(--ac-border-soft)]">
                        <button
                            onClick={onComplete}
                            className="w-full ac-btn-primary px-4 py-2.5 text-sm font-medium rounded-lg transition-all"
                        >
                            Get Started
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}
