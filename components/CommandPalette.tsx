'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { MODELS } from '@/lib/models';
import { PERSONAS, Persona } from '@/lib/personas';
import { WORKFLOWS, Workflow } from '@/lib/workflows';

type CommandType = 'model' | 'persona' | 'workflow' | 'action';

interface Command {
    id: string;
    type: CommandType;
    label: string;
    description?: string;
    icon?: string;
    shortcut?: string;
    action: () => void;
}

interface CommandPaletteProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectModel: (modelId: string) => void;
    onSelectPersona: (persona: Persona) => void;
    onSelectWorkflow: (workflowId: string) => void;
    onSynthesize: () => void;
    onClearAll: () => void;
    customWorkflows?: Workflow[];
}

export function CommandPalette({
    isOpen,
    onClose,
    onSelectModel,
    onSelectPersona,
    onSelectWorkflow,
    onSynthesize,
    onClearAll,
    customWorkflows = [],
}: CommandPaletteProps) {
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    // Build command list
    const allWorkflows = useMemo(
        () => [...WORKFLOWS, ...customWorkflows],
        [customWorkflows]
    );

    const commands = useMemo<Command[]>(() => ([
        // Actions
        {
            id: 'synthesize',
            type: 'action',
            label: 'Synthesize',
            description: 'Have a judge model synthesize all responses',
            icon: '⚖️',
            shortcut: '⌘S',
            action: onSynthesize,
        },
        {
            id: 'clear',
            type: 'action',
            label: 'Clear All',
            description: 'Remove all active models',
            icon: '🗑️',
            action: onClearAll,
        },
        // Models
        ...MODELS.map(model => ({
            id: `model-${model.id}`,
            type: 'model' as CommandType,
            label: model.name,
            description: model.providerId,
            icon: getProviderIcon(model.providerId),
            action: () => onSelectModel(model.id),
        })),
        // Personas
        ...PERSONAS.map(persona => ({
            id: `persona-${persona.id}`,
            type: 'persona' as CommandType,
            label: persona.name,
            description: persona.description,
            icon: '🎭',
            action: () => onSelectPersona(persona),
        })),
        // Workflows
        ...allWorkflows.map(workflow => ({
            id: `workflow-${workflow.id}`,
            type: 'workflow' as CommandType,
            label: workflow.name,
            description: workflow.description,
            icon: '⚡',
            action: () => onSelectWorkflow(workflow.id),
        })),
    ]), [allWorkflows, onClearAll, onSelectModel, onSelectPersona, onSelectWorkflow, onSynthesize]);

    // Filter commands
    const filteredCommands = useMemo(
        () => query
            ? commands.filter(cmd =>
                cmd.label.toLowerCase().includes(query.toLowerCase()) ||
                cmd.description?.toLowerCase().includes(query.toLowerCase())
            )
            : commands,
        [commands, query]
    );

    // Group by type
    const grouped = useMemo(() => ({
        action: filteredCommands.filter(c => c.type === 'action'),
        model: filteredCommands.filter(c => c.type === 'model'),
        persona: filteredCommands.filter(c => c.type === 'persona'),
        workflow: filteredCommands.filter(c => c.type === 'workflow'),
    }), [filteredCommands]);

    // Flatten for keyboard navigation
    const flatList = useMemo(() => [
        ...grouped.action,
        ...grouped.model,
        ...grouped.persona,
        ...grouped.workflow,
    ], [grouped]);

    // Reset selection when query changes
    useEffect(() => {
        setSelectedIndex(0);
    }, [query]);

    // Focus input when opened
    useEffect(() => {
        if (isOpen) {
            inputRef.current?.focus();
            setQuery('');
            setSelectedIndex(0);
        }
    }, [isOpen]);

    // Keyboard navigation
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setSelectedIndex(i => Math.min(i + 1, flatList.length - 1));
                break;
            case 'ArrowUp':
                e.preventDefault();
                setSelectedIndex(i => Math.max(i - 1, 0));
                break;
            case 'Enter':
                e.preventDefault();
                if (flatList[selectedIndex]) {
                    flatList[selectedIndex].action();
                    onClose();
                }
                break;
            case 'Escape':
                e.preventDefault();
                onClose();
                break;
        }
    }, [flatList, selectedIndex, onClose]);

    // Scroll selected item into view
    useEffect(() => {
        const selected = listRef.current?.querySelector('[data-selected="true"]');
        selected?.scrollIntoView({ block: 'nearest' });
    }, [selectedIndex]);

    // Global keyboard shortcut
    useEffect(() => {
        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                if (isOpen) {
                    onClose();
                }
            }
        };

        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    let currentIndex = 0;

    return (
        <div
            className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh]"
            onClick={onClose}
        >
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-md" />

            {/* Palette */}
            <div
                className="relative w-full max-w-xl panel-shell rounded-2xl shadow-2xl overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                {/* Search input */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-[color:var(--ac-border-soft)]">
                    <svg className="w-5 h-5 text-[color:var(--ac-text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Search models, personas, workflows..."
                        className="flex-1 bg-transparent text-[color:var(--ac-text)] placeholder-[color:var(--ac-text-muted)] focus:outline-none"
                    />
                    <kbd className="hidden sm:inline-flex items-center px-2 py-0.5 text-xs rounded bg-black/10 dark:bg-white/10 border border-[color:var(--ac-border-soft)]">
                        ESC
                    </kbd>
                </div>

                {/* Results */}
                <div ref={listRef} className="max-h-[50vh] overflow-y-auto">
                    {flatList.length === 0 ? (
                        <div className="px-4 py-8 text-center text-[color:var(--ac-text-muted)]">
                            No results found
                        </div>
                    ) : (
                        <>
                            {grouped.action.length > 0 && (
                                <CommandGroup title="Actions">
                                    {grouped.action.map(cmd => {
                                        const idx = currentIndex++;
                                        return (
                                            <CommandItem
                                                key={cmd.id}
                                                command={cmd}
                                                isSelected={selectedIndex === idx}
                                                onClick={() => {
                                                    cmd.action();
                                                    onClose();
                                                }}
                                            />
                                        );
                                    })}
                                </CommandGroup>
                            )}

                            {grouped.model.length > 0 && (
                                <CommandGroup title="Models">
                                    {grouped.model.map(cmd => {
                                        const idx = currentIndex++;
                                        return (
                                            <CommandItem
                                                key={cmd.id}
                                                command={cmd}
                                                isSelected={selectedIndex === idx}
                                                onClick={() => {
                                                    cmd.action();
                                                    onClose();
                                                }}
                                            />
                                        );
                                    })}
                                </CommandGroup>
                            )}

                            {grouped.persona.length > 0 && (
                                <CommandGroup title="Personas">
                                    {grouped.persona.map(cmd => {
                                        const idx = currentIndex++;
                                        return (
                                            <CommandItem
                                                key={cmd.id}
                                                command={cmd}
                                                isSelected={selectedIndex === idx}
                                                onClick={() => {
                                                    cmd.action();
                                                    onClose();
                                                }}
                                            />
                                        );
                                    })}
                                </CommandGroup>
                            )}

                            {grouped.workflow.length > 0 && (
                                <CommandGroup title="Workflows">
                                    {grouped.workflow.map(cmd => {
                                        const idx = currentIndex++;
                                        return (
                                            <CommandItem
                                                key={cmd.id}
                                                command={cmd}
                                                isSelected={selectedIndex === idx}
                                                onClick={() => {
                                                    cmd.action();
                                                    onClose();
                                                }}
                                            />
                                        );
                                    })}
                                </CommandGroup>
                            )}
                        </>
                    )}
                </div>

                {/* Footer hint */}
                <div className="flex items-center justify-between px-4 py-2 border-t border-[color:var(--ac-border-soft)] text-xs text-[color:var(--ac-text-muted)]">
                    <div className="flex items-center gap-4">
                        <span className="flex items-center gap-1">
                            <kbd className="px-1.5 py-0.5 rounded bg-black/10 dark:bg-white/10 border border-[color:var(--ac-border-soft)]">↑</kbd>
                            <kbd className="px-1.5 py-0.5 rounded bg-black/10 dark:bg-white/10 border border-[color:var(--ac-border-soft)]">↓</kbd>
                            navigate
                        </span>
                        <span className="flex items-center gap-1">
                            <kbd className="px-1.5 py-0.5 rounded bg-black/10 dark:bg-white/10 border border-[color:var(--ac-border-soft)]">↵</kbd>
                            select
                        </span>
                    </div>
                    <span className="flex items-center gap-1">
                        <kbd className="px-1.5 py-0.5 rounded bg-black/10 dark:bg-white/10 border border-[color:var(--ac-border-soft)]">⌘K</kbd>
                        toggle
                    </span>
                </div>
            </div>
        </div>
    );
}

