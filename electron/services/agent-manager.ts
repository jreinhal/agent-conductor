/**
 * Agent Manager — Centralized Agent Process Manager
 *
 * Manages the lifecycle of agent processes in the Electron main process.
 * Provides spawning, health monitoring, circuit breaking, automatic restart
 * with backoff, and graceful shutdown capabilities.
 *
 * @module electron/services/agent-manager
 */

import { EventEmitter } from 'events';
import type {
  AgentAdapter,
  AgentProcess,
  AgentConfig,
  AgentHealth,
  CircuitBreakerState,
} from '../../lib/adapters/types';

// ─── Options ─────────────────────────────────────────────────────────

export interface AgentManagerOptions {
  /** Maximum concurrent agent processes (default 5). */
  maxConcurrent?: number;
  /** Health check interval in ms (default 10000). */
  healthCheckIntervalMs?: number;
  /** Circuit breaker: max consecutive failures before marking unhealthy (default 3). */
  circuitBreakerMaxFailures?: number;
  /** Circuit breaker: cooldown before probing (default 30000ms). */
  circuitBreakerCooldownMs?: number;
  /** Restart backoff base delay in ms (default 1000). */
  restartBackoffBaseMs?: number;
  /** Maximum restart attempts (default 5). */
  maxRestartAttempts?: number;
}

// ─── Internal Tracked Agent ──────────────────────────────────────────

/** Internal bookkeeping for a managed agent. */
interface ManagedAgent {
  process: AgentProcess;
  adapter: AgentAdapter;
  config: AgentConfig;
  restartCount: number;
  /** Unsubscribe function from adapter.onOutput, if registered. */
  outputUnsub?: () => void;
  /** Pending restart timer, if any. */
  restartTimer?: ReturnType<typeof setTimeout>;
}

// ─── Event Map ───────────────────────────────────────────────────────

export interface AgentManagerEvents {
  'agent-spawned': { processId: string; adapterName: string };
  'agent-stopped': { processId: string; reason: string };
  'agent-crashed': { processId: string; error: string };
  'agent-restarted': { processId: string; attempt: number };
  'agent-health-changed': {
    processId: string;
    health: AgentHealth;
    previousHealth: AgentHealth;
  };
  'agent-output': { processId: string; output: string };
}

// ─── Resolved Options ────────────────────────────────────────────────

interface ResolvedOptions {
  maxConcurrent: number;
  healthCheckIntervalMs: number;
  circuitBreakerMaxFailures: number;
  circuitBreakerCooldownMs: number;
  restartBackoffBaseMs: number;
  maxRestartAttempts: number;
}

// ─── AgentManager ────────────────────────────────────────────────────

/**
 * Centralized agent process manager for the Electron main process.
 *
 * Features:
 * - Adapter registration and per-adapter circuit breaking
 * - Concurrency limiting
 * - Health check polling
 * - Automatic restart with exponential backoff
 * - Graceful shutdown (SIGTERM then SIGKILL)
 */
export class AgentManager extends EventEmitter {
  private readonly opts: ResolvedOptions;

  /** Registered adapters by name. */
  private readonly adapters = new Map<string, AgentAdapter>();

  /** Managed agents by process id. */
  private readonly agents = new Map<string, ManagedAgent>();

  /** Circuit breaker state per adapter name. */
  private readonly circuitBreakers = new Map<string, CircuitBreakerState>();

  /** Interval handle for health checks. */
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;

  /** Whether shutdown has been initiated. */
  private isShuttingDown = false;

  constructor(options?: AgentManagerOptions) {
    super();
    this.opts = {
      maxConcurrent: options?.maxConcurrent ?? 5,
      healthCheckIntervalMs: options?.healthCheckIntervalMs ?? 10_000,
      circuitBreakerMaxFailures: options?.circuitBreakerMaxFailures ?? 3,
      circuitBreakerCooldownMs: options?.circuitBreakerCooldownMs ?? 30_000,
      restartBackoffBaseMs: options?.restartBackoffBaseMs ?? 1_000,
      maxRestartAttempts: options?.maxRestartAttempts ?? 5,
    };
  }

