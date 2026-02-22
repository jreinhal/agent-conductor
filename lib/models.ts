
export type ProviderId = 'openai' | 'anthropic' | 'google' | 'local';

export interface Model {
    id: string;
    name: string;
    description: string;
    providerId: ProviderId;
    tags?: ('new' | 'beta' | 'fast' | 'reasoning')[];
}

export const MODELS: Model[] = [
    {
        id: 'auto-router',
        name: 'Auto Router',
        description: 'Deterministic decision matrix routes each turn to the best-fit local model.',
        providerId: 'local',
        tags: ['new']
    },

    // --- OpenAI (GPT 5.2+) ---
    {
        id: 'gpt-5.3-codex',
        name: 'GPT-5.3 Codex',
        description: 'Latest Codex-tuned model for coding and CLI workflows.',
        providerId: 'openai',
        tags: ['new']
    },
    {
        id: 'gpt-5.2',
        name: 'GPT-5.2',
        description: 'Flagship GPT model.',
        providerId: 'openai',
        tags: ['new']
    },

    // --- Anthropic (Claude 4.5+) ---
    {
        id: 'claude-sonnet-4.5',
        name: 'Claude Sonnet 4.5',
        description: 'Balanced intelligence and speed.',
        providerId: 'anthropic',
        tags: ['new']
    },
    {
        id: 'claude-opus-4.5',
        name: 'Claude Opus 4.5',
        description: 'Best for coding & agentic tasks.',
        providerId: 'anthropic',
        tags: ['new']
    },
    {
        id: 'claude-opus-4.6',
        name: 'Claude Opus 4.6',
        description: 'Latest Opus generation for high-complexity work.',
        providerId: 'anthropic',
        tags: ['new']
    },
    {
        id: 'claude-haiku-4.5',
        name: 'Claude Haiku 4.5',
        description: 'Fastest Claude, instant responses.',
        providerId: 'anthropic',
        tags: ['fast', 'new']
    },

    // --- Google (Gemini 3+) ---
    {
        id: 'gemini-3-pro',
        name: 'Gemini 3 Pro',
        description: 'State-of-the-art reasoning and multimodal.',
        providerId: 'google',
        tags: ['new']
    },
    {
        id: 'gemini-3-flash',
        name: 'Gemini 3 Flash',
        description: 'Frontier-class at fraction of cost.',
        providerId: 'google',
        tags: ['new', 'fast']
    },
];

export function getModelInfo(id: string): Model | undefined {
    return MODELS.find(m => m.id === id);
}

export const PROVIDERS: { id: ProviderId; name: string }[] = [
    { id: 'openai', name: 'OpenAI' },
    { id: 'anthropic', name: 'Anthropic' },
    { id: 'google', name: 'Google DeepMind' },
];
