'use client';

import { useState, useEffect } from 'react';

interface ProviderConfig {
    id: string;
    name: string;
    accountUrl: string;
    docsUrl: string;
    icon: React.ReactNode;
    envVar: string;
}

const PROVIDERS: ProviderConfig[] = [
    {
        id: 'openai',
        name: 'OpenAI',
        accountUrl: 'https://platform.openai.com/settings/organization/billing/overview',
        docsUrl: 'https://platform.openai.com/docs',
        envVar: 'OPENAI_API_KEY',
        icon: (
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
                <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/>
            </svg>
        )
    },
    {
        id: 'anthropic',
        name: 'Anthropic',
        accountUrl: 'https://console.anthropic.com/settings/billing',
        docsUrl: 'https://docs.anthropic.com',
        envVar: 'ANTHROPIC_API_KEY',
        icon: (
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
                <path d="M17.304 3.541h-3.672l6.696 16.918h3.672L17.304 3.541zm-10.608 0L0 20.459h3.744l1.37-3.553h6.864l1.37 3.553h3.744L10.395 3.541H6.696zm.504 10.8l2.4-6.238 2.4 6.238H7.2z"/>
            </svg>
        )
    },
    {
        id: 'google',
        name: 'Google AI',
        accountUrl: 'https://aistudio.google.com/app/plan_information',
        docsUrl: 'https://ai.google.dev/docs',
        envVar: 'GOOGLE_GENERATIVE_AI_API_KEY',
        icon: (
            <svg viewBox="0 0 24 24" className="w-5 h-5">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
        )
    },
    {
        id: 'xai',
        name: 'xAI (Grok)',
        accountUrl: 'https://console.x.ai/team',
        docsUrl: 'https://docs.x.ai',
        envVar: 'XAI_API_KEY',
        icon: (
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
                <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/>
            </svg>
        )
    },
    {
        id: 'ollama',
        name: 'Ollama (Local)',
        accountUrl: 'https://ollama.com/download',
        docsUrl: 'https://ollama.com/library',
        envVar: 'OLLAMA_BASE_URL',
        icon: (
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
            </svg>
        )
    }
];

const STORAGE_KEY = 'agent_conductor_connections';
const THEME_KEY = 'agent_conductor_theme';