  // ── Type-safe emit/on ───────────────────────────────────────────

  override emit<K extends keyof AgentManagerEvents>(
    event: K,
    payload: AgentManagerEvents[K],
  ): boolean {
    return super.emit(event, payload);
  }

  override on<K extends keyof AgentManagerEvents>(
    event: K,
    listener: (payload: AgentManagerEvents[K]) => void,
  ): this {
    return super.on(event, listener);
  }

  // ── Adapter Registration ────────────────────────────────────────

  /** Register an adapter for use. */
  registerAdapter(adapter: AgentAdapter): void {
    if (this.adapters.has(adapter.name)) {
      throw new Error(`Adapter "${adapter.name}" is already registered`);
    }
    this.adapters.set(adapter.name, adapter);
    this.circuitBreakers.set(adapter.name, {
      health: 'healthy',
      failureCount: 0,
      lastFailureTime: null,
      cooldownMs: this.opts.circuitBreakerCooldownMs,
      maxFailures: this.opts.circuitBreakerMaxFailures,
    });
  }

  // ── Spawn ───────────────────────────────────────────────────────

  /** Spawn a new agent using the named adapter. */
  async spawnAgent(
    adapterName: string,
    config: AgentConfig,
  ): Promise<AgentProcess> {
    if (this.isShuttingDown) {
      throw new Error('AgentManager is shutting down; cannot spawn new agents');
    }

    const adapter = this.adapters.get(adapterName);
    if (!adapter) {
      throw new Error(`No adapter registered with name "${adapterName}"`);
    }

    // Concurrency limit
    const runningCount = this.countRunningAgents();
    if (runningCount >= this.opts.maxConcurrent) {
      throw new Error(
        `Concurrency limit reached: ${runningCount}/${this.opts.maxConcurrent} agents running`,
      );
    }

    // Circuit breaker check
    const cb = this.circuitBreakers.get(adapterName)!;
    if (cb.health === 'unhealthy') {
      const now = Date.now();
      const elapsed = cb.lastFailureTime
        ? now - cb.lastFailureTime
        : Infinity;
      if (elapsed < cb.cooldownMs) {
        throw new Error(
          `Adapter "${adapterName}" is unhealthy (circuit breaker open). ` +
            `Cooldown remaining: ${cb.cooldownMs - elapsed}ms`,
        );
      }
      // Cooldown elapsed — switch to probing
      cb.health = 'probing';
    }

    try {
      const process = await adapter.spawn(config);

      // If we were probing, mark healthy again
      if (cb.health === 'probing') {
        cb.health = 'healthy';
        cb.failureCount = 0;
        cb.lastFailureTime = null;
      }

      const managed: ManagedAgent = {
        process,
        adapter,
        config,
        restartCount: 0,
      };

      // Wire up output forwarding
      const unsub = adapter.onOutput(process, (output: string) => {
        this.emit('agent-output', { processId: process.id, output });
      });
      managed.outputUnsub = unsub;

      this.agents.set(process.id, managed);
      this.emit('agent-spawned', {
        processId: process.id,
        adapterName,
      });

      return process;
    } catch (err) {
      this.recordAdapterFailure(adapterName);

      // If probing failed, go back to unhealthy
      if (cb.health === 'probing') {
        cb.health = 'unhealthy';
        cb.lastFailureTime = Date.now();
      }

      throw err;
    }
  }

  // ── Kill ────────────────────────────────────────────────────────

