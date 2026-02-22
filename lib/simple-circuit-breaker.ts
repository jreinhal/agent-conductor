export type CircuitBreakerState = 'closed' | 'open' | 'half_open';

interface CircuitBreakerOptions {
    failureThreshold?: number;
    cooldownMs?: number;
}

export interface CircuitBreakerSnapshot {
    state: CircuitBreakerState;
    consecutiveFailures: number;
    openedAtMs: number | null;
    cooldownRemainingMs: number;
}

/**
 * Deterministic in-memory circuit breaker.
 * Same sequence of allow/success/failure events yields the same state transitions.
 */
export class SimpleCircuitBreaker {
    private state: CircuitBreakerState = 'closed';
    private consecutiveFailures = 0;
    private openedAtMs: number | null = null;
    private readonly failureThreshold: number;
    private readonly cooldownMs: number;

    constructor(options: CircuitBreakerOptions = {}) {
        this.failureThreshold = Math.max(1, options.failureThreshold ?? 3);
        this.cooldownMs = Math.max(1000, options.cooldownMs ?? 45_000);
    }

    allowRequest(nowMs = Date.now()): boolean {
        if (this.state === 'closed') return true;

        if (this.state === 'open') {
            if (this.openedAtMs === null) {
                this.openedAtMs = nowMs;
                return false;
            }

            if (nowMs - this.openedAtMs >= this.cooldownMs) {
                this.state = 'half_open';
                return true;
            }

            return false;
        }

        // half_open allows a single probe request.
        return true;
    }

    recordSuccess() {
        this.state = 'closed';
        this.consecutiveFailures = 0;
        this.openedAtMs = null;
    }

    recordFailure(nowMs = Date.now()) {
        this.consecutiveFailures += 1;

        if (this.state === 'half_open' || this.consecutiveFailures >= this.failureThreshold) {
            this.state = 'open';
            this.openedAtMs = nowMs;
        }
    }

    snapshot(nowMs = Date.now()): CircuitBreakerSnapshot {
        const cooldownRemainingMs =
            this.state === 'open' && this.openedAtMs !== null
                ? Math.max(0, this.cooldownMs - (nowMs - this.openedAtMs))
                : 0;

        return {
            state: this.state,
            consecutiveFailures: this.consecutiveFailures,
            openedAtMs: this.openedAtMs,
            cooldownRemainingMs,
        };
    }
}
