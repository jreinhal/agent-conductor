import { randomUUID } from 'crypto';
import { runLocalCliChat } from '@/lib/cli-chat';
import { decideModelRoute } from '@/lib/decision-router';
import { appendDecisionTraceEntry, type DecisionTraceAttempt } from '@/lib/decision-trace-store';
import { SimpleCircuitBreaker } from '@/lib/simple-circuit-breaker';

export const maxDuration = 300;
const ROUTED_MODEL_TIMEOUT_MS = 130_000;
const MODEL_BREAKER_FAILURE_THRESHOLD = 2;
const MODEL_BREAKER_COOLDOWN_MS = 45_000;
const MODEL_BREAKERS = new Map<string, SimpleCircuitBreaker>();

interface UIMessageLike {
    role?: string;
    content?: string;
    parts?: Array<{ type?: string; text?: string }>;
}

interface ChatRequestBody {
    messages?: UIMessageLike[];
    model?: string;
    system?: string;
    sessionId?: string;
    requestId?: string;
}

function extractLatestUserPreview(messages: UIMessageLike[]): string {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i];
        if ((message.role || 'user') !== 'user') continue;

        const content = typeof message.content === 'string'
            ? message.content
            : Array.isArray(message.parts)
                ? message.parts
                    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
                    .map((part) => part.text as string)
                    .join(' ')
                : '';

        const normalized = content.replace(/\s+/g, ' ').trim();
        return normalized.slice(0, 220);
    }
    return '';
}

function extractLatestUserMessage(messages: UIMessageLike[]): string {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i];
        if ((message.role || 'user') !== 'user') continue;

        const content = typeof message.content === 'string'
            ? message.content
            : Array.isArray(message.parts)
                ? message.parts
                    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
                    .map((part) => part.text as string)
                    .join(' ')
                : '';

        const normalized = content.replace(/\s+/g, ' ').trim();
        if (normalized) return normalized;
    }
    return '';
}

function getModelBreaker(modelId: string): SimpleCircuitBreaker {
    let breaker = MODEL_BREAKERS.get(modelId);
    if (!breaker) {
        breaker = new SimpleCircuitBreaker({
            failureThreshold: MODEL_BREAKER_FAILURE_THRESHOLD,
            cooldownMs: MODEL_BREAKER_COOLDOWN_MS,
        });
        MODEL_BREAKERS.set(modelId, breaker);
    }
    return breaker;
}

function normalizeQualityText(value: string): string {
    return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function isActionablePrompt(prompt: string): boolean {
    const normalized = normalizeQualityText(prompt);
    if (normalized.split(' ').length < 4) return false;
    return /reply with|answer with|return|what is|who is|when is|where is|how many|calculate|write|generate|summarize|fix|debug|compare|explain/i.test(normalized);
}

function isClarificationLoop(text: string): boolean {
    return /could you clarify|can you clarify|what do you mean|are you referring to|something else\?/i.test(text);
}

function violatesStrictShape(prompt: string, response: string): boolean {
    const normalizedPrompt = normalizeQualityText(prompt);
    const normalizedResponse = response.trim();

    if (/model name only/.test(normalizedPrompt)) {
        const tokenCount = normalizedResponse.split(/\s+/).filter(Boolean).length;
        return tokenCount > 8 || normalizedResponse.includes('?');
    }

    if (/one word only|return one word/.test(normalizedPrompt)) {
        const tokenCount = normalizedResponse.split(/\s+/).filter(Boolean).length;
        return tokenCount !== 1;
    }

    if (/only the number|return only the number/.test(normalizedPrompt)) {
        return !/^\s*-?\d+(\.\d+)?\s*$/.test(normalizedResponse);
    }

    if (/only|exactly|no explanation/.test(normalizedPrompt)) {
        return normalizedResponse.split(/\r?\n/).length > 2 || normalizedResponse.length > 120;
    }

    return false;
}

function shouldRejectForQuality(prompt: string, response: string): { reject: boolean; reason: string } {
    const trimmed = response.trim();
    if (!trimmed) return { reject: true, reason: 'empty-response' };

    if (isActionablePrompt(prompt) && isClarificationLoop(trimmed)) {
        return { reject: true, reason: 'clarification-loop' };
    }

    if (violatesStrictShape(prompt, trimmed)) {
        return { reject: true, reason: 'strict-shape-violation' };
    }

    return { reject: false, reason: 'ok' };
}

async function safeAppendDecisionTrace(entry: Parameters<typeof appendDecisionTraceEntry>[0]) {
    try {
        await appendDecisionTraceEntry(entry);
    } catch (error) {
        console.error('[API /chat] Failed to append decision trace:', error);
    }
}

function toSseEvent(payload: object): string {
    return `data: ${JSON.stringify(payload)}\n\n`;
}

function createUIMessageStreamResponse(
    text: string,
    meta?: {
        requestedModel: string;
        routedModel: string;
        routeReason: string;
        isAuto: boolean;
        durationMs: number;
        attemptCount: number;
        fallbackUsed: boolean;
    }
): Response {
    const messageId = `msg_${randomUUID().replace(/-/g, '')}`;
    const textId = `text_${randomUUID().replace(/-/g, '')}`;
    const encoder = new TextEncoder();
    const normalized = text.trim() || 'No output returned.';

    const chunks: string[] = [
        toSseEvent({ type: 'start', messageId }),
        toSseEvent({ type: 'start-step' }),
        toSseEvent({ type: 'text-start', id: textId }),
        ...normalized
            .match(/[\s\S]{1,1000}/g)
            ?.map((delta) => toSseEvent({ type: 'text-delta', id: textId, delta })) || [],
        toSseEvent({ type: 'text-end', id: textId }),
        toSseEvent({ type: 'finish-step' }),
        toSseEvent({ type: 'finish', finishReason: 'stop' }),
        'data: [DONE]\n\n',
    ];

    const stream = new ReadableStream({
        start(controller) {
            for (const chunk of chunks) {
                controller.enqueue(encoder.encode(chunk));
            }
            controller.close();
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            ...(meta ? {
                'X-AgentConductor-Requested-Model': meta.requestedModel,
                'X-AgentConductor-Routed-Model': meta.routedModel,
                'X-AgentConductor-Route-Reason': meta.routeReason,
                'X-AgentConductor-Route-Mode': meta.isAuto ? 'auto' : 'explicit',
                'X-AgentConductor-Duration-Ms': String(meta.durationMs),
                'X-AgentConductor-Attempt-Count': String(meta.attemptCount),
                'X-AgentConductor-Fallback-Used': String(meta.fallbackUsed),
            } : {}),
        },
    });
}

function createErrorStreamResponse(errorText: string): Response {
    const messageId = `msg_${randomUUID().replace(/-/g, '')}`;
    const encoder = new TextEncoder();
    const chunks: string[] = [
        toSseEvent({ type: 'start', messageId }),
        toSseEvent({ type: 'start-step' }),
        toSseEvent({ type: 'error', errorText }),
        toSseEvent({ type: 'finish-step' }),
        toSseEvent({ type: 'finish', finishReason: 'other' }),
        'data: [DONE]\n\n',
    ];

    const stream = new ReadableStream({
        start(controller) {
            for (const chunk of chunks) {
                controller.enqueue(encoder.encode(chunk));
            }
            controller.close();
        },
    });

    return new Response(stream, {
        status: 200,
        headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
        },
    });
}

