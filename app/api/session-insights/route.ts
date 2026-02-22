import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const METRICS_SCHEMA = z.object({
    activeSessions: z.number(),
    totalMessages: z.number(),
    userMessages: z.number(),
    assistantMessages: z.number(),
    totalTokens: z.number(),
    estimatedCost: z.number(),
    topModel: z.string(),
});

const ENTRY_SCHEMA = z.object({
    id: z.string(),
    createdAt: z.string(),
    note: z.string(),
    metrics: METRICS_SCHEMA.optional(),
});

const STORE_SCHEMA = z.object({
    entries: z.array(ENTRY_SCHEMA),
    updatedAt: z.string(),
});

const POST_SCHEMA = z.object({
    note: z.string().min(1).max(4000),
    metrics: METRICS_SCHEMA.optional(),
});

const STORE_PATH = process.env.SESSION_INSIGHTS_STORE_PATH
    ? path.resolve(process.env.SESSION_INSIGHTS_STORE_PATH)
    : path.join(process.cwd(), '.data', 'session-insights.json');

export const dynamic = 'force-dynamic';

type SessionInsightEntry = z.infer<typeof ENTRY_SCHEMA>;

function defaultStore() {
    return {
        entries: [] as SessionInsightEntry[],
        updatedAt: new Date().toISOString(),
    };
}

async function ensureStoreDirectory() {
    await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
}

async function readStore() {
    try {
        const raw = await fs.readFile(STORE_PATH, 'utf-8');
        const parsed = JSON.parse(raw) as unknown;
        const validated = STORE_SCHEMA.safeParse(parsed);
        if (!validated.success) {
            return defaultStore();
        }
        return validated.data;
    } catch {
        return defaultStore();
    }
}

async function writeStore(entries: SessionInsightEntry[]) {
    const store = {
        entries: entries.slice(0, 200),
        updatedAt: new Date().toISOString(),
    };

    await ensureStoreDirectory();
    await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
    return store;
}

export async function GET() {
    const store = await readStore();
    return NextResponse.json(store);
}

export async function POST(req: Request) {
    try {
        const body = (await req.json()) as unknown;
        const parsed = POST_SCHEMA.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                { error: 'Invalid session insight payload.', details: parsed.error.flatten() },
                { status: 400 }
            );
        }

        const store = await readStore();
        const nextEntry: SessionInsightEntry = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            createdAt: new Date().toISOString(),
            note: parsed.data.note.trim(),
            metrics: parsed.data.metrics,
        };

        const updated = await writeStore([nextEntry, ...store.entries]);
        return NextResponse.json(updated);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return NextResponse.json(
            { error: message || 'Failed to save session insight.' },
            { status: 500 }
        );
    }
}

export async function DELETE() {
    const cleared = await writeStore([]);
    return NextResponse.json(cleared);
}
