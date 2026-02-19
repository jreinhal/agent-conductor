/**
 * Dynamic Model Registry
 * Fetches latest available models from each provider's API
 */

import { Model, ProviderId } from './models';

interface ProviderModelFetcher {
    providerId: ProviderId;
    fetchModels: () => Promise<Model[]>;
}

// OpenAI Models Fetcher
async function fetchOpenAIModels(): Promise<Model[]> {
    if (!process.env.OPENAI_API_KEY) return [];

    try {
        const response = await fetch('https://api.openai.com/v1/models', {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            },
        });

        if (!response.ok) return [];

        const data = await response.json();
        const models: Model[] = [];

        // Filter and map relevant models
        for (const model of data.data) {
            const id = model.id;

            // Skip deprecated, fine-tuned, and internal models
            if (id.includes(':ft-') || id.includes('instruct') || id.startsWith('ft:')) continue;
            if (id.includes('davinci') || id.includes('babbage') || id.includes('curie')) continue;
            if (id.includes('whisper') || id.includes('tts') || id.includes('dall-e')) continue;
            if (id.includes('embedding')) continue;

            // Categorize models
            const isReasoning = id.startsWith('o1') || id.startsWith('o3') || id.startsWith('o4');
            const isFast = id.includes('mini');
            const isCodex = id.includes('codex');
            const isNew = id.includes('5.') || id.includes('o3') || id.includes('o4');

            const tags: Model['tags'] = [];
            if (isReasoning) tags.push('reasoning');
            if (isFast) tags.push('fast');
            if (isNew) tags.push('new');

            // Generate display name
            let name = id
                .replace('gpt-', 'GPT-')
                .replace('-turbo', ' Turbo')
                .replace('-preview', ' Preview')
                .replace('codex', 'Codex')
                .split('-')
                .map((s: string) => s.charAt(0).toUpperCase() + s.slice(1))
                .join(' ');

            models.push({
                id,
                name,
                description: isCodex ? 'Code-optimized model' : isReasoning ? 'Advanced reasoning model' : 'General purpose model',
                providerId: 'openai',
                tags: tags.length > 0 ? tags : undefined,
            });
        }

        return models;
    } catch (error) {
        console.error('Failed to fetch OpenAI models:', error);
        return [];
    }
}

// Anthropic Models Fetcher
async function fetchAnthropicModels(): Promise<Model[]> {
    if (!process.env.ANTHROPIC_API_KEY) return [];

    try {
        const response = await fetch('https://api.anthropic.com/v1/models', {
            headers: {
                'x-api-key': process.env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
            },
        });

        if (!response.ok) return [];

        const data = await response.json();
        const models: Model[] = [];

        for (const model of data.data || []) {
            const id = model.id;

            // Parse model info
            const isOpus = id.includes('opus');
            const isSonnet = id.includes('sonnet');
            const isHaiku = id.includes('haiku');
            const version = id.match(/(\d+[-.]?\d*)/)?.[1] || '';

            let name = 'Claude';
            if (isOpus) name += ' Opus';
            else if (isSonnet) name += ' Sonnet';
            else if (isHaiku) name += ' Haiku';
            if (version) name += ` ${version}`;

            const tags: Model['tags'] = [];
            if (isHaiku) tags.push('fast');
            if (id.includes('20250') || id.includes('4.5') || id.includes('4-5')) tags.push('new');

            models.push({
                id,
                name,
                description: isOpus ? 'Most capable Claude model' : isSonnet ? 'Balanced performance' : 'Fast and efficient',
                providerId: 'anthropic',
                tags: tags.length > 0 ? tags : undefined,
            });
        }

        return models;
    } catch (error) {
        console.error('Failed to fetch Anthropic models:', error);
        return [];
    }
}