  /** Kill a specific agent process. */
  async killAgent(processId: string): Promise<void> {
    const managed = this.agents.get(processId);
    if (!managed) {
      throw new Error(`No agent found with id "${processId}"`);
    }

    // Cancel any pending restart
    if (managed.restartTimer) {
      clearTimeout(managed.restartTimer);
      managed.restartTimer = undefined;
    }

    // Unsubscribe from output
    if (managed.outputUnsub) {
      managed.outputUnsub();
      managed.outputUnsub = undefined;
    }

    try {
      await managed.adapter.kill(managed.process);
    } catch {
      // Best-effort kill
    }

    managed.process.running = false;
    managed.process.health = 'unknown';
    this.agents.delete(processId);

    this.emit('agent-stopped', {
      processId,
      reason: 'killed',
    });
  }

  /** Kill all running agent processes. */
  async killAll(): Promise<void> {
    const killPromises = Array.from(this.agents.keys()).map((id) =>
      this.killAgent(id).catch(() => {
        // swallow individual kill errors during killAll
      }),
    );
    await Promise.all(killPromises);
  }

  // ── List / Get ──────────────────────────────────────────────────

  /** List all running agent processes. */
  listAgents(): AgentProcess[] {
    return Array.from(this.agents.values()).map((m) => m.process);
  }

  /** Get a specific agent process. */
  getAgent(processId: string): AgentProcess | undefined {
    return this.agents.get(processId)?.process;
  }

  // ── Send Prompt ─────────────────────────────────────────────────

  /** Send a prompt to a running agent. */
  async sendPrompt(processId: string, prompt: string): Promise<void> {
    const managed = this.agents.get(processId);
    if (!managed) {
      throw new Error(`No agent found with id "${processId}"`);
    }
    if (!managed.process.running) {
      throw new Error(`Agent "${processId}" is not running`);
    }
    await managed.adapter.sendPrompt(managed.process, prompt);
  }

  // ── Health Checks ───────────────────────────────────────────────

  /** Start periodic health checks. */
  startHealthChecks(): void {
    if (this.healthCheckInterval) return;

    this.healthCheckInterval = setInterval(() => {
      this.runHealthChecks();
    }, this.opts.healthCheckIntervalMs);
  }

  /** Stop periodic health checks. */
  stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /** Execute a single round of health checks (exposed for testing). */
  runHealthChecks(): void {
    for (const [processId, managed] of this.agents) {
      const previousHealth = managed.process.health;
      const alive = managed.adapter.isAlive(managed.process);

      if (alive) {
        if (previousHealth !== 'healthy') {
          managed.process.health = 'healthy';
          managed.process.failureCount = 0;
          this.emit('agent-health-changed', {
            processId,
            health: 'healthy',
            previousHealth,
          });
        }
      } else {
        // Agent is not alive
        if (previousHealth === 'healthy' || previousHealth === 'unknown') {
          managed.process.health = 'unhealthy';
          managed.process.running = false;
          this.emit('agent-health-changed', {
            processId,
            health: 'unhealthy',
            previousHealth,
          });
          this.emit('agent-crashed', {
            processId,
            error: 'Health check failed: agent is not alive',
          });

          // Attempt restart
          this.scheduleRestart(processId);
        }
      }
    }
  }

  // ── Restart with Backoff ────────────────────────────────────────

