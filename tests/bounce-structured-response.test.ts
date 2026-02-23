/**
 * Tests for Phase 1: Structured Bounce Response parsing + convergence exit
 */
import { describe, it, expect } from 'vitest';
import { tryParseStructuredResponse } from '../lib/bounce-orchestrator';
import { StructuredBounceResponseSchema } from '../lib/bounce-types';

describe('tryParseStructuredResponse', () => {
    const validJson = {
        thought: 'This is a complex topic requiring careful analysis.',
        proposal: 'Use TypeScript strict mode for better type safety.',
        confidence: 85,
        reasoning: 'Static typing catches bugs early and improves maintainability.',
        critiques: ['Adds compile-time overhead', 'Learning curve for new devs'],
        concessions: ['Runtime performance is identical to JavaScript'],
        stance: 'agree',
    };

    it('parses JSON wrapped in markdown code fences', () => {
        const content = `Here is my analysis:\n\`\`\`json\n${JSON.stringify(validJson)}\n\`\`\``;
        const result = tryParseStructuredResponse(content);
        expect(result).not.toBeNull();
        expect(result!.confidence).toBe(85);
        expect(result!.stance).toBe('agree');
        expect(result!.proposal).toContain('TypeScript');
    });

    it('parses JSON in plain code fences (no language tag)', () => {
        const content = `\`\`\`\n${JSON.stringify(validJson)}\n\`\`\``;
        const result = tryParseStructuredResponse(content);
        expect(result).not.toBeNull();
        expect(result!.stance).toBe('agree');
    });

    it('parses raw JSON object containing "stance"', () => {
        const content = `I think this is the way to go. ${JSON.stringify(validJson)} That's my response.`;
        const result = tryParseStructuredResponse(content);
        expect(result).not.toBeNull();
        expect(result!.confidence).toBe(85);
    });

    it('returns null for content without JSON', () => {
        const content = 'I agree with the proposal. My confidence is high.';
        expect(tryParseStructuredResponse(content)).toBeNull();
    });

    it('returns null for invalid JSON structure', () => {
        const content = '```json\n{"not_valid": true}\n```';
        expect(tryParseStructuredResponse(content)).toBeNull();
    });

    it('returns null for JSON with out-of-range confidence', () => {
        const badJson = { ...validJson, confidence: 150 };
        const content = `\`\`\`json\n${JSON.stringify(badJson)}\n\`\`\``;
        expect(tryParseStructuredResponse(content)).toBeNull();
    });

    it('returns null for JSON with invalid stance enum', () => {
        const badJson = { ...validJson, stance: 'maybe' };
        const content = `\`\`\`json\n${JSON.stringify(badJson)}\n\`\`\``;
        expect(tryParseStructuredResponse(content)).toBeNull();
    });

    it('handles content with multiple brace blocks (picks correct one)', () => {
        const preamble = 'Thinking about options: { "thought": "skip this" }';
        const content = `${preamble}\n\nFinal answer:\n${JSON.stringify(validJson)}`;
        const result = tryParseStructuredResponse(content);
        expect(result).not.toBeNull();
        expect(result!.stance).toBe('agree');
    });
});

describe('StructuredBounceResponseSchema', () => {
    it('validates a well-formed response', () => {
        const data = {
            thought: 'test',
            proposal: 'test proposal',
            confidence: 50,
            reasoning: 'because',
            critiques: ['one', 'two'],
            concessions: [],
            stance: 'neutral',
        };
        const result = StructuredBounceResponseSchema.safeParse(data);
        expect(result.success).toBe(true);
    });

    it('rejects confidence below 0', () => {
        const data = {
            thought: 'test',
            proposal: 'p',
            confidence: -1,
            reasoning: 'r',
            critiques: [],
            concessions: [],
            stance: 'agree',
        };
        expect(StructuredBounceResponseSchema.safeParse(data).success).toBe(false);
    });

    it('rejects confidence above 100', () => {
        const data = {
            thought: 'test',
            proposal: 'p',
            confidence: 101,
            reasoning: 'r',
            critiques: [],
            concessions: [],
            stance: 'agree',
        };
        expect(StructuredBounceResponseSchema.safeParse(data).success).toBe(false);
    });

    it('rejects missing required fields', () => {
        const data = { thought: 'test', confidence: 50 };
        expect(StructuredBounceResponseSchema.safeParse(data).success).toBe(false);
    });

    it('accepts all valid stance values', () => {
        const stances = [
            'strongly_agree', 'agree', 'neutral', 'disagree',
            'strongly_disagree', 'refine', 'synthesize',
        ];
        for (const stance of stances) {
            const data = {
                thought: 't', proposal: 'p', confidence: 50,
                reasoning: 'r', critiques: [], concessions: [], stance,
            };
            expect(StructuredBounceResponseSchema.safeParse(data).success).toBe(true);
        }
    });
});
