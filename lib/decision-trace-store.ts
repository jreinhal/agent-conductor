import { promises as fs } from 'fs';
import path from 'path';

export interface DecisionTraceAttempt {
    modelId: string;
    ok: boolean;
    error?: string;
}

export interface DecisionTraceScores {
    codingIntent: number;
    deepReasoning: number;
    speedPreference: number;
    factualPrecision: number;
}

export interface DecisionTraceEntry {
    id: string;
    createdAt: string;
    requestId?: string;
    sessionId?: string;
    requestedModel: string;
    selectedModel: string;
    executedModel: string;
    fallbackModels: string[];
    isAuto: boolean;
    reason: string;
    scores: DecisionTraceScores;
    status: 'success' | 'failed';
    attempts: DecisionTraceAttempt[];
    durationMs: number;
    latestUserMessagePreview?: string;
}

interface DecisionTraceStore {
    entries: DecisionTraceEntry[];
    updatedAt: string;
}

const STORE_PATH = process.env.DECISION_TRACE_STORE_PATH
    ? path.resolve(process.env.DECISION_TRACE_STORE_PATH)
    : path.join(process.cwd(), '.data', 'decision-trace.json');

const MAX_ENTRIES = 300;

function defaultStore(): DecisionTraceStore {
    return {
        entries: [],
        updatedAt: new Date().toISOString(),
    };
}

async function ensureStoreDirectory() {
    await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
}

function normalizeEntry(entry: DecisionTraceEntry): DecisionTraceEntry {
    return {
        id: String(entry.id || `${Date.now()}`),
        createdAt: String(entry.createdAt || new Date().toISOString()),
        requestId: entry.requestId ? String(entry.requestId) : undefined,
        sessionId: entry.sessionId ? String(entry.sessionId) : undefined,
        requestedModel: String(entry.requestedModel || ''),
        selectedModel: String(entry.selectedModel || ''),
        executedModel: String(entry.executedModel || ''),
        fallbackModels: Array.isArray(entry.fallbackModels)
            ? entry.fallbackModels.map((model) => String(model))
            : [],
        isAuto: Boolean(entry.isAuto),
        reason: String(entry.reason || ''),
        scores: {
            codingIntent: Number(entry.scores?.codingIntent || 0),
            deepReasoning: Number(entry.scores?.deepReasoning || 0),
            speedPreference: Number(entry.scores?.speedPreference || 0),
            factualPrecision: Number(entry.scores?.factualPrecision || 0),
        },
        status: entry.status === 'failed' ? 'failed' : 'success',
        attempts: Array.isArray(entry.attempts)
            ? entry.attempts.map((attempt) => ({
                modelId: String(attempt?.modelId || ''),
                ok: Boolean(attempt?.ok),
                error: attempt?.error ? String(attempt.error) : undefined,
            }))
            : [],
        durationMs: Number.isFinite(entry.durationMs) ? entry.durationMs : 0,
        latestUserMessagePreview: entry.latestUserMessagePreview
            ? String(entry.latestUserMessagePreview)
            : undefined,
    };
}

export async function readDecisionTraceStore(): Promise<DecisionTraceStore> {
    try {
        const raw = await fs.readFile(STORE_PATH, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<DecisionTraceStore>;
        const entries = Array.isArray(parsed?.entries)
            ? parsed.entries
                .map((entry) => {
                    try {
                        return normalizeEntry(entry as DecisionTraceEntry);
                    } catch {
                        return null;
                    }
                })
                .filter((entry): entry is DecisionTraceEntry => entry !== null)
            : [];

        return {
            entries,
            updatedAt: typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
        };
    } catch {
        return defaultStore();
    }
}

export async function writeDecisionTraceStore(entries: DecisionTraceEntry[]) {
    const normalized = entries.map(normalizeEntry).slice(0, MAX_ENTRIES);
    const store: DecisionTraceStore = {
        entries: normalized,
        updatedAt: new Date().toISOString(),
    };

    await ensureStoreDirectory();
    await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
    return store;
}

export async function appendDecisionTraceEntry(entry: DecisionTraceEntry) {
    const store = await readDecisionTraceStore();
    return writeDecisionTraceStore([normalizeEntry(entry), ...store.entries]);
}

export async function clearDecisionTraceStore() {
    return writeDecisionTraceStore([]);
}
