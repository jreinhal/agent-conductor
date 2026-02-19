/**
 * Adapter Integration Tests
 *
 * Tests for the MockAdapter, AdapterRegistry, and ClaudeCodeAdapter.
 * These tests verify the core adapter contract and registry behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockAdapter } from '@/lib/adapters/mock-adapter';
import { ClaudeCodeAdapter } from '@/lib/adapters/claude-code-adapter';
import { AdapterRegistry } from '@/lib/adapters/registry';
import type { AgentAdapter, AgentConfig } from '@/lib/adapters/types';

// ─── Helpers ─────────────────────────────────────────────────────────

const defaultConfig: AgentConfig = {
  cwd: process.cwd(),
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── MockAdapter: Scripted Responses ─────────────────────────────────

describe('MockAdapter', () => {
  describe('scripted responses', () => {
    it('should return scripted responses in order', async () => {
      const adapter = new MockAdapter({
        responses: [
          { output: 'response-1' },
          { output: 'response-2' },
          { output: 'response-3' },
        ],
        responseDelay: 10,
      });

      const proc = await adapter.spawn(defaultConfig);
      expect(proc.running).toBe(true);
      expect(proc.health).toBe('healthy');

      const received: string[] = [];
      adapter.onOutput(proc, (output) => received.push(output));

      await adapter.sendPrompt(proc, 'first');
      await delay(50);
      expect(received).toEqual(['response-1']);

      await adapter.sendPrompt(proc, 'second');
      await delay(50);
      expect(received).toEqual(['response-1', 'response-2']);

      await adapter.sendPrompt(proc, 'third');
      await delay(50);
      expect(received).toEqual(['response-1', 'response-2', 'response-3']);
    });

    it('should deliver nothing when scripted responses are exhausted', async () => {
      const adapter = new MockAdapter({
        responses: [{ output: 'only-one' }],
        responseDelay: 10,
      });

      const proc = await adapter.spawn(defaultConfig);
      const received: string[] = [];
      adapter.onOutput(proc, (output) => received.push(output));

      await adapter.sendPrompt(proc, 'first');
      await delay(50);
      expect(received).toEqual(['only-one']);

      await adapter.sendPrompt(proc, 'second — no response expected');
      await delay(50);
      expect(received).toEqual(['only-one']);
    });
  });

  // ─── MockAdapter: Crash Simulation ───────────────────────────────

  describe('crash simulation', () => {
    it('should crash after N responses', async () => {
      const adapter = new MockAdapter({
        responses: [
          { output: 'ok-1' },
          { output: 'ok-2' },
          { output: 'never-delivered' },
        ],
        responseDelay: 10,
        crashAfterResponses: 2,
      });

      const proc = await adapter.spawn(defaultConfig);
      const received: string[] = [];
      adapter.onOutput(proc, (output) => received.push(output));

      // First two prompts succeed
      await adapter.sendPrompt(proc, 'prompt-1');
      await delay(50);
      await adapter.sendPrompt(proc, 'prompt-2');
      await delay(50);
      expect(received).toEqual(['ok-1', 'ok-2']);

      // Third prompt triggers crash
      await expect(adapter.sendPrompt(proc, 'prompt-3')).rejects.toThrow(
        /Mock crash after 2 responses/,
      );
      expect(proc.running).toBe(false);
      expect(proc.health).toBe('unhealthy');
      expect(proc.failureCount).toBeGreaterThan(0);
    });

    it('should crash on spawn when shouldCrash is true', async () => {
      const adapter = new MockAdapter({
        responses: [],
        shouldCrash: true,
      });

      const proc = await adapter.spawn(defaultConfig);
      expect(proc.running).toBe(false);
      expect(proc.health).toBe('unhealthy');
      expect(proc.failureCount).toBe(1);
      expect(proc.lastError).toBeDefined();
    });
  });

  // ─── MockAdapter: Timeout Simulation ─────────────────────────────

  describe('timeout simulation', () => {
    it('should never deliver a response when shouldTimeout is true', async () => {
      const adapter = new MockAdapter({
        responses: [{ output: 'should-not-arrive' }],
        responseDelay: 10,
        shouldTimeout: true,
      });

      const proc = await adapter.spawn(defaultConfig);
      const received: string[] = [];
      adapter.onOutput(proc, (output) => received.push(output));

      await adapter.sendPrompt(proc, 'hello?');
      // Wait well beyond the response delay
      await delay(100);
      expect(received).toEqual([]);
      // Process remains alive (it just never responds)
      expect(adapter.isAlive(proc)).toBe(true);
    });
  });

  // ─── MockAdapter: Malformed Output ───────────────────────────────

  describe('malformed output', () => {
    it('should produce garbled output when malformedOutput is true', async () => {
      const adapter = new MockAdapter({
        responses: [{ output: 'hello world' }],
        responseDelay: 10,
        malformedOutput: true,
      });

      const proc = await adapter.spawn(defaultConfig);
      const received: string[] = [];
      adapter.onOutput(proc, (output) => received.push(output));

      await adapter.sendPrompt(proc, 'prompt');
      await delay(50);

      expect(received.length).toBe(1);
      // Malformed output should NOT equal the original
      expect(received[0]).not.toBe('hello world');
      // Should contain the garbled prefix marker
      expect(received[0]).toContain('GARBLED');
    });
  });

  // ─── MockAdapter: Lifecycle ──────────────────────────────────────

  describe('lifecycle', () => {
    it('isAvailable always returns true', async () => {
      const adapter = new MockAdapter({ responses: [] });
      expect(await adapter.isAvailable()).toBe(true);
    });

    it('isAlive returns false after kill', async () => {
      const adapter = new MockAdapter({
        responses: [{ output: 'x' }],
        responseDelay: 10,
      });

      const proc = await adapter.spawn(defaultConfig);
      expect(adapter.isAlive(proc)).toBe(true);

      await adapter.kill(proc);
      expect(adapter.isAlive(proc)).toBe(false);
    });

    it('isAlive returns false for unknown process id', () => {
      const adapter = new MockAdapter({ responses: [] });
      const fakeProc = {
        id: 'nonexistent',
        adapterName: 'mock',
        health: 'healthy' as const,
        running: true,
        failureCount: 0,
      };
      expect(adapter.isAlive(fakeProc)).toBe(false);
    });

    it('sendPrompt throws when process is not running', async () => {
      const adapter = new MockAdapter({
        responses: [],
        shouldCrash: true,
      });

      const proc = await adapter.spawn(defaultConfig);
      await expect(adapter.sendPrompt(proc, 'test')).rejects.toThrow(
        /not running/,
      );
    });

    it('kill clears pending timers and stops delivery', async () => {
      const adapter = new MockAdapter({
        responses: [{ output: 'delayed', delay: 500 }],
      });

      const proc = await adapter.spawn(defaultConfig);
      const received: string[] = [];
      adapter.onOutput(proc, (output) => received.push(output));

      await adapter.sendPrompt(proc, 'go');
      // Kill before the delayed response is delivered
      await adapter.kill(proc);
      await delay(600);
      expect(received).toEqual([]);
    });
  });
});

// ─── AdapterRegistry ─────────────────────────────────────────────────

describe('AdapterRegistry', () => {
  let registry: AdapterRegistry;

  beforeEach(() => {
    registry = new AdapterRegistry();
  });

  it('should register and retrieve adapters', () => {
    const adapter = new MockAdapter({ responses: [] });
    registry.register(adapter);
    expect(registry.get('mock')).toBe(adapter);
  });

  it('should return undefined for unregistered adapter names', () => {
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('should list all registered adapters', () => {
    const mock1 = new MockAdapter({ responses: [] });
    const mock2 = new ClaudeCodeAdapter();
    registry.register(mock1);
    registry.register(mock2);
    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list.map((a) => a.name)).toEqual(['mock', 'claude-code']);
  });

  it('should replace an adapter when registering with the same name', () => {
    const mock1 = new MockAdapter({ responses: [{ output: 'a' }] });
    const mock2 = new MockAdapter({ responses: [{ output: 'b' }] });
    registry.register(mock1);
    registry.register(mock2);
    expect(registry.get('mock')).toBe(mock2);
    expect(registry.list()).toHaveLength(1);
  });

  it('should throw when registering an adapter with empty name', () => {
    const badAdapter = {
      name: '',
      capabilities: {
        canReadFiles: false,
        canWriteFiles: false,
        canExecuteCommands: false,
        supportsStreaming: false,
        supportsConversation: false,
        maxContextTokens: null,
      },
      isAvailable: async () => true,
      spawn: async () => ({
        id: '1',
        adapterName: '',
        health: 'healthy' as const,
        running: true,
        failureCount: 0,
      }),
      sendPrompt: async () => {},
      onOutput: () => () => {},
      isAlive: () => true,
      kill: async () => {},
    } satisfies AgentAdapter;

    expect(() => registry.register(badAdapter)).toThrow(/name must not be empty/);
  });

  describe('discoverAvailable', () => {
    it('should return only available adapters', async () => {
      const availableAdapter: AgentAdapter = {
        name: 'available-tool',
        capabilities: {
          canReadFiles: false,
          canWriteFiles: false,
          canExecuteCommands: false,
          supportsStreaming: false,
          supportsConversation: false,
          maxContextTokens: null,
        },
        isAvailable: async () => true,
        spawn: async () => ({
          id: '1',
          adapterName: 'available-tool',
          health: 'healthy' as const,
          running: true,
          failureCount: 0,
        }),
        sendPrompt: async () => {},
        onOutput: () => () => {},
        isAlive: () => true,
        kill: async () => {},
      };

      const unavailableAdapter: AgentAdapter = {
        name: 'unavailable-tool',
        capabilities: {
          canReadFiles: false,
          canWriteFiles: false,
          canExecuteCommands: false,
          supportsStreaming: false,
          supportsConversation: false,
          maxContextTokens: null,
        },
        isAvailable: async () => false,
        spawn: async () => ({
          id: '2',
          adapterName: 'unavailable-tool',
          health: 'healthy' as const,
          running: true,
          failureCount: 0,
        }),
        sendPrompt: async () => {},
        onOutput: () => () => {},
        isAlive: () => true,
        kill: async () => {},
      };

      registry.register(availableAdapter);
      registry.register(unavailableAdapter);

      const available = await registry.discoverAvailable();
      expect(available).toHaveLength(1);
      expect(available[0].name).toBe('available-tool');
    });

    it('should treat adapters that throw during isAvailable as unavailable', async () => {
      const throwingAdapter: AgentAdapter = {
        name: 'throwing-tool',
        capabilities: {
          canReadFiles: false,
          canWriteFiles: false,
          canExecuteCommands: false,
          supportsStreaming: false,
          supportsConversation: false,
          maxContextTokens: null,
        },
        isAvailable: async () => {
          throw new Error('CLI not found');
        },
        spawn: async () => ({
          id: '1',
          adapterName: 'throwing-tool',
          health: 'healthy' as const,
          running: true,
          failureCount: 0,
        }),
        sendPrompt: async () => {},
        onOutput: () => () => {},
        isAlive: () => true,
        kill: async () => {},
      };

      registry.register(throwingAdapter);

      const available = await registry.discoverAvailable();
      expect(available).toHaveLength(0);
    });

    it('should return empty array when no adapters are registered', async () => {
      const available = await registry.discoverAvailable();
      expect(available).toEqual([]);
    });
  });
});

// ─── ClaudeCodeAdapter ───────────────────────────────────────────────

describe('ClaudeCodeAdapter', () => {
  it('should have correct name and capabilities', () => {
    const adapter = new ClaudeCodeAdapter();
    expect(adapter.name).toBe('claude-code');
    expect(adapter.capabilities.canReadFiles).toBe(true);
    expect(adapter.capabilities.canWriteFiles).toBe(true);
    expect(adapter.capabilities.canExecuteCommands).toBe(true);
    expect(adapter.capabilities.supportsStreaming).toBe(true);
    expect(adapter.capabilities.supportsConversation).toBe(true);
    expect(adapter.capabilities.maxContextTokens).toBe(200_000);
  });

  it('isAvailable returns a boolean (may be false in CI)', async () => {
    const adapter = new ClaudeCodeAdapter();
    const result = await adapter.isAvailable();
    expect(typeof result).toBe('boolean');
  });
});
