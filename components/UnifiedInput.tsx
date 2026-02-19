'use client';

import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { scanForPII, PIIFinding } from '@/lib/guardrails';

interface UnifiedInputProps {
    onSubmit: (message: string) => void;
    isLoading?: boolean;
    placeholder?: string;
    sessionCount?: number;
}

export function UnifiedInput({
    onSubmit,
    isLoading = false,
    placeholder = 'Ask all models...',
    sessionCount = 0,
}: UnifiedInputProps) {
    const [input, setInput] = useState('');
    const [piiWarning, setPiiWarning] = useState<PIIFinding[] | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
        }
    }, [input]);

    const handleSubmit = () => {
        if (!input.trim() || isLoading) return;

        const pii = scanForPII(input);
        if (pii.length > 0) {
            setPiiWarning(pii);
            return;
        }

        onSubmit(input);
        setInput('');
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    };

    const confirmSend = () => {
        setPiiWarning(null);
        onSubmit(input);
        setInput('');
    };

    return (
        <div className="relative">
            {/* PII Warning */}
            {piiWarning && (
                <div className="absolute bottom-full left-0 right-0 mb-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <div className="flex items-start gap-2 mb-2">
                        <svg className="w-4 h-4 text-red-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <div className="flex-1">
                            <p className="text-sm font-medium text-red-800 dark:text-red-200">
                                Sensitive information detected
                            </p>
                            <div className="mt-1 text-xs text-red-600 dark:text-red-300 font-mono">
                                {piiWarning.map((f, i) => (
                                    <span key={i} className="mr-2">
                                        {f.type}: {f.value}
                                    </span>
                                ))}
                            </div>
                        </div>
                    </div>
                    <div className="flex gap-2 justify-end">
                        <button
                            onClick={() => setPiiWarning(null)}
                            className="px-3 py-1 text-xs bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={confirmSend}
                            className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                        >
                            Send Anyway
                        </button>
                    </div>
                </div>
            )}

            {/* Input container */}
            <div className="flex items-end gap-2 p-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg">
                <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder}
                    rows={1}
                    className="flex-1 resize-none bg-transparent text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none px-2 py-1.5 max-h-[200px]"
                    disabled={isLoading}
                />

                <div className="flex items-center gap-2">
                    {sessionCount > 0 && (
                        <span className="text-xs text-gray-400 whitespace-nowrap">
                            → {sessionCount} model{sessionCount !== 1 ? 's' : ''}
                        </span>
                    )}

                    <button
                        onClick={handleSubmit}
                        disabled={isLoading || !input.trim()}
                        className={`
                            p-2 rounded-lg transition-all
                            ${isLoading || !input.trim()
                                ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed'
                                : 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm hover:shadow'}
                        `}
                    >
                        {isLoading ? (
                            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                        ) : (
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                            </svg>
                        )}
                    </button>
                </div>
            </div>

            {/* Keyboard hint */}
            <div className="flex items-center justify-between mt-1.5 px-2 text-xs text-gray-400">
                <span>
                    <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-[10px]">Enter</kbd> to send,{' '}
                    <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-[10px]">Shift+Enter</kbd> for new line
                </span>
                <span className="flex items-center gap-1">
                    <kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-[10px]">⌘K</kbd> commands
                </span>
            </div>
        </div>
    );
}
