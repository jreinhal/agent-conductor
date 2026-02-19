
export type ProviderId = 'openai' | 'anthropic' | 'google' | 'xai' | 'local';

export interface Model {
    id: string;
    name: string;
    description: string;
    providerId: ProviderId;
    tags?: ('new' | 'beta' | 'fast' | 'reasoning')[];
}

export const MODELS: Model[] = [
    // --- OpenAI (February 2026) ---
    {
        id: 'gpt-5.2',
        name: 'GPT-5.2',
        description: 'Flagship model. 400K context, 100% AIME 2025.',
        providerId: 'openai',
        tags: ['new']
    },
    {
        id: 'gpt-5.2-pro',
        name: 'GPT-5.2 Pro',
        description: 'Enhanced GPT-5.2 for complex tasks.',
        providerId: 'openai',
        tags: ['new']
    },
    {
        id: 'o3',
        name: 'o3',
        description: 'Most powerful reasoning model.',
        providerId: 'openai',
        tags: ['reasoning', 'new']
    },
    {
        id: 'o3-pro',
        name: 'o3-pro',
        description: 'Premium reasoning for complex problems.',
        providerId: 'openai',
        tags: ['reasoning', 'new']
    },
    {
        id: 'o4-mini',
        name: 'o4-mini',
        description: 'Fast, cost-efficient reasoning.',
        providerId: 'openai',
        tags: ['reasoning', 'fast', 'new']
    },
    {
        id: 'gpt-4.1',
        name: 'GPT-4.1',
        description: 'Smartest non-reasoning model.',
        providerId: 'openai',
    },
    {
        id: 'gpt-4o',
        name: 'GPT-4o',
        description: 'Multimodal flagship model.',
        providerId: 'openai',
    },
    {
        id: 'gpt-4o-mini',
        name: 'GPT-4o Mini',
        description: 'Fast & affordable.',
        providerId: 'openai',
        tags: ['fast']
    },

    // --- Anthropic (February 2026) ---
    {
        id: 'claude-sonnet-4.5',
        name: 'Claude Sonnet 4.5',
        description: 'Most intelligent. 80.9% SWE-bench.',
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
        id: 'claude-haiku-4.5',
        name: 'Claude Haiku 4.5',
        description: 'Fastest Claude, instant responses.',
        providerId: 'anthropic',
        tags: ['fast', 'new']
    },

    // --- Google (February 2026) ---
    {
        id: 'gemini-3-pro',
        name: 'Gemini 3 Pro',
        description: 'State-of-the-art reasoning & multimodal.',
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
    {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        description: 'High volume, low-latency, agentic.',
        providerId: 'google',
        tags: ['fast']
    },
    {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        description: 'Production-ready with thinking.',
        providerId: 'google',
    },

    // --- xAI (February 2026) ---
    {
        id: 'grok-4.1-fast',
        name: 'Grok 4.1 Fast',
        description: '2M context, max intelligence reasoning.',
        providerId: 'xai',
        tags: ['reasoning', 'new']
    },
    {
        id: 'grok-3',
        name: 'Grok 3',
        description: 'Standard Grok with real-time knowledge.',
        providerId: 'xai',
    },
    {
        id: 'grok-3-mini',
        name: 'Grok 3 Mini',
        description: 'Fast & efficient with reasoning.',
        providerId: 'xai',
        tags: ['fast']
    },
    {
        id: 'grok-code',
        name: 'Grok Code',
        description: 'Optimized for agentic coding. 256K context.',
        providerId: 'xai',
        tags: ['new']
    },

    // --- Local (Ollama) ---
    {
        id: 'llama3.3',
        name: 'Llama 3.3 70B',
        description: 'Latest Llama, matches GPT-4o quality.',
        providerId: 'local',
        tags: ['new']
    },
    {
        id: 'deepseek-r1',
        name: 'DeepSeek R1',
        description: 'Open-source reasoning rival to o1.',
        providerId: 'local',
        tags: ['reasoning', 'new']
    },
    {
        id: 'qwen2.5',
        name: 'Qwen 2.5 32B',
        description: 'Strong multilingual & coding.',
        providerId: 'local',
        tags: ['new']
    },
];

export function getModelInfo(id: string): Model | undefined {
    return MODELS.find(m => m.id === id);
}

export const PROVIDERS: { id: ProviderId; name: string }[] = [
    { id: 'openai', name: 'OpenAI' },
    { id: 'anthropic', name: 'Anthropic' },
    { id: 'google', name: 'Google DeepMind' },
    { id: 'xai', name: 'xAI' },
    { id: 'local', name: 'Local (Ollama)' },
];