function CommandGroup({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="py-2">
            <div className="px-4 py-1.5 text-xs font-medium text-[color:var(--ac-text-muted)] uppercase tracking-wider">
                {title}
            </div>
            {children}
        </div>
    );
}

function CommandItem({
    command,
    isSelected,
    onClick,
}: {
    command: Command;
    isSelected: boolean;
    onClick: () => void;
}) {
    return (
        <button
            data-selected={isSelected}
            onClick={onClick}
            className={`
                w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors
                ${isSelected
                    ? 'bg-cyan-500/10 text-[color:var(--ac-text)]'
                    : 'text-[color:var(--ac-text-dim)] hover:bg-[color:var(--ac-surface-strong)]'}
            `}
        >
            <span className="text-lg w-6 text-center">{command.icon}</span>
            <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{command.label}</div>
                {command.description && (
                    <div className="text-xs text-[color:var(--ac-text-muted)] truncate">{command.description}</div>
                )}
            </div>
            {command.shortcut && (
                <kbd className="text-xs px-1.5 py-0.5 rounded bg-black/10 dark:bg-white/10 border border-[color:var(--ac-border-soft)]">
                    {command.shortcut}
                </kbd>
            )}
        </button>
    );
}

function getProviderIcon(provider: string): string {
    switch (provider.toLowerCase()) {
        case 'openai': return '🟢';
        case 'anthropic': return '🟠';
        case 'google': return '🔵';
        case 'xai': return '⚫';
        case 'ollama': return '🦙';
        default: return '🤖';
    }
}
