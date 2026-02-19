import { createOpenAI, openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import { ollama } from 'ollama-ai-provider';

// xAI Provider (OpenAI-compatible)
const xai = createOpenAI({
    name: 'xai',
    baseURL: 'https://api.x.ai/v1',
    apiKey: process.env.XAI_API_KEY ?? '',
});

export const models = {
    // OpenAI - Latest February 2026 Models
    'gpt-5.2': openai('gpt-5.2'),
    'gpt-5.2-pro': openai('gpt-5.2-pro'),
    'gpt-4.1': openai('gpt-4.1'),
    'o3': openai('o3'),
    'o3-pro': openai('o3-pro'),
    'o4-mini': openai('o4-mini'),
    'gpt-4o': openai('gpt-4o'),
    'gpt-4o-mini': openai('gpt-4o-mini'),

    // Anthropic - Latest February 2026 Models
    'claude-sonnet-4.5': anthropic('claude-sonnet-4-5'),
    'claude-opus-4.5': anthropic('claude-opus-4-5'),
    'claude-haiku-4.5': anthropic('claude-haiku-4-5'),

    // Google - Latest February 2026 Models
    'gemini-3-pro': google('gemini-3-pro-preview'),
    'gemini-3-flash': google('gemini-3-flash-preview'),
    'gemini-2.5-flash': google('gemini-2.5-flash'),
    'gemini-2.5-pro': google('gemini-2.5-pro'),

    // xAI - Latest February 2026 Models
    'grok-4.1-fast': xai('grok-4-1-fast-reasoning'),
    'grok-3': xai('grok-3-beta'),
    'grok-3-mini': xai('grok-3-mini-beta'),
    'grok-code': xai('grok-code-fast-1'),

    // Local Models (via Ollama)
    'llama3.3': ollama('llama3.3:70b'),
    'deepseek-r1': ollama('deepseek-r1'),
    'qwen2.5': ollama('qwen2.5:32b'),
};

export type ModelId = keyof typeof models;

export function getModel(id: string) {
    const modelId = id as ModelId;
    if (!models[modelId]) {
        throw new Error(`Model ${id} not found in registry`);
    }
    return models[modelId] as any;
}
