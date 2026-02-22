import { describe, expect, it } from 'vitest';
import { decideModelRoute } from '@/lib/decision-router';

describe('decision router', () => {
    it('passes through explicit model selections', () => {
        const decision = decideModelRoute({
            requestedModel: 'gpt-5.2',
            messages: [{ role: 'user', content: 'hello' }],
        });

        expect(decision.isAuto).toBe(false);
        expect(decision.selectedModel).toBe('gpt-5.2');
        expect(decision.fallbackModels).toEqual([]);
    });

    it('routes coding prompts to codex', () => {
        const decision = decideModelRoute({
            requestedModel: 'auto-router',
            messages: [
                { role: 'user', content: 'Fix this TypeScript bug. Here is the stack trace and failing test.' },
            ],
        });

        expect(decision.isAuto).toBe(true);
        expect(decision.selectedModel).toBe('gpt-5.3-codex');
    });

    it('routes deep reasoning prompts to opus', () => {
        const decision = decideModelRoute({
            requestedModel: 'auto-router',
            messages: [
                {
                    role: 'user',
                    content: 'Compare architecture tradeoffs and provide a migration strategy with detailed analysis and root cause reasoning.',
                },
            ],
        });

        expect(decision.selectedModel).toBe('claude-opus-4.6');
    });

    it('routes short quick prompts to flash', () => {
        const decision = decideModelRoute({
            requestedModel: 'auto-router',
            messages: [{ role: 'user', content: 'Quick: what is the time complexity of binary search?' }],
        });

        expect(decision.selectedModel).toBe('gemini-3-flash');
    });

    it('routes factual/time-sensitive prompts to high-accuracy model', () => {
        const decision = decideModelRoute({
            requestedModel: 'auto-router',
            messages: [
                {
                    role: 'user',
                    content: 'As of today, what day of the week is February 21, 2026? Verify and be accurate.',
                },
            ],
        });

        expect(decision.selectedModel).toBe('gpt-5.2');
        expect(decision.reason).toContain('factual/time-sensitive');
    });
});
