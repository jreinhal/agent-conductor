import { streamText } from 'ai';
import { getModel } from '@/lib/ai';

export const maxDuration = 120; // Allow 2 minutes for multi-model debate rounds

/**
 * Dedicated Bounce/Debate API Endpoint
 *
 * Handles single-turn debate responses with structured output.
 * The orchestrator calls this for each participant response.
 */

interface BounceRequest {
    model: string;
    system: string;
    prompt: string;
    previousResponses?: {
        modelId: string;
        modelTitle: string;
        content: string;
    }[];
    roundNumber?: number;
}

// Error classification (reused from chat route)
function classifyError(error: unknown): { code: string; message: string; status: number } {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const lowerMessage = errorMessage.toLowerCase();

    if (lowerMessage.includes('rate limit') || lowerMessage.includes('429')) {
        return {
            code: 'RATE_LIMIT',
            message: 'Rate limit exceeded. Please wait before continuing the debate.',
            status: 429
        };
    }

    if (lowerMessage.includes('api key') || lowerMessage.includes('unauthorized') || lowerMessage.includes('401')) {
        return {
            code: 'INVALID_API_KEY',
            message: 'Invalid or missing API key for this model.',
            status: 401
        };
    }

    if (lowerMessage.includes('network') || lowerMessage.includes('timeout') || lowerMessage.includes('fetch failed')) {
        return {
            code: 'NETWORK_ERROR',
            message: 'Network error communicating with AI provider.',
            status: 503
        };
    }

    if (lowerMessage.includes('context length') || lowerMessage.includes('too long')) {
        return {
            code: 'CONTEXT_TOO_LONG',
            message: 'Debate context too long. Try reducing the number of rounds or participants.',
            status: 400
        };
    }

    return {
        code: 'PROVIDER_ERROR',
        message: errorMessage || 'An error occurred during the debate.',
        status: 500
    };
}

export async function POST(req: Request) {
    try {
        const body: BounceRequest = await req.json();
        const { model, system, prompt, previousResponses, roundNumber } = body;

        // Validate required fields
        if (!prompt) {
            return Response.json(
                { error: { code: 'INVALID_REQUEST', message: 'Prompt is required' } },
                { status: 400 }
            );
        }

        // Get the model
        let selectedModel;
        try {
            selectedModel = getModel(model || 'claude-opus-4.6');
        } catch (modelError) {
            return Response.json(
                { error: { code: 'MODEL_NOT_FOUND', message: `Model "${model}" not found` } },
                { status: 404 }
            );
        }

        // Build the message with context from previous responses
        let fullPrompt = prompt;

        if (previousResponses && previousResponses.length > 0) {
            const context = previousResponses
                .map(r => `### ${r.modelTitle}\n${r.content}`)
                .join('\n\n---\n\n');

            fullPrompt = `## Previous Responses${roundNumber ? ` (Round ${roundNumber})` : ''}\n\n${context}\n\n---\n\n## Your Response\n\n${prompt}`;
        }

        // Stream the response
        const result = await streamText({
            model: selectedModel,
            messages: [{ role: 'user', content: fullPrompt }],
            system: system || "You are participating in a structured multi-model debate. Be concise, clear, and collaborative.",
            abortSignal: AbortSignal.timeout(110000), // 110s to leave buffer
        });

        return result.toDataStreamResponse();

    } catch (error) {
        console.error('[API /bounce] Error:', error);

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

// Handle OPTIONS for CORS
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
