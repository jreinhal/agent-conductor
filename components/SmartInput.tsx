'use client';

import { useState, useRef, useEffect, KeyboardEvent, useCallback, useMemo } from 'react';
import { MODELS } from '@/lib/models';
import { PERSONAS } from '@/lib/personas';
import { WORKFLOWS } from '@/lib/workflows';
import { scanForPII, PIIFinding } from '@/lib/guardrails';

type SuggestionType = 'model' | 'persona' | 'workflow' | 'command';

interface Suggestion {
    id: string;
    type: SuggestionType;
    label: string;
    description?: string;
    icon: string;
    prefix: string;
}

interface SmartInputProps {
    onSubmit: (message: string) => void;
    onSelectModel: (modelId: string) => void;
    onSelectPersona: (personaId: string) => void;
    onSelectWorkflow: (workflowId: string) => void;
    onSynthesize: () => void;
    onClearAll: () => void;
    isLoading?: boolean;
    sessionCount?: number;
}

const COMMANDS: Suggestion[] = [
    { id: 'synthesize', type: 'command', label: 'synthesize', description: 'Create a judge to synthesize all responses', icon: '⚖️', prefix: '/' },
    { id: 'clear', type: 'command', label: 'clear', description: 'Remove all active models', icon: '🗑️', prefix: '/' },
    { id: 'grid', type: 'command', label: 'grid', description: 'Switch to grid view', icon: '⊞', prefix: '/' },
    { id: 'freeform', type: 'command', label: 'freeform', description: 'Switch to freeform view', icon: '◇', prefix: '/' },
];

function getProviderIcon(providerId: string): string {
    switch (providerId) {
        case 'openai': return '🟢';
        case 'anthropic': return '🟠';
        case 'google': return '🔵';
        case 'xai': return '⚫';
        case 'local': return '🦙';
        default: return '🤖';
    }
}

