'use client';

import { useState, useRef, useEffect } from 'react';
import { MODELS, Model, PROVIDERS, ProviderId } from '@/lib/models';

// Conversation modes
export type ConversationMode = 'planning' | 'fast';

interface CommandBarProps {
    input: string;
    onInputChange: (value: string) => void;
    onSubmit: (e: React.FormEvent) => void;
    isLoading: boolean;
    mode: ConversationMode;
    onModeChange: (mode: ConversationMode) => void;
    selectedModel: string;
    onModelChange: (modelId: string) => void;
    placeholder?: string;
}

export function CommandBar({
    input,
    onInputChange,
    onSubmit,
    isLoading,
    mode,
    onModeChange,
    selectedModel,
    onModelChange,
    placeholder = "Ask anything (Ctrl+L), @ to mention, / for workflows"
}: CommandBarProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
        }
    }, [input]);

    // Focus on Ctrl+L
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.key === 'l') {
                e.preventDefault();
                textareaRef.current?.focus();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSubmit(e);
        }
    };

    const selectedModelInfo = MODELS.find(m => m.id === selectedModel);

    return (
        <div className="w-full max-w-4xl mx-auto">
            <form onSubmit={onSubmit} className="relative">
                {/* Main Input Container */}
                <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl overflow-hidden focus-within:border-white/20 transition-colors">
                    {/* Textarea */}
                    <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={(e) => onInputChange(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={placeholder}
                        rows={1}
                        className="w-full bg-transparent text-white placeholder-gray-500 px-4 pt-4 pb-2 text-sm resize-none focus:outline-none min-h-[44px]"
                        style={{ maxHeight: '200px' }}
                    />

                    {/* Bottom Bar */}
                    <div className="flex items-center justify-between px-3 pb-3">
                        {/* Left: Add + Dropdowns */}
                        <div className="flex items-center gap-1">
                            {/* Add Button */}
                            <button
                                type="button"
                                className="p-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                                title="Add context"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                                </svg>
                            </button>

                            {/* Mode Dropdown */}
                            <ModeDropdown mode={mode} onModeChange={onModeChange} />

                            {/* Model Dropdown */}
                            <ModelDropdown
                                selectedModel={selectedModel}
                                selectedModelInfo={selectedModelInfo}
                                onModelChange={onModelChange}
                            />
                        </div>

                        {/* Right: Mic + Submit */}
                        <div className="flex items-center gap-2">
                            {/* Mic Button */}
                            <button
                                type="button"
                                className="p-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                                title="Voice input"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 1a4 4 0 0 1 4 4v7a4 4 0 1 1-8 0V5a4 4 0 0 1 4-4z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v1a7 7 0 0 1-14 0v-1M12 19v3M8 22h8" />
                                </svg>
                            </button>

                            {/* Submit Button */}
                            <button
                                type="submit"
                                disabled={isLoading || !input?.trim()}
                                className="p-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-full transition-colors"
                            >
                                {isLoading ? (
                                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                    </svg>
                                ) : (
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                                    </svg>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </form>
        </div>
    );
}

// Mode Dropdown Component
function ModeDropdown({ mode, onModeChange }: { mode: ConversationMode; onModeChange: (mode: ConversationMode) => void }) {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const modes = [
        {
            id: 'planning' as ConversationMode,
            name: 'Planning',
            description: 'Agent can plan before executing tasks. Use for deep research, complex tasks, or collaborative work'
        },
        {
            id: 'fast' as ConversationMode,
            name: 'Fast',
            description: 'Agent will execute tasks directly. Use for simple tasks that can be completed faster'
        }
    ];

    const currentMode = modes.find(m => m.id === mode) || modes[0];

    return (
        <div ref={dropdownRef} className="relative">
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
            >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
                <span>{currentMode.name}</span>
            </button>

            {isOpen && (
                <div className="absolute bottom-full left-0 mb-2 w-80 bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50">
                    <div className="px-4 py-3 border-b border-white/5">
                        <span className="text-sm text-gray-300">Conversation mode</span>
                    </div>
                    <div className="py-1">
                        {modes.map(m => (
                            <button
                                key={m.id}
                                type="button"
                                onClick={() => {
                                    onModeChange(m.id);
                                    setIsOpen(false);
                                }}
                                className={`w-full px-4 py-3 text-left hover:bg-white/5 transition-colors ${mode === m.id ? 'bg-white/5' : ''}`}
                            >
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium text-white">{m.name}</span>
                                    {mode === m.id && (
                                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                        </svg>
                                    )}
                                </div>
                                <p className="text-xs text-gray-500 mt-1">{m.description}</p>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// Model Dropdown Component
function ModelDropdown({
    selectedModel,
    selectedModelInfo,
    onModelChange
}: {
    selectedModel: string;
    selectedModelInfo: Model | undefined;
    onModelChange: (modelId: string) => void;
}) {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Group models by provider
    const groupedModels = PROVIDERS.reduce((acc, provider) => {
        acc[provider.id] = MODELS.filter(m => m.providerId === provider.id);
        return acc;
    }, {} as Record<ProviderId, Model[]>);

    const displayName = selectedModelInfo?.name || 'Select model';

    return (
        <div ref={dropdownRef} className="relative">
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
            >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
                <span className="max-w-[150px] truncate">{displayName}</span>
            </button>

            {isOpen && (
                <div className="absolute bottom-full left-0 mb-2 w-72 bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50">
                    <div className="px-4 py-3 border-b border-white/5">
                        <span className="text-sm text-gray-300">Model</span>
                    </div>
                    <div className="py-1 max-h-80 overflow-y-auto">
                        {MODELS.map(model => (
                            <button
                                key={model.id}
                                type="button"
                                onClick={() => {
                                    onModelChange(model.id);
                                    setIsOpen(false);
                                }}
                                className={`w-full px-4 py-2.5 text-left hover:bg-white/5 transition-colors flex items-center justify-between ${selectedModel === model.id ? 'bg-white/5' : ''}`}
                            >
                                <div className="flex items-center gap-2">
                                    <span className="text-sm text-white">{model.name}</span>
                                    {model.tags?.includes('new') && (
                                        <span className="text-[9px] font-medium bg-white/10 text-gray-300 px-1.5 py-0.5 rounded">
                                            New
                                        </span>
                                    )}
                                </div>
                                {selectedModel === model.id && (
                                    <svg className="w-4 h-4 text-white flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                )}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
