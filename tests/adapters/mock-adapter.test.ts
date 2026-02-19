/**
 * Mock Adapter — Detailed Behavior Tests
 *
 * Thorough tests for the MockAdapter covering deterministic response
 * ordering, crash simulation cleanup, per-response delay overrides,
 * unsubscribe semantics, and edge cases.
 */

import { describe, it, expect } from 'vitest';
import { MockAdapter } from '@/lib/adapters/mock-adapter';
import type { AgentConfig } from '@/lib/adapters/types';

// ─── Helpers ─────────────────────────────────────────────────────────

const defaultConfig: AgentConfig = {
  cwd: process.cwd(),
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Deterministic Response Ordering ─────────────────────────────────

describe('MockAdapter — deterministic ordering', () => {
  it('should deliver responses in exact insertion order', async () => {
    const adapter = new MockAdapter({
      responses: [
        { output: 'alpha' },
        { output: 'bravo' },
        { output: 'charlie' },
        { output: 'delta' },
      ],
      responseDelay: 5,
    });

    const proc = await adapter.spawn(defaultConfig);
    const received: string[] = [];
    adapter.onOutput(proc, (output) => received.push(output));

    for (let i = 0; i < 4; i++) {
      await adapter.sendPrompt(proc, `prompt-${i}`);
      await delay(30);
    }

    expect(received).toEqual(['alpha', 'bravo', 'charlie', 'delta']);
  });

  it('should not repeat responses on extra prompts', async () => {
    const adapter = new MockAdapter({
      responses: [{ output: 'once' }],
      responseDelay: 5,
    });

    const proc = await adapter.spawn(defaultConfig);
    const received: string[] = [];
    adapter.onOutput(proc, (output) => received.push(output));

    await adapter.sendPrompt(proc, 'p1');
    await delay(30);
    await adapter.sendPrompt(proc, 'p2');
    await delay(30);
    await adapter.sendPrompt(proc, 'p3');
    await delay(30);

    expect(received).toEqual(['once']);
  });

  it('should handle zero responses config gracefully', async () => {
    const adapter = new MockAdapter({
      responses: [],
      responseDelay: 5,
    });

    const proc = await adapter.spawn(defaultConfig);
    const received: string[] = [];
    adapter.onOutput(proc, (output) => received.push(output));

    await adapter.sendPrompt(proc, 'anything');
    await delay(30);

    expect(received).toEqual([]);
    expect(adapter.isAlive(proc)).toBe(true);
  });
});

// ─── Per-Response Delay Overrides ────────────────────────────────────

describe('MockAdapter — per-response delays', () => {
  it('should respect per-response delay overrides', async () => {
    const adapter = new MockAdapter({
      responses: [
        { output: 'fast', delay: 5 },
        { output: 'slow', delay: 200 },
      ],
      responseDelay: 1000, // global default is high
    });

    const proc = await adapter.spawn(defaultConfig);
    const received: string[] = [];
    adapter.onOutput(proc, (output) => received.push(output));

    // First prompt: fast response
    await adapter.sendPrompt(proc, 'p1');
    await delay(30);
    expect(received).toEqual(['fast']);

    // Second prompt: slow response — check it hasn't arrived yet
    await adapter.sendPrompt(proc, 'p2');
    await delay(30);
    expect(received).toEqual(['fast']); // not yet

    // Wait for slow response
    await delay(250);
    expect(received).toEqual(['fast', 'slow']);
  });
});

// ─── Crash Simulation Cleanup ────────────────────────────────────────

describe('MockAdapter — crash simulation cleanup', () => {
  it('should mark process unhealthy after crash-after-N', async () => {
    const adapter = new MockAdapter({
      responses: [{ output: 'ok' }, { output: 'ok' }, { output: 'unreachable' }],
      responseDelay: 5,
      crashAfterResponses: 2,
    });

    const proc = await adapter.spawn(defaultConfig);

    await adapter.sendPrompt(proc, 'p1');
    await adapter.sendPrompt(proc, 'p2');

    await expect(adapter.sendPrompt(proc, 'p3')).rejects.toThrow();

    expect(proc.running).toBe(false);
    expect(proc.health).toBe('unhealthy');
    expect(adapter.isAlive(proc)).toBe(false);
  });

  it('should not deliver pending responses after crash', async () => {
    const adapter = new MockAdapter({
      responses: [{ output: 'ok' }, { output: 'pending', delay: 200 }],
      responseDelay: 5,
      crashAfterResponses: 1,
    });

    const proc = await adapter.spawn(defaultConfig);
    const received: string[] = [];
    adapter.onOutput(proc, (output) => received.push(output));

    // First prompt succeeds
    await adapter.sendPrompt(proc, 'p1');
    await delay(30);
    expect(received).toEqual(['ok']);

    // Second prompt crashes
    await expect(adapter.sendPrompt(proc, 'p2')).rejects.toThrow();

    // Wait and ensure nothing extra arrives
    await delay(300);
    expect(received).toEqual(['ok']);
  });

  it('shouldCrash=true produces an unhealthy process on spawn', async () => {
    const adapter = new MockAdapter({
      responses: [{ output: 'never' }],
      shouldCrash: true,
    });

    const proc = await adapter.spawn(defaultConfig);
    expect(proc.running).toBe(false);
    expect(proc.health).toBe('unhealthy');
    expect(proc.failureCount).toBe(1);
    expect(proc.lastError).toContain('crash');
  });
});

// ─── Timeout Simulation ──────────────────────────────────────────────

describe('MockAdapter — timeout simulation', () => {
  it('should never deliver output when shouldTimeout is true', async () => {
    const adapter = new MockAdapter({
      responses: [{ output: 'phantom' }],
      responseDelay: 5,
      shouldTimeout: true,
    });

    const proc = await adapter.spawn(defaultConfig);
    const received: string[] = [];
    adapter.onOutput(proc, (output) => received.push(output));

    await adapter.sendPrompt(proc, 'hello');
    await delay(100);

    expect(received).toEqual([]);
    // The process itself is still considered alive
    expect(adapter.isAlive(proc)).toBe(true);
    expect(proc.health).toBe('healthy');
  });
});

// ─── Malformed Output ────────────────────────────────────────────────

describe('MockAdapter — malformed output', () => {
  it('should produce garbled output that differs from the original', async () => {
    const original = 'clean structured response';
    const adapter = new MockAdapter({
      responses: [{ output: original }],
      responseDelay: 5,
      malformedOutput: true,
    });

    const proc = await adapter.spawn(defaultConfig);
    const received: string[] = [];
    adapter.onOutput(proc, (output) => received.push(output));

    await adapter.sendPrompt(proc, 'p');
    await delay(30);

    expect(received).toHaveLength(1);
    expect(received[0]).not.toBe(original);
    expect(received[0]).toContain('GARBLED');
  });

  it('should garble each response independently', async () => {
    const adapter = new MockAdapter({
      responses: [{ output: 'aaa' }, { output: 'bbb' }],
      responseDelay: 5,
      malformedOutput: true,
    });

    const proc = await adapter.spawn(defaultConfig);
    const received: string[] = [];
    adapter.onOutput(proc, (output) => received.push(output));

    await adapter.sendPrompt(proc, 'p1');
    await delay(30);
    await adapter.sendPrompt(proc, 'p2');
    await delay(30);

    expect(received).toHaveLength(2);
    expect(received[0]).not.toBe(received[1]);
  });
});

// ─── Listener / Unsubscribe Semantics ────────────────────────────────

describe('MockAdapter — listener management', () => {
  it('should support multiple simultaneous listeners', async () => {
    const adapter = new MockAdapter({
      responses: [{ output: 'broadcast' }],
      responseDelay: 5,
    });

    const proc = await adapter.spawn(defaultConfig);
    const received1: string[] = [];
    const received2: string[] = [];

    adapter.onOutput(proc, (o) => received1.push(o));
    adapter.onOutput(proc, (o) => received2.push(o));

    await adapter.sendPrompt(proc, 'go');
    await delay(30);

    expect(received1).toEqual(['broadcast']);
    expect(received2).toEqual(['broadcast']);
  });

  it('should stop delivering to unsubscribed listeners', async () => {
    const adapter = new MockAdapter({
      responses: [{ output: 'first' }, { output: 'second' }],
      responseDelay: 5,
    });

    const proc = await adapter.spawn(defaultConfig);
    const received: string[] = [];
    const unsub = adapter.onOutput(proc, (o) => received.push(o));

    await adapter.sendPrompt(proc, 'p1');
    await delay(30);
    expect(received).toEqual(['first']);

    // Unsubscribe
    unsub();

    await adapter.sendPrompt(proc, 'p2');
    await delay(30);
    // Should not receive the second response
    expect(received).toEqual(['first']);
  });

  it('should throw when registering listener on unknown process', () => {
    const adapter = new MockAdapter({ responses: [] });
    const fakeProc = {
      id: 'ghost',
      adapterName: 'mock',
      health: 'healthy' as const,
      running: true,
      failureCount: 0,
    };

    expect(() => adapter.onOutput(fakeProc, () => {})).toThrow(
      /No managed process found/,
    );
  });
});

// ─── Kill Semantics ──────────────────────────────────────────────────

describe('MockAdapter — kill semantics', () => {
  it('should be safe to kill an already-killed process', async () => {
    const adapter = new MockAdapter({
      responses: [{ output: 'x' }],
      responseDelay: 5,
    });

    const proc = await adapter.spawn(defaultConfig);
    await adapter.kill(proc);
    // Second kill should not throw
    await adapter.kill(proc);
    expect(adapter.isAlive(proc)).toBe(false);
  });

  it('should prevent further sendPrompt after kill', async () => {
    const adapter = new MockAdapter({
      responses: [{ output: 'x' }],
      responseDelay: 5,
    });

    const proc = await adapter.spawn(defaultConfig);
    await adapter.kill(proc);

    await expect(adapter.sendPrompt(proc, 'nope')).rejects.toThrow();
  });

  it('should cancel in-flight delayed responses on kill', async () => {
    const adapter = new MockAdapter({
      responses: [{ output: 'delayed', delay: 300 }],
    });

    const proc = await adapter.spawn(defaultConfig);
    const received: string[] = [];
    adapter.onOutput(proc, (o) => received.push(o));

    await adapter.sendPrompt(proc, 'go');
    // Kill before delivery
    await delay(10);
    await adapter.kill(proc);
    // Wait past delivery time
    await delay(400);
    expect(received).toEqual([]);
  });
});

// ─── Adapter Contract Basics ─────────────────────────────────────────

describe('MockAdapter — adapter contract', () => {
  it('has name "mock"', () => {
    const adapter = new MockAdapter({ responses: [] });
    expect(adapter.name).toBe('mock');
  });

  it('has expected capabilities', () => {
    const adapter = new MockAdapter({ responses: [] });
    expect(adapter.capabilities.canReadFiles).toBe(false);
    expect(adapter.capabilities.canWriteFiles).toBe(false);
    expect(adapter.capabilities.canExecuteCommands).toBe(false);
    expect(adapter.capabilities.supportsStreaming).toBe(false);
    expect(adapter.capabilities.supportsConversation).toBe(true);
    expect(adapter.capabilities.maxContextTokens).toBeNull();
  });

  it('isAvailable always resolves to true', async () => {
    const adapter = new MockAdapter({ responses: [] });
    expect(await adapter.isAvailable()).toBe(true);
  });
});