export function SmartInput({
    onSubmit,
    onSelectModel,
    onSelectPersona,
    onSelectWorkflow,
    onSynthesize,
    onClearAll,
    isLoading = false,
    sessionCount = 0,
}: SmartInputProps) {
    const [input, setInput] = useState('');
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [piiWarning, setPiiWarning] = useState<PIIFinding[] | null>(null);
    const [triggerInfo, setTriggerInfo] = useState<{ prefix: string; start: number } | null>(null);

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const suggestionsRef = useRef<HTMLDivElement>(null);

    // Build all suggestions
    const allSuggestions = useMemo<Suggestion[]>(() => ([
        // Models with @ prefix
        ...MODELS.map(m => ({
            id: m.id,
            type: 'model' as SuggestionType,
            label: m.name,
            description: m.description,
            icon: getProviderIcon(m.providerId),
            prefix: '@',
        })),
        // Personas with $ prefix
        ...PERSONAS.map(p => ({
            id: p.id,
            type: 'persona' as SuggestionType,
            label: p.name,
            description: p.description,
            icon: '🎭',
            prefix: '$',
        })),
        // Workflows with # prefix
        ...WORKFLOWS.map(w => ({
            id: w.id,
            type: 'workflow' as SuggestionType,
            label: w.name,
            description: w.description,
            icon: '⚡',
            prefix: '#',
        })),
        // Commands with / prefix
        ...COMMANDS,
    ]), []);

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
        }
    }, [input]);

    // Parse input for trigger characters
    const parseInput = useCallback((value: string, cursorPos: number) => {
        // Look backwards from cursor for trigger character
        const beforeCursor = value.slice(0, cursorPos);
        const triggers = ['@', '$', '#', '/'];

        for (const trigger of triggers) {
            const lastTriggerIndex = beforeCursor.lastIndexOf(trigger);
            if (lastTriggerIndex === -1) continue;

            // Check if trigger is at start or after whitespace
            if (lastTriggerIndex > 0 && !/\s/.test(beforeCursor[lastTriggerIndex - 1])) continue;

            // Get the query after the trigger
            const query = beforeCursor.slice(lastTriggerIndex + 1);

            // Don't trigger if there's a space in the query (completed selection)
            if (query.includes(' ')) continue;

            return { prefix: trigger, query, start: lastTriggerIndex };
        }

        return null;
    }, []);

    // Handle input change
    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const value = e.target.value;
        const cursorPos = e.target.selectionStart || 0;

        setInput(value);

        const trigger = parseInput(value, cursorPos);

        if (trigger) {
            setTriggerInfo({ prefix: trigger.prefix, start: trigger.start });

            // Filter suggestions by prefix and query
            const filtered = allSuggestions
                .filter(s => s.prefix === trigger.prefix)
                .filter(s =>
                    s.label.toLowerCase().includes(trigger.query.toLowerCase()) ||
                    s.description?.toLowerCase().includes(trigger.query.toLowerCase())
                )
                .slice(0, 8);

            setSuggestions(filtered);
            setShowSuggestions(filtered.length > 0);
            setSelectedIndex(0);
        } else {
            setShowSuggestions(false);
            setTriggerInfo(null);
        }
    }, [parseInput, allSuggestions]);

    // Handle suggestion selection
    const selectSuggestion = useCallback((suggestion: Suggestion) => {
        if (!triggerInfo) return;

        // Execute the action based on type
        switch (suggestion.type) {
            case 'model':
                onSelectModel(suggestion.id);
                break;
            case 'persona':
                onSelectPersona(suggestion.id);
                break;
            case 'workflow':
                onSelectWorkflow(suggestion.id);
                break;
            case 'command':
                if (suggestion.id === 'synthesize') onSynthesize();
                if (suggestion.id === 'clear') onClearAll();
                // grid/freeform would need to be passed as props
                break;
        }

        // Clear the trigger text from input
        const beforeTrigger = input.slice(0, triggerInfo.start);
        const afterCursor = input.slice(textareaRef.current?.selectionStart || input.length);
        setInput(beforeTrigger + afterCursor);

        setShowSuggestions(false);
        setTriggerInfo(null);
        textareaRef.current?.focus();
    }, [triggerInfo, input, onSelectModel, onSelectPersona, onSelectWorkflow, onSynthesize, onClearAll]);

    // Handle submit
    const handleSubmit = useCallback(() => {
        if (!input.trim() || isLoading) return;

        const pii = scanForPII(input);
        if (pii.length > 0) {
            setPiiWarning(pii);
            return;
        }

        onSubmit(input);
        setInput('');
    }, [input, isLoading, onSubmit]);

    // Handle keyboard navigation
    const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (showSuggestions) {
            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    setSelectedIndex(i => Math.min(i + 1, suggestions.length - 1));
                    return;
                case 'ArrowUp':
                    e.preventDefault();
                    setSelectedIndex(i => Math.max(i - 1, 0));
                    return;
                case 'Tab':
                case 'Enter':
                    if (suggestions[selectedIndex]) {
                        e.preventDefault();
                        selectSuggestion(suggestions[selectedIndex]);
                        return;
                    }
                    break;
                case 'Escape':
                    e.preventDefault();
                    setShowSuggestions(false);
                    return;
            }
        }

        // Normal submit on Enter (without shift)
        if (e.key === 'Enter' && !e.shiftKey && !showSuggestions) {
            e.preventDefault();
            handleSubmit();
        }
    }, [showSuggestions, suggestions, selectedIndex, selectSuggestion, handleSubmit]);

    const confirmSend = () => {
        setPiiWarning(null);
        onSubmit(input);
        setInput('');
    };

    // Scroll selected suggestion into view
    useEffect(() => {
        const selected = suggestionsRef.current?.querySelector('[data-selected="true"]');
        selected?.scrollIntoView({ block: 'nearest' });
    }, [selectedIndex]);

    return (
        <div className="relative">
            {/* PII Warning */}
            {piiWarning && (
                <div
                    className="absolute bottom-full left-0 right-0 mb-2 p-3 rounded-xl panel-shell"
                    style={{ borderColor: 'color-mix(in srgb, var(--ac-danger) 55%, transparent)' }}
                >
                    <div className="flex items-start gap-2 mb-2">
                        <svg className="w-4 h-4 text-[color:var(--ac-danger)] mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <div className="flex-1">
                            <p className="text-sm font-medium text-[color:var(--ac-danger)]">
                                Sensitive information detected
                            </p>
                            <div className="mt-1 text-xs text-[color:var(--ac-text-dim)] font-mono">
                                {piiWarning.map((f, i) => (
                                    <span key={i} className="mr-2">{f.type}: {f.value}</span>
                                ))}
                            </div>
                        </div>
                    </div>
                    <div className="flex gap-2 justify-end">
                        <button
                            onClick={() => setPiiWarning(null)}
                            className="control-chip px-3 py-1 text-xs"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={confirmSend}
                            className="px-3 py-1 text-xs rounded-md text-white"
                            style={{ background: 'linear-gradient(135deg, var(--ac-danger), #ff5d6f)' }}
                        >
                            Send Anyway
                        </button>
                    </div>
                </div>
            )}

            {/* Suggestions dropdown - iOS style menu */}
            {showSuggestions && (
                <div
                    ref={suggestionsRef}
                    className="absolute bottom-full left-0 right-0 mb-3 panel-shell rounded-xl max-h-72 overflow-hidden"
                    style={{
                        animation: 'slideInUp 280ms cubic-bezier(0.32, 0.72, 0, 1) forwards',
                        WebkitBackdropFilter: 'blur(20px)',
                        backdropFilter: 'blur(20px)'
                    }}
                >
                    <div className="p-2 max-h-56 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
                        {suggestions.map((suggestion, index) => (
                            <button
                                key={`${suggestion.type}-${suggestion.id}`}
                                data-selected={selectedIndex === index}
                                onClick={() => selectSuggestion(suggestion)}
                                className={`
                                    w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left active:scale-[0.98]
                                    ${selectedIndex === index
                                        ? 'bg-cyan-500/10 text-[color:var(--ac-text)] shadow-sm'
                                        : 'text-[color:var(--ac-text-dim)] hover:bg-[color:var(--ac-surface-strong)]'}
                                `}
                                style={{
                                    transition: 'background-color 100ms cubic-bezier(0.25, 0.1, 0.25, 1), transform 80ms cubic-bezier(0, 0, 0.2, 1)',
                                    WebkitTapHighlightColor: 'transparent'
                                }}
                            >
                                <span className="text-base flex-shrink-0">{suggestion.icon}</span>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="ac-kbd text-xs font-mono px-1">
                                            {suggestion.prefix}
                                        </span>
                                        <span className="font-medium truncate text-sm">{suggestion.label}</span>
                                    </div>
                                    {suggestion.description && (
                                        <p className="text-xs text-[color:var(--ac-text-muted)] truncate mt-0.5">{suggestion.description}</p>
                                    )}
                                </div>
                                <span
                                    className={`
                                        text-[9px] font-medium uppercase px-1.5 py-0.5 rounded
                                        ${suggestion.type === 'model' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' : ''}
                                        ${suggestion.type === 'persona' ? 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300' : ''}
                                        ${suggestion.type === 'workflow' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' : ''}
                                        ${suggestion.type === 'command' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : ''}
                                    `}
                                >
                                    {suggestion.type}
                                </span>
                            </button>
                        ))}
                    </div>
                    <div className="px-4 py-2 border-t border-[color:var(--ac-border-soft)] bg-[color:var(--ac-surface-strong)]/80 text-[10px] text-[color:var(--ac-text-muted)] flex items-center gap-3">
                        <span><span className="font-mono font-bold">@</span> models</span>
                        <span><span className="font-mono font-bold">$</span> personas</span>
                        <span><span className="font-mono font-bold">#</span> workflows</span>
                        <span><span className="font-mono font-bold">/</span> commands</span>
                    </div>
                </div>
            )}

            {/* Input container - iOS style input field */}
            <div
                className={`
                    flex items-end gap-3 p-4
                    panel-shell
                    rounded-2xl shadow-lg
                    ${input.trim() ? 'border-[color:var(--ac-border)]' : ''}
                    focus-within:border-[color:var(--ac-border)]
                    focus-within:shadow-xl
                `}
                style={{
                    transition: 'border-color 250ms cubic-bezier(0.25, 0.1, 0.25, 1), box-shadow 300ms cubic-bezier(0.25, 0.1, 0.25, 1)'
                }}
            >
                <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    placeholder={sessionCount > 0 ? "Message all models... (@ $ # / for quick actions)" : "Type @ to add a model..."}
                    rows={1}
                    className="flex-1 resize-none bg-transparent text-[color:var(--ac-text)] placeholder-[color:var(--ac-text-muted)] focus:outline-none px-1 py-1 max-h-[200px] text-sm leading-relaxed"
                    disabled={isLoading}
                />

                <div className="flex items-center gap-3">
                    {sessionCount > 0 && (
                        <div className="status-pill flex items-center gap-1.5 px-2.5 py-1 rounded-lg">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            <span className="text-xs font-medium whitespace-nowrap">
                                {sessionCount} model{sessionCount !== 1 ? 's' : ''}
                            </span>
                        </div>
                    )}

                    <button
                        onClick={handleSubmit}
                        disabled={isLoading || !input.trim() || sessionCount === 0}
                        className={`
                            p-2.5 rounded-xl
                            ${isLoading || !input.trim() || sessionCount === 0
                                ? 'status-pill text-[color:var(--ac-text-muted)] cursor-not-allowed'
                                : 'text-white shadow-md hover:shadow-lg hover:scale-[1.03] active:scale-[0.97]'}
                        `}
                        style={{
                            background: isLoading || !input.trim() || sessionCount === 0
                                ? undefined
                                : 'linear-gradient(135deg, var(--ac-accent), var(--ac-accent-strong))',
                            transition: 'background-color 200ms cubic-bezier(0.25, 0.1, 0.25, 1), transform 250ms cubic-bezier(0.175, 0.885, 0.32, 1.1), box-shadow 200ms cubic-bezier(0.25, 0.1, 0.25, 1)',
                            WebkitTapHighlightColor: 'transparent'
                        }}
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

            {/* Keyboard hints - Cleaner design */}
            <div className="flex items-center justify-between mt-2 px-3 text-[11px] text-[color:var(--ac-text-muted)]">
                <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1">
                        <kbd className="ac-kbd px-1.5 py-0.5 text-[10px] font-mono">Enter</kbd>
                        <span>send</span>
                    </span>
                    <span className="flex items-center gap-1">
                        <kbd className="ac-kbd px-1.5 py-0.5 text-[10px] font-mono">⇧</kbd>
                        <kbd className="ac-kbd px-1.5 py-0.5 text-[10px] font-mono">Enter</kbd>
                        <span>new line</span>
                    </span>
                </div>
                <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1">
                        <kbd className="ac-kbd px-1.5 py-0.5 text-[10px] font-mono">Tab</kbd>
                        <span>select</span>
                    </span>
                    <span className="flex items-center gap-1">
                        <kbd className="ac-kbd px-1.5 py-0.5 text-[10px] font-mono">Esc</kbd>
                        <span>dismiss</span>
                    </span>
                </div>
            </div>
        </div>
    );
}
