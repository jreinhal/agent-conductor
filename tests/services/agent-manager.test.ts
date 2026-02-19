/**
 * Tests for the AgentManager service.
 *
 * Uses inline mock adapters (no external mock-adapter dependency).
 * All tests clean up agents and health checks in afterEach.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentManager } from '../../electron/services/agent-manager';
import type {
  AgentAdapter,
  AgentProcess,
  AgentConfig,
  AgentCapabilities,
} from '../../lib/adapters/types';

// ─── Mock Adapter Factory ────────────────────────────────────────────

/** Shared capabilities for mock adapters. */
const mockCapabilities: AgentCapabilities = {
  canReadFiles: false,
  canWriteFiles: false,
  canExecuteCommands: false,
  supportsStreaming: false,
  supportsConversation: true,
  maxContextTokens: null,
};

let nextMockId = 0;

/** Create a mock adapter with configurable behavior. */
function createMockAdapter(
  overrides: {
    name?: string;
    spawnFn?: (config: AgentConfig) => Promise<AgentProcess>;
    isAliveFn?: (process: AgentProcess) => boolean;
    killFn?: (process: AgentProcess) => Promise<void>;
    sendPromptFn?: (process: AgentProcess, prompt: string) => Promise<void>;
    onOutputFn?: (
      process: AgentProcess,
      callback: (output: string) => void,
    ) => () => void;
  } = {},
): AgentAdapter {
  const adapterName = overrides.name ?? 'mock-adapter';

  return {
    name: adapterName,
    capabilities: mockCapabilities,

    isAvailable: async () => true,

    spawn:
      overrides.spawnFn ??
      (async (config: AgentConfig): Promise<AgentProcess> => {
        const id = `mock-${++nextMockId}`;
        return {
          id,
          adapterName,
          health: 'healthy',
          pid: 1000 + nextMockId,
          running: true,
          failureCount: 0,
        };
      }),

    sendPrompt:
      overrides.sendPromptFn ??
      (async (_process: AgentProcess, _prompt: string): Promise<void> => {
        // no-op
      }),

    onOutput:
      overrides.onOutputFn ??
      ((_process: AgentProcess, _callback: (output: string) => void) => {
        // Return no-op unsubscribe
        return () => {};
      }),

    isAlive:
      overrides.isAliveFn ??
      ((process: AgentProcess): boolean => {
        return process.running;
      }),

    kill:
      overrides.killFn ??
      (async (process: AgentProcess): Promise<void> => {
        process.running = false;
      }),
  };
}

// ─── Test Suite ──────────────────────────────────────────────────────

