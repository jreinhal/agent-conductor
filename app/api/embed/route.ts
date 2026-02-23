import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/embed
 *
 * Compute cosine similarity between text pairs using OpenAI embeddings.
 * Falls back gracefully when OPENAI_API_KEY is not set.
 *
 * Body: { texts: string[] }
 * Returns: { embeddings: number[][], model: string } or { error: string }
 */
const MAX_EMBEDDING_BATCH_SIZE = 20;

export async function POST(req: NextRequest) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        return NextResponse.json(
            { error: 'OPENAI_API_KEY not configured — embedding similarity unavailable' },
            { status: 503 }
        );
    }

    const body = await req.json();
    const texts: string[] = body.texts;

    if (!Array.isArray(texts) || texts.length === 0 || texts.length > MAX_EMBEDDING_BATCH_SIZE) {
        return NextResponse.json(
            { error: `texts must be an array of 1-${MAX_EMBEDDING_BATCH_SIZE} strings` },
            { status: 400 }
        );
    }

    try {
        const response = await fetch('https://api.openai.com/v1/embeddings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: 'text-embedding-3-small',
                input: texts.map(t => t.slice(0, 8000)), // truncate to model limit
            }),
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            return NextResponse.json(
                { error: err?.error?.message || `OpenAI API error: ${response.status}` },
                { status: response.status }
            );
        }

        const data = await response.json();
        const embeddings: number[][] = data.data
            .sort((a: { index: number }, b: { index: number }) => a.index - b.index)
            .map((d: { embedding: number[] }) => d.embedding);

        return NextResponse.json({ embeddings, model: 'text-embedding-3-small' });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Embedding request failed' },
            { status: 502 }
        );
    }
}
