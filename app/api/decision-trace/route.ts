import { NextResponse } from 'next/server';
import {
    clearDecisionTraceStore,
    readDecisionTraceStore,
} from '@/lib/decision-trace-store';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const store = await readDecisionTraceStore();

    const url = new URL(req.url);
    const requestId = url.searchParams.get('requestId')?.trim();
    const sessionId = url.searchParams.get('sessionId')?.trim();
    const limitRaw = url.searchParams.get('limit');
    const parsedLimit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined;

    if (requestId) {
        const entry = store.entries.find((item) => item.requestId === requestId) || null;
        return NextResponse.json({ entry });
    }

    if (sessionId) {
        const entries = store.entries.filter((item) => item.sessionId === sessionId);
        const sliced = typeof limit === 'number'
            ? entries.slice(0, limit)
            : entries;
        return NextResponse.json({
            entries: sliced,
            updatedAt: store.updatedAt,
        });
    }

    if (typeof limit === 'number') {
        return NextResponse.json({
            entries: store.entries.slice(0, limit),
            updatedAt: store.updatedAt,
        });
    }

    return NextResponse.json(store);
}

export async function DELETE() {
    const store = await clearDecisionTraceStore();
    return NextResponse.json(store);
}