type Theme = 'light' | 'dark' | 'system';
type SettingsTab = 'providers' | 'appearance' | 'shortcuts';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
    const [connections, setConnections] = useState<Record<string, boolean>>({});
    const [pendingSignIn, setPendingSignIn] = useState<string | null>(null);
    const [theme, setTheme] = useState<Theme>('system');
    const [activeTab, setActiveTab] = useState<SettingsTab>('providers');

    // Load saved settings from localStorage
    useEffect(() => {
        const savedConnections = localStorage.getItem(STORAGE_KEY);
        if (savedConnections) {
            try {
                setConnections(JSON.parse(savedConnections));
            } catch {
                setConnections({});
            }
        }

        const savedTheme = localStorage.getItem(THEME_KEY) as Theme;
        if (savedTheme) {
            setTheme(savedTheme);
        }
    }, []);

    // Apply theme
    useEffect(() => {
        const root = document.documentElement;
        if (theme === 'dark') {
            root.classList.add('dark');
        } else if (theme === 'light') {
            root.classList.remove('dark');
        } else {
            // System preference
            if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
                root.classList.add('dark');
            } else {
                root.classList.remove('dark');
            }
        }
        localStorage.setItem(THEME_KEY, theme);
    }, [theme]);

    // Save connections to localStorage
    const saveConnections = (updated: Record<string, boolean>) => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        setConnections(updated);
    };

    const handleSignIn = (providerId: string, accountUrl: string) => {
        window.open(accountUrl, '_blank', 'noopener,noreferrer');
        setPendingSignIn(providerId);
    };

    const confirmConnection = (providerId: string) => {
        const updated = { ...connections, [providerId]: true };
        saveConnections(updated);
        setPendingSignIn(null);
    };

    const disconnect = (providerId: string) => {
        const updated = { ...connections, [providerId]: false };
        saveConnections(updated);
    };

    const openExternalLink = (url: string) => {
        window.open(url, '_blank', 'noopener,noreferrer');
    };

    if (!isOpen) return null;

    const connectedCount = Object.values(connections).filter(Boolean).length;

    const TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
        {
            id: 'providers',
            label: 'Providers',
            icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
            )
        },
        {
            id: 'appearance',
            label: 'Appearance',
            icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                </svg>
            )
        },
        {
            id: 'shortcuts',
            label: 'Shortcuts',
            icon: (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
            )
        }
    ];

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[8px]"
            onClick={onClose}
            style={{
                animation: 'fadeIn 300ms cubic-bezier(0.25, 0.1, 0.25, 1) forwards',
                WebkitBackdropFilter: 'blur(8px)'
            }}
        >
            <div
                className="bg-white dark:bg-[#14141a] rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden border border-gray-200 dark:border-[#2a2a38]"
                onClick={(e) => e.stopPropagation()}
                style={{ animation: 'modalEnter 400ms cubic-bezier(0.32, 0.72, 0, 1) forwards' }}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-[#1f1f2a]">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200">
                            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Settings</h2>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                Configure your Agent Conductor
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-[#2a2a38] transition-all duration-250 hover:scale-105 active:scale-95"
                        style={{ transitionTimingFunction: 'cubic-bezier(0.175, 0.885, 0.32, 1.1)' }}
                    >
                        <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Tabs - iOS segmented control style */}
                <div className="flex border-b border-gray-200 dark:border-[#1f1f2a] px-4">
                    {TABS.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`
                                relative flex items-center gap-2 px-4 py-3 text-sm font-medium
                                transition-colors duration-200
                                ${activeTab === tab.id
                                    ? 'text-blue-600 dark:text-blue-400'
                                    : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 active:scale-[0.97]'}
                            `}
                            style={{
                                transitionTimingFunction: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
                                WebkitTapHighlightColor: 'transparent'
                            }}
                        >
                            <span
                                className={`transition-transform duration-250 ${activeTab === tab.id ? 'scale-110' : ''}`}
                                style={{ transitionTimingFunction: 'cubic-bezier(0.175, 0.885, 0.32, 1.1)' }}
                            >
                                {tab.icon}
                            </span>
                            {tab.label}
                            {activeTab === tab.id && (
                                <span
                                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-full"
                                    style={{ animation: 'slideInUp 250ms cubic-bezier(0.32, 0.72, 0, 1) forwards' }}
                                />
                            )}
                        </button>
                    ))}
                </div>

                {/* Content - iOS scroll behavior */}
                <div className="max-h-[60vh] overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
                    {activeTab === 'providers' && (
                        <div className="p-4 space-y-2" style={{ animation: 'fadeIn 250ms cubic-bezier(0.25, 0.1, 0.25, 1) forwards' }}>
                            <div className="px-2 pb-3 flex items-center justify-between">
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                    {connectedCount} of {PROVIDERS.length} providers connected
                                </span>
                            </div>
                            {PROVIDERS.map(provider => {
                                const isConnected = connections[provider.id];
                                const isPending = pendingSignIn === provider.id;

                                return (
                                    <div
                                        key={provider.id}
                                        className={`p-4 rounded-xl border transition-all duration-200 ${
                                            isConnected
                                                ? 'border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/50 dark:bg-emerald-900/10'
                                                : isPending
                                                ? 'border-amber-200 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-900/10'
                                                : 'border-gray-200 dark:border-[#2a2a38] bg-gray-50/50 dark:bg-[#18181f]/50 hover:border-gray-300 dark:hover:border-[#3a3a48]'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className={`p-2 rounded-lg ${
                                                    isConnected
                                                        ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                                                        : isPending
                                                        ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
                                                        : 'bg-gray-100 dark:bg-[#2a2a38] text-gray-500 dark:text-gray-400'
                                                }`}>
                                                    {provider.icon}
                                                </div>
                                                <div>
                                                    <h3 className="font-medium text-gray-900 dark:text-gray-100">{provider.name}</h3>
                                                    <div className="flex items-center gap-2 mt-0.5">
                                                        {isConnected ? (
                                                            <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                                                Connected
                                                            </span>
                                                        ) : isPending ? (
                                                            <span className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                                                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                                                                Confirm sign-in
                                                            </span>
                                                        ) : (
                                                            <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">
                                                                {provider.envVar}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => openExternalLink(provider.docsUrl)}
                                                    className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#2a2a38] transition-colors"
                                                    title="Documentation"
                                                >
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                                    </svg>
                                                </button>

                                                {isConnected ? (
                                                    <>
                                                        <button
                                                            onClick={() => openExternalLink(provider.accountUrl)}
                                                            className="px-3 py-1.5 text-xs font-medium rounded-lg text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#2a2a38] transition-colors flex items-center gap-1.5"
                                                        >
                                                            Account
                                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                                            </svg>
                                                        </button>
                                                        <button
                                                            onClick={() => disconnect(provider.id)}
                                                            className="p-1.5 rounded-lg text-red-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                                            title="Disconnect"
                                                        >
                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                                                            </svg>
                                                        </button>
                                                    </>
                                                ) : isPending ? (
                                                    <>
                                                        <button
                                                            onClick={() => setPendingSignIn(null)}
                                                            className="px-3 py-1.5 text-xs font-medium rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-[#2a2a38] transition-colors"
                                                        >
                                                            Cancel
                                                        </button>
                                                        <button
                                                            onClick={() => confirmConnection(provider.id)}
                                                            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white transition-colors flex items-center gap-1.5"
                                                        >
                                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                                                            </svg>
                                                            Confirm
                                                        </button>
                                                    </>
                                                ) : (
                                                    <button
                                                        onClick={() => handleSignIn(provider.id, provider.accountUrl)}
                                                        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors flex items-center gap-1.5"
                                                    >
                                                        Connect
                                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                                        </svg>
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {activeTab === 'appearance' && (
                        <div className="p-6 space-y-6">
                            {/* Theme Selector */}
                            <div>
                                <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">Theme</h3>
                                <div className="grid grid-cols-3 gap-3">
                                    {(['light', 'dark', 'system'] as Theme[]).map((t) => (
                                        <button
                                            key={t}
                                            onClick={() => setTheme(t)}
                                            className={`
                                                p-4 rounded-xl border-2 transition-all duration-200 flex flex-col items-center gap-2
                                                ${theme === t
                                                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                                                    : 'border-gray-200 dark:border-[#2a2a38] hover:border-gray-300 dark:hover:border-[#3a3a48]'}
                                            `}
                                        >
                                            {t === 'light' && (
                                                <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                                                    <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                                                    </svg>
                                                </div>
                                            )}
                                            {t === 'dark' && (
                                                <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center">
                                                    <svg className="w-5 h-5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                                                    </svg>
                                                </div>
                                            )}
                                            {t === 'system' && (
                                                <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                                                    <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                                    </svg>
                                                </div>
                                            )}
                                            <span className={`text-sm font-medium capitalize ${
                                                theme === t ? 'text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-400'
                                            }`}>
                                                {t}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Accent Color Preview */}
                            <div>
                                <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">Preview</h3>
                                <div className="p-4 rounded-xl border border-gray-200 dark:border-[#2a2a38] bg-gray-50 dark:bg-[#18181f]">
                                    <div className="flex items-center gap-3 mb-3">
                                        <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-medium">
                                            A
                                        </div>
                                        <div>
                                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Sample Message</p>
                                            <p className="text-xs text-gray-500 dark:text-gray-400">This is how messages appear</p>
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <button className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-500 text-white">
                                            Primary
                                        </button>
                                        <button className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gray-200 dark:bg-[#2a2a38] text-gray-700 dark:text-gray-300">
                                            Secondary
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'shortcuts' && (
                        <div className="p-6">
                            <div className="space-y-4">
                                {[
                                    { keys: ['⌘', 'K'], description: 'Open command palette' },
                                    { keys: ['⌘', '`'], description: 'Toggle terminal' },
                                    { keys: ['@'], description: 'Add a model' },
                                    { keys: ['$'], description: 'Add a persona' },
                                    { keys: ['#'], description: 'Select workflow' },
                                    { keys: ['/'], description: 'Run command' },
                                    { keys: ['Enter'], description: 'Send message' },
                                    { keys: ['Shift', 'Enter'], description: 'New line' },
                                    { keys: ['Tab'], description: 'Select suggestion' },
                                    { keys: ['Esc'], description: 'Dismiss menu' },
                                ].map((shortcut, i) => (
                                    <div key={i} className="flex items-center justify-between py-2">
                                        <span className="text-sm text-gray-600 dark:text-gray-400">{shortcut.description}</span>
                                        <div className="flex items-center gap-1">
                                            {shortcut.keys.map((key, j) => (
                                                <kbd
                                                    key={j}
                                                    className="px-2 py-1 text-xs font-mono font-medium bg-gray-100 dark:bg-[#2a2a38] text-gray-600 dark:text-gray-400 rounded border border-gray-200 dark:border-[#3a3a48] shadow-sm"
                                                >
                                                    {key}
                                                </kbd>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-gray-200 dark:border-[#1f1f2a] bg-gray-50/80 dark:bg-[#18181f]/80">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span>Agent Conductor v1.0</span>
                        </div>
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors"
                        >
                            Done
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
