import { createOpenAI, openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';

// xAI Provider (OpenAI-compatible)
const xai = createOpenAI({
    name: 'xai',
    baseURL: 'https://api.x.ai/v1',
    apiKey: process.env.XAI_API_KEY ?? '',
});

export const models = {
    // OpenAI - GPT 5.2+
    'gpt-5.3-codex': openai('gpt-5.3-codex'),
    'gpt-5.2': openai('gpt-5.2'),

    // Anthropic - Claude 4.5+
    'claude-sonnet-4.5': anthropic('claude-sonnet-4-5'),
    'claude-opus-4.5': anthropic('claude-opus-4-5'),
    'claude-opus-4.6': anthropic('claude-opus-4-6'),
    'claude-haiku-4.5': anthropic('claude-haiku-4-5'),

    // Google - Gemini 3+
    'gemini-3-pro': google('gemini-3-pro-preview'),
    'gemini-3-flash': google('gemini-3-flash-preview'),

    // xAI - Grok 4+
    'grok-4.1-fast': xai('grok-4-1-fast-reasoning'),
};

export type ModelId = keyof typeof models;

export function getModel(id: string) {
    const modelId = id as ModelId;
    if (!models[modelId]) {
        throw new Error(`Model ${id} not found in registry`);
    }
    return models[modelId] as any;
}