async function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutLabel: string): Promise<T> {
    let timeoutId: NodeJS.Timeout | undefined;

    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timeoutId = setTimeout(() => {
                    reject(new Error(`Timed out waiting for ${timeoutLabel} after ${Math.round(timeoutMs / 1000)}s`));
                }, timeoutMs);
            }),
        ]);
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

export async function POST(req: Request) {
    try {
        const startedAt = Date.now();
        const body = (await req.json()) as ChatRequestBody;
        const messages = Array.isArray(body.messages) ? body.messages : [];
        const requestedModel = body.model || 'gpt-5.3-codex';
        const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';

        if (messages.length === 0) {
            return createErrorStreamResponse('No messages were provided.');
        }

        const decision = decideModelRoute({
            requestedModel,
            messages,
            system: body.system,
        });

        const candidates = [decision.selectedModel, ...decision.fallbackModels];
        let routedModel = decision.selectedModel;
        let text = '';
        let lastError: unknown;
        const attempts: DecisionTraceAttempt[] = [];
        const latestUserMessagePreview = extractLatestUserPreview(messages);
        const latestUserMessage = extractLatestUserMessage(messages);

        for (const candidate of candidates) {
            const breaker = getModelBreaker(candidate);
            if (!breaker.allowRequest()) {
                const snapshot = breaker.snapshot();
                attempts.push({
                    modelId: candidate,
                    ok: false,
                    error: `circuit-open:${snapshot.cooldownRemainingMs}`,
                });
                continue;
            }

            try {
                text = await runWithTimeout(
                    runLocalCliChat(candidate, messages, body.system),
                    ROUTED_MODEL_TIMEOUT_MS,
                    candidate
                );

                if (latestUserMessage && decision.isAuto) {
                    const qualityGate = shouldRejectForQuality(latestUserMessage, text);
                    if (qualityGate.reject) {
                        throw new Error(`quality-gate:${qualityGate.reason}`);
                    }
                }

                breaker.recordSuccess();
                routedModel = candidate;
                lastError = undefined;
                attempts.push({ modelId: candidate, ok: true });
                break;
            } catch (error) {
                breaker.recordFailure();
                lastError = error;
                attempts.push({
                    modelId: candidate,
                    ok: false,
                    error: error instanceof Error ? error.message : String(error),
                });
                if (!decision.isAuto) {
                    throw error;
                }
            }
        }

        if (!text) {
            const finalError = lastError || new Error('No routed model produced a response.');
            await safeAppendDecisionTrace({
                id: `trace_${randomUUID().replace(/-/g, '')}`,
                createdAt: new Date().toISOString(),
                requestId: requestId || undefined,
                sessionId: sessionId || undefined,
                requestedModel,
                selectedModel: decision.selectedModel,
                executedModel: routedModel,
                fallbackModels: decision.fallbackModels,
                isAuto: decision.isAuto,
                reason: decision.reason,
                scores: decision.scores,
                status: 'failed',
                attempts,
                durationMs: Date.now() - startedAt,
                latestUserMessagePreview,
            });
            throw finalError;
        }

        const durationMs = Date.now() - startedAt;
        await safeAppendDecisionTrace({
            id: `trace_${randomUUID().replace(/-/g, '')}`,
            createdAt: new Date().toISOString(),
            requestId: requestId || undefined,
            sessionId: sessionId || undefined,
            requestedModel,
            selectedModel: decision.selectedModel,
            executedModel: routedModel,
            fallbackModels: decision.fallbackModels,
            isAuto: decision.isAuto,
            reason: decision.reason,
            scores: decision.scores,
            status: 'success',
            attempts,
            durationMs,
            latestUserMessagePreview,
        });

        return createUIMessageStreamResponse(text, {
            requestedModel,
            routedModel,
            routeReason: decision.reason,
            isAuto: decision.isAuto,
            durationMs,
            attemptCount: attempts.length,
            fallbackUsed: routedModel !== decision.selectedModel,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[API /chat] CLI error:', error);
        return createErrorStreamResponse(message || 'Failed to run local CLI model.');
    }
}

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
