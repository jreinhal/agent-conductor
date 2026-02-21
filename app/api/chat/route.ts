import { streamText, UIMessage, convertToModelMessages } from 'ai';
import { getModel } from '@/lib/ai';

export const maxDuration = 60; // Allow 60 seconds for generation

// Error classification helper
function classifyError(error: unknown): { code: string; message: string; status: number } {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const lowerMessage = errorMessage.toLowerCase();

    // Rate limiting
    if (lowerMessage.includes('rate limit') || lowerMessage.includes('too many requests') || lowerMessage.includes('429')) {
        return {
            code: 'RATE_LIMIT',
            message: 'Rate limit exceeded. Please wait a moment before trying again.',
            status: 429
        };
    }

    // Authentication errors
    if (lowerMessage.includes('api key') || lowerMessage.includes('unauthorized') || lowerMessage.includes('401') || lowerMessage.includes('invalid_api_key')) {
        return {
            code: 'INVALID_API_KEY',
            message: 'Invalid or missing API key. Check your .env.local configuration.',
            status: 401
        };
    }

    // Network/connection errors
    if (lowerMessage.includes('network') || lowerMessage.includes('econnrefused') || lowerMessage.includes('fetch failed') || lowerMessage.includes('timeout')) {
        return {
            code: 'NETWORK_ERROR',
            message: 'Network error. Check your internet connection or the AI provider status.',
            status: 503
        };
    }

    // Model not found
    if (lowerMessage.includes('model') && (lowerMessage.includes('not found') || lowerMessage.includes('does not exist'))) {
        return {
            code: 'MODEL_NOT_FOUND',
            message: 'The requested model is not available. It may have been deprecated or renamed.',
            status: 404
        };
    }

    // Content policy violations
    if (lowerMessage.includes('content policy') || lowerMessage.includes('safety') || lowerMessage.includes('blocked')) {
        return {
            code: 'CONTENT_BLOCKED',
            message: 'The request was blocked due to content policy. Please rephrase your message.',
            status: 400
        };
    }

    // Context length exceeded
    if (lowerMessage.includes('context length') || lowerMessage.includes('too long') || lowerMessage.includes('max tokens')) {
        return {
            code: 'CONTEXT_TOO_LONG',
            message: 'The conversation is too long. Try starting a new session or shortening your messages.',
            status: 400
        };
    }

    // Provider-specific errors
    if (lowerMessage.includes('anthropic')) {
        return {
            code: 'ANTHROPIC_ERROR',
            message: `Anthropic API error: ${errorMessage}`,
            status: 502
        };
    }
    if (lowerMessage.includes('openai')) {
        return {
            code: 'OPENAI_ERROR',
            message: `OpenAI API error: ${errorMessage}`,
            status: 502
        };
    }
    if (lowerMessage.includes('google') || lowerMessage.includes('gemini')) {
        return {
            code: 'GOOGLE_ERROR',
            message: `Google AI error: ${errorMessage}`,
            status: 502
        };
    }

    // Generic provider error
    return {
        code: 'PROVIDER_ERROR',
        message: errorMessage || 'An unexpected error occurred with the AI provider.',
        status: 500
    };
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { messages, model, system } = body as {
            messages?: UIMessage[];
            model?: string;
            system?: string;
        };

        // Validate required fields
        if (!messages || !Array.isArray(messages)) {
            return Response.json(
                { error: { code: 'INVALID_REQUEST', message: 'Messages array is required' } },
                { status: 400 }
            );
        }

        // Get the model (this can throw if model not found)
        let selectedModel;
        try {
            selectedModel = getModel(model || 'gpt-4o-mini');
        } catch (modelError) {
            return Response.json(
                { error: { code: 'MODEL_NOT_FOUND', message: `Model "${model}" not found in registry` } },
                { status: 404 }
            );
        }

        const modelMessages = await convertToModelMessages(messages);

        const result = await streamText({
            model: selectedModel,
            messages: modelMessages,
            system: system || "You are a helpful AI assistant in the Agent Conductor system. Be concise and precise.",
            // Add abort signal for better timeout handling
            abortSignal: AbortSignal.timeout(55000), // 55s to leave buffer before maxDuration
        });

        return result.toUIMessageStreamResponse();

    } catch (error) {
        console.error('[API /chat] Error:', error);

        const classified = classifyError(error);

        return Response.json(
            {
                error: {
                    code: classified.code,
                    message: classified.message,
                }
            },
            { status: classified.status }
        );
    }
}

// Handle OPTIONS for CORS if needed
export async function OPTIONS() {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        },
    });
}
