/**
 * Tests for Phase 2: TF-IDF cosine similarity + embedding cosine similarity
 */
import { describe, it, expect } from 'vitest';
import { cosineSimilarity, analyzeConsensus } from '../lib/consensus-analyzer';
import type { BounceResponse } from '../lib/bounce-types';

describe('cosineSimilarity', () => {
    it('returns 1 for identical vectors', () => {
        const v = [1, 2, 3, 4, 5];
        expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
    });

    it('returns 0 for orthogonal vectors', () => {
        expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    });

    it('returns a value between 0 and 1 for similar vectors', () => {
        const a = [1, 2, 3];
        const b = [1, 2, 4];
        const sim = cosineSimilarity(a, b);
        expect(sim).toBeGreaterThan(0.9);
        expect(sim).toBeLessThan(1.0);
    });

    it('returns 0 for empty vectors', () => {
        expect(cosineSimilarity([], [])).toBe(0);
    });

    it('returns 0 for mismatched lengths', () => {
        expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    });
});

describe('TF-IDF similarity in analyzeConsensus', () => {
    function makeResponse(sessionId: string, content: string, stance: string = 'agree'): BounceResponse {
        return {
            participantSessionId: sessionId,
            modelId: `model-${sessionId}`,
            modelTitle: `Model ${sessionId}`,
            stance: stance as BounceResponse['stance'],
            content,
            keyPoints: [],
            agreements: [],
            disagreements: [],
            confidence: 0.7,
            durationMs: 100,
            timestamp: Date.now(),
        };
    }

    it('scores similar content higher than dissimilar content', () => {
        const similar = analyzeConsensus([
            makeResponse('a', 'TypeScript provides static type checking which catches bugs early in the development process'),
            makeResponse('b', 'Static type checking in TypeScript helps identify bugs before runtime in the development workflow'),
        ]);

        const dissimilar = analyzeConsensus([
            makeResponse('a', 'TypeScript provides static type checking which catches bugs early in the development process'),
            makeResponse('b', 'Python is great for machine learning with libraries like TensorFlow and PyTorch for deep neural networks'),
        ]);

        expect(similar.score).toBeGreaterThan(dissimilar.score);
    });

    it('uses embeddings when provided', () => {
        const embeddings = new Map<string, number[]>();
        // Simulate high-similarity embeddings
        embeddings.set('a', [0.9, 0.1, 0.3]);
        embeddings.set('b', [0.88, 0.12, 0.31]);

        const withEmbeddings = analyzeConsensus(
            [
                makeResponse('a', 'totally different text one'),
                makeResponse('b', 'completely unrelated text two'),
            ],
            { embeddings }
        );

        const withoutEmbeddings = analyzeConsensus([
            makeResponse('a', 'totally different text one'),
            makeResponse('b', 'completely unrelated text two'),
        ]);

        // With similar embeddings, score should be higher than TF-IDF on dissimilar text
        expect(withEmbeddings.score).toBeGreaterThan(withoutEmbeddings.score);
    });

    it('handles single response correctly', () => {
        const result = analyzeConsensus([
            makeResponse('a', 'Just one model responding'),
        ]);
        expect(result.score).toBe(1.0);
        expect(result.level).toBe('unanimous');
    });
});