  /** Schedule a restart with exponential backoff for a crashed agent. */
  private scheduleRestart(processId: string): void {
    const managed = this.agents.get(processId);
    if (!managed) return;
    if (this.isShuttingDown) return;

    if (managed.restartCount >= this.opts.maxRestartAttempts) {
      // Give up — mark as permanently stopped
      managed.process.health = 'unhealthy';
      managed.process.running = false;

      // Unsubscribe and remove
      if (managed.outputUnsub) {
        managed.outputUnsub();
        managed.outputUnsub = undefined;
      }
      this.agents.delete(processId);

      this.emit('agent-stopped', {
        processId,
        reason: `Max restart attempts (${this.opts.maxRestartAttempts}) exceeded`,
      });
      return;
    }

    const delay =
      this.opts.restartBackoffBaseMs * Math.pow(2, managed.restartCount);

    managed.restartTimer = setTimeout(async () => {
      if (this.isShuttingDown) return;

      const current = this.agents.get(processId);
      if (!current) return;

      current.restartCount++;

      try {
        // Unsubscribe old output handler
        if (current.outputUnsub) {
          current.outputUnsub();
          current.outputUnsub = undefined;
        }

        const newProcess = await current.adapter.spawn(current.config);

        // Wire up new output forwarding
        const unsub = current.adapter.onOutput(
          newProcess,
          (output: string) => {
            this.emit('agent-output', {
              processId: newProcess.id,
              output,
            });
          },
        );

        // Update the managed entry: new process, preserve restart state
        // If the new process has a different id, remap
        if (newProcess.id !== processId) {
          this.agents.delete(processId);
          current.process = newProcess;
          current.outputUnsub = unsub;
          this.agents.set(newProcess.id, current);
        } else {
          current.process = newProcess;
          current.outputUnsub = unsub;
        }

        this.emit('agent-restarted', {
          processId: newProcess.id,
          attempt: current.restartCount,
        });
      } catch {
        // Restart spawn failed — try again
        this.scheduleRestart(processId);
      }
    }, delay);
  }

  // ── Graceful Shutdown ───────────────────────────────────────────

  /** Graceful shutdown: kill all agents and clean up. */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    this.stopHealthChecks();

    // Cancel all pending restart timers
    for (const managed of this.agents.values()) {
      if (managed.restartTimer) {
        clearTimeout(managed.restartTimer);
        managed.restartTimer = undefined;
      }
    }

    // Phase 1: Graceful kill (SIGTERM via adapter.kill)
    const gracefulPromises = Array.from(this.agents.entries()).map(
      async ([, managed]) => {
        if (managed.outputUnsub) {
          managed.outputUnsub();
          managed.outputUnsub = undefined;
        }
        try {
          await managed.adapter.kill(managed.process);
          managed.process.running = false;
        } catch {
          // Will handle in force-kill phase
        }
      },
    );

    await Promise.all(gracefulPromises);

    // Phase 2: Wait briefly then force-kill any remaining
    const stillRunning = Array.from(this.agents.values()).filter(
      (m) => m.process.running,
    );
    if (stillRunning.length > 0) {
      // Wait 5 seconds for graceful shutdown
      await new Promise<void>((resolve) => setTimeout(resolve, 5_000));

      // Force kill remaining
      const forceKillPromises = stillRunning.map(async (managed) => {
        try {
          await managed.adapter.kill(managed.process);
        } catch {
          // Best effort
        }
        managed.process.running = false;
      });
      await Promise.all(forceKillPromises);
    }

    // Emit stopped events and clean up
    for (const [processId] of this.agents) {
      this.emit('agent-stopped', {
        processId,
        reason: 'shutdown',
      });
    }

    this.agents.clear();
    this.circuitBreakers.clear();
    this.removeAllListeners();
  }

  // ── Circuit Breaker Internals ───────────────────────────────────

  /** Record a spawn failure for the named adapter's circuit breaker. */
  private recordAdapterFailure(adapterName: string): void {
    const cb = this.circuitBreakers.get(adapterName);
    if (!cb) return;

    cb.failureCount++;
    cb.lastFailureTime = Date.now();

    if (cb.failureCount >= cb.maxFailures && cb.health !== 'unhealthy') {
      cb.health = 'unhealthy';
    }
  }

  /** Get the circuit breaker state for an adapter (exposed for testing). */
  getCircuitBreakerState(
    adapterName: string,
  ): CircuitBreakerState | undefined {
    return this.circuitBreakers.get(adapterName);
  }

  // ── Helpers ─────────────────────────────────────────────────────

  /** Count currently running agents. */
  private countRunningAgents(): number {
    let count = 0;
    for (const managed of this.agents.values()) {
      if (managed.process.running) {
        count++;
      }
    }
    return count;
  }
}
