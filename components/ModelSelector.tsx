import { useState, useRef, useEffect } from "react";
import { PROVIDERS, Model, ProviderId } from "@/lib/models";
import { ModelConfig } from "@/lib/types";

export type { ModelConfig };

interface ModelSelectorProps {
    models: Model[];
    activeModels: ModelConfig[];
    onToggle: (modelId: string, config?: Partial<ModelConfig>) => void;
    onUpdateConfig: (modelId: string, config: Partial<ModelConfig>) => void;
    onSelectAll: () => void;
    onClearAll: () => void;
}

// Provider icons
const ProviderIcon = ({ providerId }: { providerId: ProviderId }) => {
    switch (providerId) {
        case 'openai':
            return (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/>
                </svg>
            );
        case 'anthropic':
            return (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M13.827 3.52h3.603L24 20.48h-3.603l-6.57-16.96zm-7.258 0h3.767L16.906 20.48h-3.674l-1.343-3.461H5.017l-1.344 3.46H0L6.57 3.522zm2.327 10.87l-2.108-5.432-2.108 5.432h4.216z"/>
                </svg>
            );
        case 'google':
            return (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
                </svg>
            );
        case 'xai':
            return (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                </svg>
            );
        case 'local':
            return (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="3" width="20" height="14" rx="2" />
                    <path d="M8 21h8M12 17v4" />
                </svg>
            );
        default:
            return null;
    }
};

// Brain icon for reasoning
const BrainIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M12 4.5c-1.5-1.5-4-1.5-5.5 0s-1.5 4 0 5.5l.5.5c-1 1-1.5 2.5-1 4 .5 1.5 2 2.5 3.5 2.5h1v3h4v-3h1c1.5 0 3-1 3.5-2.5.5-1.5 0-3-1-4l.5-.5c1.5-1.5 1.5-4 0-5.5s-4-1.5-5.5 0"/>
        <circle cx="9" cy="9" r="1" fill="currentColor"/>
        <circle cx="15" cy="9" r="1" fill="currentColor"/>
    </svg>
);

export function ModelSelector({ models, activeModels, onToggle, onUpdateConfig, onSelectAll, onClearAll }: ModelSelectorProps) {
    // Group models by provider
    const groupedModels = PROVIDERS.reduce((acc, provider) => {
        acc[provider.id] = models.filter(m => m.providerId === provider.id);
        return acc;
    }, {} as Record<ProviderId, Model[]>);

    const providerCount = PROVIDERS.filter(p => groupedModels[p.id]?.length > 0).length;

    return (
        <div className="flex flex-col gap-5 mb-8">
            <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-gray-300">Models</h2>
                <div className="flex gap-2">
                    <button
                        onClick={onSelectAll}
                        className="text-xs px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 text-gray-400 hover:text-gray-200 transition-colors"
                    >
                        Select All
                    </button>
                    <button
                        onClick={onClearAll}
                        className="text-xs px-2.5 py-1 rounded-md bg-white/5 hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors"
                    >
                        Clear
                    </button>
                </div>
            </div>

            <div className="flex flex-wrap justify-center gap-3 px-4">
                {PROVIDERS.map((provider, index) => {
                    const providerModels = groupedModels[provider.id];
                    if (!providerModels?.length) return null;

                    const activeProviderConfigs = activeModels.filter(c =>
                        providerModels.some(m => m.id === c.modelId)
                    );

                    // Determine if dropdown should open to the left (for rightmost items)
                    const isRightSide = index >= Math.ceil(providerCount / 2);

                    return (
                        <ModelDropdown
                            key={provider.id}
                            providerId={provider.id}
                            providerName={provider.name}
                            models={providerModels}
                            activeConfigs={activeProviderConfigs}
                            onToggle={onToggle}
                            onUpdateConfig={onUpdateConfig}
                            openDirection={isRightSide ? 'left' : 'right'}
                        />
                    );
                })}
            </div>
        </div>
    );
}

interface ModelDropdownProps {
    providerId: ProviderId;
    providerName: string;
    models: Model[];
    activeConfigs: ModelConfig[];
    onToggle: (modelId: string, config?: Partial<ModelConfig>) => void;
    onUpdateConfig: (modelId: string, config: Partial<ModelConfig>) => void;
    openDirection?: 'left' | 'right';
}

