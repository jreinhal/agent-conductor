import { describe, expect, it } from 'vitest';
import { SimpleCircuitBreaker } from '@/lib/simple-circuit-breaker';

describe('SimpleCircuitBreaker', () => {
    it('opens after threshold failures and cools down deterministically', () => {
        const breaker = new SimpleCircuitBreaker({ failureThreshold: 2, cooldownMs: 1000 });
        const t0 = 1_000_000;

        expect(breaker.allowRequest(t0)).toBe(true);
        breaker.recordFailure(t0);
        expect(breaker.allowRequest(t0 + 1)).toBe(true);

        breaker.recordFailure(t0 + 2);
        expect(breaker.allowRequest(t0 + 500)).toBe(false);
        expect(breaker.allowRequest(t0 + 1_100)).toBe(true);
    });

    it('closes on successful half-open probe', () => {
        const breaker = new SimpleCircuitBreaker({ failureThreshold: 1, cooldownMs: 1000 });
        const t0 = 2_000_000;

        breaker.recordFailure(t0);
        expect(breaker.allowRequest(t0 + 200)).toBe(false);
        expect(breaker.allowRequest(t0 + 1_100)).toBe(true);

        breaker.recordSuccess();
        expect(breaker.allowRequest(t0 + 1_101)).toBe(true);
        expect(breaker.snapshot(t0 + 1_101).state).toBe('closed');
    });
});