// Google AI Models Fetcher
async function fetchGoogleModels(): Promise<Model[]> {
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) return [];

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1/models?key=${process.env.GOOGLE_GENERATIVE_AI_API_KEY}`
        );

        if (!response.ok) return [];

        const data = await response.json();
        const models: Model[] = [];

        for (const model of data.models || []) {
            const id = model.name.replace('models/', '');

            // Skip non-generative models
            if (!id.includes('gemini')) continue;

            const isFlash = id.includes('flash');
            const isPro = id.includes('pro');
            const isThinking = id.includes('think');
            const version = id.match(/(\d+\.\d+)/)?.[1] || '';

            let name = 'Gemini';
            if (version) name += ` ${version}`;
            if (isPro) name += ' Pro';
            if (isFlash) name += ' Flash';
            if (isThinking) name += ' Deep Think';

            const tags: Model['tags'] = [];
            if (isFlash) tags.push('fast');
            if (isThinking) tags.push('reasoning');
            if (version >= '3' || id.includes('2.5')) tags.push('new');

            models.push({
                id,
                name,
                description: isThinking ? 'Advanced reasoning with iterative thinking' : isPro ? 'Most capable Gemini' : 'Fast and efficient',
                providerId: 'google',
                tags: tags.length > 0 ? tags : undefined,
            });
        }

        return models;
    } catch (error) {
        console.error('Failed to fetch Google models:', error);
        return [];
    }
}

// xAI Models Fetcher
async function fetchXAIModels(): Promise<Model[]> {
    if (!process.env.XAI_API_KEY) return [];

    try {
        const response = await fetch('https://api.x.ai/v1/models', {
            headers: {
                'Authorization': `Bearer ${process.env.XAI_API_KEY}`,
            },
        });

        if (!response.ok) return [];

        const data = await response.json();
        const models: Model[] = [];

        for (const model of data.data || []) {
            const id = model.id;

            if (!id.includes('grok')) continue;

            const isHeavy = id.includes('heavy');
            const version = id.match(/grok-(\d+)/)?.[1] || '';

            let name = `Grok ${version}`;
            if (isHeavy) name += ' Heavy';

            const tags: Model['tags'] = [];
            if (parseInt(version) >= 4) tags.push('new');

            models.push({
                id,
                name,
                description: isHeavy ? 'Maximum capability variant' : 'Advanced AI with real-time knowledge',
                providerId: 'xai',
                tags: tags.length > 0 ? tags : undefined,
            });
        }

        return models;
    } catch (error) {
        console.error('Failed to fetch xAI models:', error);
        return [];
    }
}

// Local Ollama Models Fetcher
async function fetchOllamaModels(): Promise<Model[]> {
    try {
        const response = await fetch('http://localhost:11434/api/tags');

        if (!response.ok) return [];

        const data = await response.json();
        const models: Model[] = [];

        for (const model of data.models || []) {
            const id = model.name;
            const name = model.name.split(':')[0];

            const isReasoning = name.includes('deepseek') || name.includes('qwen');

            const tags: Model['tags'] = [];
            if (isReasoning) tags.push('reasoning');

            models.push({
                id,
                name: name.charAt(0).toUpperCase() + name.slice(1),
                description: `Local model via Ollama`,
                providerId: 'local',
                tags: tags.length > 0 ? tags : undefined,
            });
        }

        return models;
    } catch (error) {
        // Ollama not running - this is expected
        return [];
    }
}

// Main function to fetch all models
export async function fetchAllModels(): Promise<Model[]> {
    const [openai, anthropic, google, xai, local] = await Promise.all([
        fetchOpenAIModels(),
        fetchAnthropicModels(),
        fetchGoogleModels(),
        fetchXAIModels(),
        fetchOllamaModels(),
    ]);

    return [...openai, ...anthropic, ...google, ...xai, ...local];
}

// Cache for models with TTL
let modelCache: Model[] | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function getLatestModels(): Promise<Model[]> {
    const now = Date.now();

    if (modelCache && (now - cacheTimestamp) < CACHE_TTL) {
        return modelCache;
    }

    const models = await fetchAllModels();

    if (models.length > 0) {
        modelCache = models;
        cacheTimestamp = now;
    }

    return models;
}

// API route handler for client-side fetching
export async function GET() {
    const models = await getLatestModels();
    return Response.json({ models });
}