function ModelDropdown({ providerId, providerName, models, activeConfigs, onToggle, onUpdateConfig, openDirection = 'right' }: ModelDropdownProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [expandedModel, setExpandedModel] = useState<string | null>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
                setExpandedModel(null);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const getDisplayText = () => {
        if (activeConfigs.length === 0) return providerName;
        if (activeConfigs.length === 1) {
            const model = models.find(m => m.id === activeConfigs[0].modelId);
            const config = activeConfigs[0];
            let text = model?.name || activeConfigs[0].modelId;
            const modifiers: string[] = [];

            if (config.mode === 'code') modifiers.push('Code');
            if (config.reasoning) {
                const reasoningLabels = { low: 'Low', medium: 'Med', high: 'High', extra_high: 'Max' };
                modifiers.push(reasoningLabels[config.reasoning]);
            }
            if (config.thinking) modifiers.push('Thinking');

            if (modifiers.length > 0) {
                text += ` (${modifiers.join(', ')})`;
            }
            return text;
        }
        return `${activeConfigs.length} selected`;
    };

    const hasSelection = activeConfigs.length > 0;

    const reasoningLevels = [
        { id: 'low' as const, name: 'Low', description: 'Quick responses, minimal reasoning' },
        { id: 'medium' as const, name: 'Medium', description: 'Balanced reasoning depth' },
        { id: 'high' as const, name: 'High', description: 'Deep reasoning for complex tasks' },
        { id: 'extra_high' as const, name: 'Extra high', description: 'Maximum reasoning capability' },
    ];

    return (
        <div ref={dropdownRef} className="relative">
            {/* Dropdown Trigger */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`
                    flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all
                    ${hasSelection
                        ? 'bg-white/10 text-white'
                        : 'bg-black/40 text-gray-400 hover:text-gray-200 hover:bg-white/5'
                    }
                    border border-white/10 hover:border-white/20
                `}
            >
                <ProviderIcon providerId={providerId} />
                <span className="max-w-[160px] truncate">{getDisplayText()}</span>
                <svg
                    className={`w-3 h-3 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {/* Dropdown Panel */}
            {isOpen && (
                <div className={`absolute z-50 mt-2 min-w-[280px] bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl overflow-hidden ${openDirection === 'left' ? 'right-0' : 'left-0'}`}>
                    {/* Header */}
                    <div className="px-4 py-3 border-b border-white/5">
                        <span className="text-sm text-gray-300">Select {providerName}</span>
                    </div>

                    {/* Options */}
                    <div className="py-1 max-h-96 overflow-y-auto">
                        {models.map(model => {
                            const config = activeConfigs.find(c => c.modelId === model.id);
                            const isActive = !!config;
                            const isExpanded = expandedModel === model.id;
                            const supportsReasoning = model.tags?.includes('reasoning');

                            return (
                                <div key={model.id} className="border-b border-white/5 last:border-0">
                                    {/* Model Row */}
                                    <div
                                        className={`
                                            flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors
                                            hover:bg-white/5
                                            ${isActive ? 'bg-white/5' : ''}
                                        `}
                                    >
                                        {/* Checkbox */}
                                        <button
                                            onClick={() => onToggle(model.id)}
                                            className={`
                                                w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors
                                                ${isActive
                                                    ? 'bg-blue-500 border-blue-500'
                                                    : 'border-gray-600 hover:border-gray-400'
                                                }
                                            `}
                                        >
                                            {isActive && (
                                                <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                                </svg>
                                            )}
                                        </button>

                                        {/* Model Info */}
                                        <div
                                            className="flex-1 min-w-0"
                                            onClick={() => onToggle(model.id)}
                                        >
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm text-white">{model.name}</span>
                                                {model.tags?.includes('new') && (
                                                    <span className="text-[9px] font-medium bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded">
                                                        NEW
                                                    </span>
                                                )}
                                                {supportsReasoning && (
                                                    <span className="text-[9px] font-medium bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded">
                                                        REASONING
                                                    </span>
                                                )}
                                            </div>
                                            <span className="text-xs text-gray-500 truncate block">
                                                {model.description}
                                            </span>
                                        </div>

                                        {/* Config Toggle */}
                                        {isActive && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setExpandedModel(isExpanded ? null : model.id);
                                                }}
                                                className={`
                                                    p-1.5 rounded-lg transition-colors
                                                    ${isExpanded ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-white hover:bg-white/5'}
                                                `}
                                                title="Configure model"
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                </svg>
                                            </button>
                                        )}
                                    </div>

                                    {/* Expanded Config Panel */}
                                    {isActive && isExpanded && (
                                        <div className="px-4 pb-3 pt-1 bg-black/20 space-y-4">
                                            {/* Mode Toggle: Chat / Code */}
                                            <div>
                                                <span className="text-xs text-gray-400 mb-2 block">Mode</span>
                                                <div className="flex bg-black/40 rounded-lg p-1">
                                                    <button
                                                        onClick={() => onUpdateConfig(model.id, { mode: 'chat' })}
                                                        className={`
                                                            flex-1 px-4 py-1.5 rounded-md text-sm font-medium transition-all
                                                            ${(!config?.mode || config?.mode === 'chat')
                                                                ? 'bg-transparent text-gray-400'
                                                                : 'text-gray-500 hover:text-gray-300'
                                                            }
                                                        `}
                                                    >
                                                        Chat
                                                    </button>
                                                    <button
                                                        onClick={() => onUpdateConfig(model.id, { mode: 'code' })}
                                                        className={`
                                                            flex-1 px-4 py-1.5 rounded-md text-sm font-medium transition-all
                                                            ${config?.mode === 'code'
                                                                ? 'bg-gray-700 text-white'
                                                                : 'text-gray-500 hover:text-gray-300'
                                                            }
                                                        `}
                                                    >
                                                        Code
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Reasoning Level */}
                                            {supportsReasoning && (
                                                <div>
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <BrainIcon />
                                                        <span className="text-xs text-gray-400">Reasoning level</span>
                                                    </div>
                                                    <div className="space-y-1">
                                                        {reasoningLevels.map(level => (
                                                            <button
                                                                key={level.id}
                                                                onClick={() => onUpdateConfig(model.id, { reasoning: level.id })}
                                                                className={`
                                                                    w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors
                                                                    ${config?.reasoning === level.id
                                                                        ? 'bg-white/10 text-white'
                                                                        : 'hover:bg-white/5 text-gray-400 hover:text-gray-200'
                                                                    }
                                                                `}
                                                            >
                                                                <div className="flex items-center gap-2">
                                                                    <BrainIcon />
                                                                    <span className="text-sm">{level.name}</span>
                                                                </div>
                                                                {config?.reasoning === level.id && (
                                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                                                    </svg>
                                                                )}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Extended Thinking Toggle */}
                                            <div className="flex items-center justify-between py-2">
                                                <div className="flex items-center gap-2">
                                                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                                    </svg>
                                                    <span className="text-xs text-gray-400">Extended thinking</span>
                                                </div>
                                                <button
                                                    onClick={() => onUpdateConfig(model.id, { thinking: !config?.thinking })}
                                                    className={`
                                                        relative w-10 h-5 rounded-full transition-colors
                                                        ${config?.thinking ? 'bg-blue-500' : 'bg-gray-700'}
                                                    `}
                                                >
                                                    <div
                                                        className={`
                                                            absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform
                                                            ${config?.thinking ? 'translate-x-5' : 'translate-x-0.5'}
                                                        `}
                                                    />
                                                </button>
                                            </div>

                                            {/* Environment Selection */}
                                            <div>
                                                <span className="text-xs text-gray-400 mb-2 block">Environment</span>
                                                <div className="space-y-1">
                                                    {[
                                                        { id: 'local' as const, name: 'Local', icon: '💻' },
                                                        { id: 'projects' as const, name: 'Projects', icon: '📁' },
                                                        { id: 'cloud' as const, name: 'Cloud', icon: '☁️' },
                                                    ].map(env => (
                                                        <button
                                                            key={env.id}
                                                            onClick={() => onUpdateConfig(model.id, { environment: env.id })}
                                                            className={`
                                                                w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors
                                                                ${(config?.environment || 'local') === env.id
                                                                    ? 'bg-white/10 text-white'
                                                                    : 'hover:bg-white/5 text-gray-400 hover:text-gray-200'
                                                                }
                                                            `}
                                                        >
                                                            <div className="flex items-center gap-2">
                                                                <span>{env.icon}</span>
                                                                <span className="text-sm">{env.name}</span>
                                                            </div>
                                                            {(config?.environment || 'local') === env.id && (
                                                                <svg className="w-4 h-4 text-orange-400" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                                                </svg>
                                                            )}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Temperature Slider */}
                                            <div>
                                                <div className="flex items-center justify-between mb-2">
                                                    <span className="text-xs text-gray-400">Temperature</span>
                                                    <span className="text-xs text-gray-500">{(config?.temperature ?? 0.7).toFixed(1)}</span>
                                                </div>
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max="2"
                                                    step="0.1"
                                                    value={config?.temperature ?? 0.7}
                                                    onChange={(e) => onUpdateConfig(model.id, { temperature: parseFloat(e.target.value) })}
                                                    className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer slider-thumb"
                                                />
                                                <div className="flex justify-between text-[10px] text-gray-600 mt-1">
                                                    <span>Precise</span>
                                                    <span>Creative</span>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