describe('AgentManager', () => {
  let manager: AgentManager;

  beforeEach(() => {
    nextMockId = 0;
    vi.useFakeTimers();
    manager = new AgentManager({
      maxConcurrent: 3,
      healthCheckIntervalMs: 1_000,
      circuitBreakerMaxFailures: 3,
      circuitBreakerCooldownMs: 5_000,
      restartBackoffBaseMs: 100,
      maxRestartAttempts: 3,
    });
  });

  afterEach(async () => {
    manager.stopHealthChecks();
    // Kill all agents manually, ignoring errors
    for (const agent of manager.listAgents()) {
      try {
        await manager.killAgent(agent.id);
      } catch {
        // swallow
      }
    }
    manager.removeAllListeners();
    vi.useRealTimers();
  });

  // ── Spawn ────────────────────────────────────────────────────────

  describe('spawnAgent', () => {
    it('should spawn an agent successfully', async () => {
      const adapter = createMockAdapter();
      manager.registerAdapter(adapter);

      const events: Array<{ processId: string; adapterName: string }> = [];
      manager.on('agent-spawned', (e) => events.push(e));

      const process = await manager.spawnAgent('mock-adapter', { cwd: '/tmp' });

      expect(process).toBeDefined();
      expect(process.id).toBeTruthy();
      expect(process.running).toBe(true);
      expect(process.adapterName).toBe('mock-adapter');
      expect(events).toHaveLength(1);
      expect(events[0].processId).toBe(process.id);
      expect(events[0].adapterName).toBe('mock-adapter');
    });

    it('should throw when adapter is not registered', async () => {
      await expect(
        manager.spawnAgent('nonexistent', { cwd: '/tmp' }),
      ).rejects.toThrow('No adapter registered with name "nonexistent"');
    });

    it('should throw when manager is shutting down', async () => {
      const adapter = createMockAdapter();
      manager.registerAdapter(adapter);

      // Trigger shutdown
      const shutdownPromise = manager.shutdown();
      vi.advanceTimersByTime(10_000);
      await shutdownPromise;

      // Re-register since shutdown clears state
      manager = new AgentManager();
      manager.registerAdapter(adapter);
      // Start shutdown but don't await
      const p = manager.shutdown();

      await expect(
        manager.spawnAgent('mock-adapter', { cwd: '/tmp' }),
      ).rejects.toThrow('shutting down');

      vi.advanceTimersByTime(10_000);
      await p;
    });
  });

  // ── Kill ─────────────────────────────────────────────────────────

  describe('killAgent', () => {
    it('should kill an agent and clean up properly', async () => {
      const adapter = createMockAdapter();
      manager.registerAdapter(adapter);

      const stoppedEvents: Array<{ processId: string; reason: string }> = [];
      manager.on('agent-stopped', (e) => stoppedEvents.push(e));

      const process = await manager.spawnAgent('mock-adapter', { cwd: '/tmp' });
      expect(manager.listAgents()).toHaveLength(1);

      await manager.killAgent(process.id);

      expect(manager.listAgents()).toHaveLength(0);
      expect(manager.getAgent(process.id)).toBeUndefined();
      expect(stoppedEvents).toHaveLength(1);
      expect(stoppedEvents[0].processId).toBe(process.id);
      expect(stoppedEvents[0].reason).toBe('killed');
    });

    it('should throw when agent does not exist', async () => {
      await expect(manager.killAgent('nonexistent-id')).rejects.toThrow(
        'No agent found with id "nonexistent-id"',
      );
    });
  });

  // ── Kill All ─────────────────────────────────────────────────────

  describe('killAll', () => {
    it('should terminate all running agents', async () => {
      const adapter = createMockAdapter();
      manager.registerAdapter(adapter);

      await manager.spawnAgent('mock-adapter', { cwd: '/tmp' });
      await manager.spawnAgent('mock-adapter', { cwd: '/tmp' });
      await manager.spawnAgent('mock-adapter', { cwd: '/tmp' });

      expect(manager.listAgents()).toHaveLength(3);

      await manager.killAll();

      expect(manager.listAgents()).toHaveLength(0);
    });
  });

  // ── Concurrency Limit ────────────────────────────────────────────

  describe('concurrency limit', () => {
    it('should reject spawn when maxConcurrent reached', async () => {
      const adapter = createMockAdapter();
      manager.registerAdapter(adapter);

      // Spawn 3 agents (maxConcurrent is 3)
      await manager.spawnAgent('mock-adapter', { cwd: '/tmp' });
      await manager.spawnAgent('mock-adapter', { cwd: '/tmp' });
      await manager.spawnAgent('mock-adapter', { cwd: '/tmp' });

      // 4th should fail
      await expect(
        manager.spawnAgent('mock-adapter', { cwd: '/tmp' }),
      ).rejects.toThrow('Concurrency limit reached: 3/3 agents running');
    });

    it('should allow spawn after killing an agent', async () => {
      const adapter = createMockAdapter();
      manager.registerAdapter(adapter);

      const p1 = await manager.spawnAgent('mock-adapter', { cwd: '/tmp' });
      await manager.spawnAgent('mock-adapter', { cwd: '/tmp' });
      await manager.spawnAgent('mock-adapter', { cwd: '/tmp' });

      // Kill one
      await manager.killAgent(p1.id);

      // Should succeed now
      const p4 = await manager.spawnAgent('mock-adapter', { cwd: '/tmp' });
      expect(p4.running).toBe(true);
      expect(manager.listAgents()).toHaveLength(3);
    });
  });

  // ── Graceful Shutdown ────────────────────────────────────────────

  describe('shutdown', () => {
    it('should kill all agents during graceful shutdown', async () => {
      const killCalls: string[] = [];
      const adapter = createMockAdapter({
        killFn: async (process: AgentProcess) => {
          killCalls.push(process.id);
          process.running = false;
        },
      });
      manager.registerAdapter(adapter);

      const stoppedEvents: Array<{ processId: string; reason: string }> = [];
      manager.on('agent-stopped', (e) => stoppedEvents.push(e));

      await manager.spawnAgent('mock-adapter', { cwd: '/tmp' });
      await manager.spawnAgent('mock-adapter', { cwd: '/tmp' });

      expect(manager.listAgents()).toHaveLength(2);

      const shutdownPromise = manager.shutdown();
      // Advance past the 5s force-kill wait
      vi.advanceTimersByTime(10_000);
      await shutdownPromise;

      expect(killCalls).toHaveLength(2);
      expect(stoppedEvents).toHaveLength(2);
      expect(stoppedEvents.every((e) => e.reason === 'shutdown')).toBe(true);
      expect(manager.listAgents()).toHaveLength(0);
    });

    it('should stop health checks during shutdown', async () => {
      const adapter = createMockAdapter();
      manager.registerAdapter(adapter);

      manager.startHealthChecks();
      await manager.spawnAgent('mock-adapter', { cwd: '/tmp' });

      const shutdownPromise = manager.shutdown();
      vi.advanceTimersByTime(10_000);
      await shutdownPromise;

      // After shutdown, health checks should be stopped
      // Verify by checking no errors occur after advancing time
      vi.advanceTimersByTime(10_000);
    });
  });

  // ── Circuit Breaker ──────────────────────────────────────────────

  describe('circuit breaker', () => {
    it('should mark adapter unhealthy after N failures', async () => {
      let callCount = 0;
      const adapter = createMockAdapter({
        name: 'failing-adapter',
        spawnFn: async (): Promise<AgentProcess> => {
          callCount++;
          throw new Error(`Spawn failure #${callCount}`);
        },
      });
      manager.registerAdapter(adapter);

      // Fail 3 times (circuitBreakerMaxFailures = 3)
      for (let i = 0; i < 3; i++) {
        await expect(
          manager.spawnAgent('failing-adapter', { cwd: '/tmp' }),
        ).rejects.toThrow('Spawn failure');
      }

      const cb = manager.getCircuitBreakerState('failing-adapter');
      expect(cb).toBeDefined();
      expect(cb!.health).toBe('unhealthy');
      expect(cb!.failureCount).toBe(3);

      // Next attempt should be rejected by circuit breaker
      await expect(
        manager.spawnAgent('failing-adapter', { cwd: '/tmp' }),
      ).rejects.toThrow('circuit breaker open');
    });

    it('should probe after cooldown and recover on success', async () => {
      let shouldFail = true;
      let spawnCount = 0;
      const adapter = createMockAdapter({
        name: 'recovering-adapter',
        spawnFn: async (): Promise<AgentProcess> => {
          spawnCount++;
          if (shouldFail) {
            throw new Error('Spawn failure');
          }
          return {
            id: `recovered-${spawnCount}`,
            adapterName: 'recovering-adapter',
            health: 'healthy',
            running: true,
            failureCount: 0,
          };
        },
      });
      manager.registerAdapter(adapter);

      // Trip the circuit breaker
      for (let i = 0; i < 3; i++) {
        await expect(
          manager.spawnAgent('recovering-adapter', { cwd: '/tmp' }),
        ).rejects.toThrow();
      }

      const cb = manager.getCircuitBreakerState('recovering-adapter');
      expect(cb!.health).toBe('unhealthy');

      // Advance past cooldown
      vi.advanceTimersByTime(6_000);

      // Now make spawn succeed
      shouldFail = false;
      const process = await manager.spawnAgent('recovering-adapter', {
        cwd: '/tmp',
      });

      expect(process.running).toBe(true);
      expect(cb!.health).toBe('healthy');
      expect(cb!.failureCount).toBe(0);
    });

    it('should return to unhealthy if probe fails', async () => {
      const adapter = createMockAdapter({
        name: 'always-failing',
        spawnFn: async (): Promise<AgentProcess> => {
          throw new Error('Always fails');
        },
      });
      manager.registerAdapter(adapter);

      // Trip the circuit breaker
      for (let i = 0; i < 3; i++) {
        await expect(
          manager.spawnAgent('always-failing', { cwd: '/tmp' }),
        ).rejects.toThrow();
      }

      const cb = manager.getCircuitBreakerState('always-failing');
      expect(cb!.health).toBe('unhealthy');

      // Advance past cooldown
      vi.advanceTimersByTime(6_000);

      // Probe attempt should fail
      await expect(
        manager.spawnAgent('always-failing', { cwd: '/tmp' }),
      ).rejects.toThrow('Always fails');

      // Should be back to unhealthy
      expect(cb!.health).toBe('unhealthy');
    });
  });

  // ── Restart with Backoff ────────────────────────────────────────

  describe('restart with backoff', () => {
    it('should auto-restart a crashed agent with exponential backoff', async () => {
      let spawnCount = 0;
      const adapter = createMockAdapter({
        name: 'restartable',
        spawnFn: async (): Promise<AgentProcess> => {
          spawnCount++;
          return {
            id: `restart-agent-${spawnCount}`,
            adapterName: 'restartable',
            health: 'healthy',
            running: true,
            failureCount: 0,
          };
        },
        isAliveFn: (process: AgentProcess): boolean => {
          return process.running;
        },
      });
      manager.registerAdapter(adapter);

      const restartEvents: Array<{ processId: string; attempt: number }> = [];
      manager.on('agent-restarted', (e) => restartEvents.push(e));

      const process = await manager.spawnAgent('restartable', { cwd: '/tmp' });
      expect(spawnCount).toBe(1);

      // Simulate crash by marking not-alive
      process.running = false;

      // Run health check to detect crash
      manager.runHealthChecks();

      // Advance past backoff delay (100ms * 2^0 = 100ms)
      await vi.advanceTimersByTimeAsync(150);

      // Should have restarted
      expect(spawnCount).toBe(2);
      expect(restartEvents).toHaveLength(1);
      expect(restartEvents[0].attempt).toBe(1);
    });

    it('should stop retrying after maxRestartAttempts', async () => {
      let spawnCount = 0;
      const adapter = createMockAdapter({
        name: 'crash-loop',
        spawnFn: async (): Promise<AgentProcess> => {
          spawnCount++;
          return {
            id: 'crash-loop-agent',
            adapterName: 'crash-loop',
            health: 'healthy',
            running: true,
            failureCount: 0,
          };
        },
        isAliveFn: (): boolean => {
          // Always report dead after initial spawn
          return false;
        },
      });
      manager.registerAdapter(adapter);

      const stoppedEvents: Array<{ processId: string; reason: string }> = [];
      manager.on('agent-stopped', (e) => stoppedEvents.push(e));

      const restartEvents: Array<{ processId: string; attempt: number }> = [];
      manager.on('agent-restarted', (e) => restartEvents.push(e));

      await manager.spawnAgent('crash-loop', { cwd: '/tmp' });
      expect(spawnCount).toBe(1);

      // Run health checks and advance timers for each restart attempt
      // maxRestartAttempts = 3, backoff base = 100ms

      // Attempt 1: detect crash, schedule restart at 100ms
      manager.runHealthChecks();
      await vi.advanceTimersByTimeAsync(150);
      expect(spawnCount).toBe(2);

      // Attempt 2: detect crash again, schedule restart at 200ms
      manager.runHealthChecks();
      await vi.advanceTimersByTimeAsync(250);
      expect(spawnCount).toBe(3);

      // Attempt 3: detect crash again, schedule restart at 400ms
      manager.runHealthChecks();
      await vi.advanceTimersByTimeAsync(450);
      expect(spawnCount).toBe(4);

      // Attempt 4: detect crash again — should exceed maxRestartAttempts
      manager.runHealthChecks();
      await vi.advanceTimersByTimeAsync(1000);

      // Should not have spawned again (still 4)
      expect(spawnCount).toBe(4);

      // Should have a stopped event for exceeding max restarts
      const maxRestartStop = stoppedEvents.find(
        (e) => e.reason.includes('Max restart attempts'),
      );
      expect(maxRestartStop).toBeDefined();
    });
  });

  // ── Health Checks ────────────────────────────────────────────────

  describe('health checks', () => {
    it('should detect a crashed agent and emit events', async () => {
      let alive = true;
      const adapter = createMockAdapter({
        name: 'health-check-adapter',
        isAliveFn: (): boolean => alive,
      });
      manager.registerAdapter(adapter);

      const crashEvents: Array<{ processId: string; error: string }> = [];
      manager.on('agent-crashed', (e) => crashEvents.push(e));

      const healthChanges: Array<{
        processId: string;
        health: string;
        previousHealth: string;
      }> = [];
      manager.on('agent-health-changed', (e) => healthChanges.push(e));

      const process = await manager.spawnAgent('health-check-adapter', {
        cwd: '/tmp',
      });

      // First health check — agent is alive, no change expected
      manager.runHealthChecks();
      expect(crashEvents).toHaveLength(0);

      // Simulate crash
      alive = false;
      manager.runHealthChecks();

      expect(crashEvents).toHaveLength(1);
      expect(crashEvents[0].processId).toBe(process.id);
      expect(healthChanges).toHaveLength(1);
      expect(healthChanges[0].health).toBe('unhealthy');
      expect(healthChanges[0].previousHealth).toBe('healthy');
    });

    it('should start and stop periodic health checks', async () => {
      let checkCount = 0;
      const adapter = createMockAdapter({
        name: 'periodic-adapter',
        isAliveFn: (): boolean => {
          checkCount++;
          return true;
        },
      });
      manager.registerAdapter(adapter);

      await manager.spawnAgent('periodic-adapter', { cwd: '/tmp' });

      manager.startHealthChecks();

      // Advance 3 intervals (healthCheckIntervalMs = 1000)
      vi.advanceTimersByTime(3_000);

      // isAlive should have been called 3 times
      expect(checkCount).toBe(3);

      manager.stopHealthChecks();

      // Advance further — no more checks
      vi.advanceTimersByTime(3_000);
      expect(checkCount).toBe(3);
    });
  });

  // ── Send Prompt ──────────────────────────────────────────────────

  describe('sendPrompt', () => {
    it('should send a prompt to a running agent', async () => {
      const prompts: string[] = [];
      const adapter = createMockAdapter({
        sendPromptFn: async (
          _process: AgentProcess,
          prompt: string,
        ): Promise<void> => {
          prompts.push(prompt);
        },
      });
      manager.registerAdapter(adapter);

      const process = await manager.spawnAgent('mock-adapter', { cwd: '/tmp' });
      await manager.sendPrompt(process.id, 'Hello, agent!');

      expect(prompts).toHaveLength(1);
      expect(prompts[0]).toBe('Hello, agent!');
    });

    it('should throw when agent does not exist', async () => {
      await expect(
        manager.sendPrompt('nonexistent', 'hello'),
      ).rejects.toThrow('No agent found');
    });

    it('should throw when agent is not running', async () => {
      const adapter = createMockAdapter();
      manager.registerAdapter(adapter);

      const process = await manager.spawnAgent('mock-adapter', { cwd: '/tmp' });
      process.running = false;

      await expect(
        manager.sendPrompt(process.id, 'hello'),
      ).rejects.toThrow('is not running');
    });
  });

  // ── List and Get ─────────────────────────────────────────────────

  describe('listAgents and getAgent', () => {
    it('should list all running agents', async () => {
      const adapter = createMockAdapter();
      manager.registerAdapter(adapter);

      const p1 = await manager.spawnAgent('mock-adapter', { cwd: '/tmp' });
      const p2 = await manager.spawnAgent('mock-adapter', { cwd: '/tmp' });

      const agents = manager.listAgents();
      expect(agents).toHaveLength(2);
      expect(agents.map((a) => a.id).sort()).toEqual(
        [p1.id, p2.id].sort(),
      );
    });

    it('should get a specific agent by id', async () => {
      const adapter = createMockAdapter();
      manager.registerAdapter(adapter);

      const process = await manager.spawnAgent('mock-adapter', { cwd: '/tmp' });
      const retrieved = manager.getAgent(process.id);

      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(process.id);
    });

    it('should return undefined for unknown agent id', () => {
      expect(manager.getAgent('does-not-exist')).toBeUndefined();
    });
  });

  // ── Adapter Registration ─────────────────────────────────────────

  describe('registerAdapter', () => {
    it('should register an adapter successfully', () => {
      const adapter = createMockAdapter({ name: 'test-adapter' });
      manager.registerAdapter(adapter);

      const cb = manager.getCircuitBreakerState('test-adapter');
      expect(cb).toBeDefined();
      expect(cb!.health).toBe('healthy');
      expect(cb!.failureCount).toBe(0);
    });

    it('should throw when registering duplicate adapter', () => {
      const adapter1 = createMockAdapter({ name: 'dup-adapter' });
      const adapter2 = createMockAdapter({ name: 'dup-adapter' });

      manager.registerAdapter(adapter1);
      expect(() => manager.registerAdapter(adapter2)).toThrow(
        'already registered',
      );
    });
  });

  // ── Output Forwarding ────────────────────────────────────────────

  describe('output forwarding', () => {
    it('should forward agent output events', async () => {
      let outputCallback: ((output: string) => void) | null = null;
      const adapter = createMockAdapter({
        onOutputFn: (
          _process: AgentProcess,
          callback: (output: string) => void,
        ) => {
          outputCallback = callback;
          return () => {
            outputCallback = null;
          };
        },
      });
      manager.registerAdapter(adapter);

      const outputEvents: Array<{ processId: string; output: string }> = [];
      manager.on('agent-output', (e) => outputEvents.push(e));

      const process = await manager.spawnAgent('mock-adapter', { cwd: '/tmp' });

      // Simulate agent output
      expect(outputCallback).not.toBeNull();
      outputCallback!('Hello from agent');

      expect(outputEvents).toHaveLength(1);
      expect(outputEvents[0].processId).toBe(process.id);
      expect(outputEvents[0].output).toBe('Hello from agent');
    });

    it('should unsubscribe from output when agent is killed', async () => {
      let unsubCalled = false;
      const adapter = createMockAdapter({
        onOutputFn: () => {
          return () => {
            unsubCalled = true;
          };
        },
      });
      manager.registerAdapter(adapter);

      const process = await manager.spawnAgent('mock-adapter', { cwd: '/tmp' });
      expect(unsubCalled).toBe(false);

      await manager.killAgent(process.id);
      expect(unsubCalled).toBe(true);
    });
  });
});
