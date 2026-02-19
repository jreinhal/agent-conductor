import { Message } from 'ai';

// Model configuration options
export interface ModelConfig {
    modelId: string;
    mode?: 'chat' | 'code';
    reasoning?: 'low' | 'medium' | 'high' | 'extra_high';
    thinking?: boolean;
    environment?: 'local' | 'projects' | 'cloud';
    temperature?: number;
    maxTokens?: number;
}

export interface Session {
    id: string;          // Unique instance ID (e.g. "session-123")
    modelId: string;     // The underlying AI model ID
    title: string;       // Window title (e.g. "Security Auditor" or "GPT-4o")
    systemPrompt?: string; // Optional custom system prompt
    isPersona?: boolean; // Visual flair for persona windows
    config?: ModelConfig; // Model fine-tuning options
}

export interface SessionWithMessages extends Session {
    messages: Message[];
}

// Error types for better error handling
export interface APIError {
    code: string;
    message: string;
    provider?: string;
    retryable: boolean;
}

export type ErrorCode =
    | 'RATE_LIMIT'
    | 'INVALID_API_KEY'
    | 'NETWORK_ERROR'
    | 'PROVIDER_ERROR'
    | 'TIMEOUT'
    | 'UNKNOWN';

export function isAPIError(error: unknown): error is APIError {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        'message' in error &&
        'retryable' in error
    );
}
