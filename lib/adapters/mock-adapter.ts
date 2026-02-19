/**
 * Mock Adapter
 *
 * A deterministic adapter for testing that does not require any real CLI tool.
 * Supports scripted responses, simulated delays, crashes, timeouts, and
 * malformed output — enabling comprehensive integration testing without
 * external dependencies.
 *
 * @module lib/adapters/mock-adapter
 */

import { randomUUID } from 'crypto';
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentConfig,
  AgentProcess,
} from './types';

// ─── Configuration Types ─────────────────────────────────────────────

/** A single scripted response the mock will produce. */
export interface MockResponse {
  /** The text output the mock will produce. */
  output: string;
  /** Delay in ms before producing this response (overrides global delay). */
  delay?: number;
}

/** Configuration for the mock adapter's behaviour. */
export interface MockAdapterConfig {
  /** Scripted responses (returned in order, one per sendPrompt call). */
  responses: MockResponse[];
  /** Default simulated response delay in ms (default 100). */
  responseDelay?: number;
  /** Whether to simulate a crash (process becomes unhealthy immediately). */
  shouldCrash?: boolean;
  /** Crash after N successful responses (0-indexed count). */
  crashAfterResponses?: number;
  /** Simulate a timeout (never deliver a response). */
  shouldTimeout?: boolean;
  /** Produce malformed/garbled output instead of the scripted response text. */
  malformedOutput?: boolean;
}

// ─── Internal state ──────────────────────────────────────────────────

interface MockManagedProcess {
  agentProcess: AgentProcess;
  /** Output listeners keyed by listener id. */
  listeners: Map<string, (output: string) => void>;
  /** How many responses have been delivered so far. */
  responseIndex: number;
  /** Pending timers that should be cleared on kill. */
  pendingTimers: Set<ReturnType<typeof setTimeout>>;
}

// ─── Malformed output helper ─────────────────────────────────────────

const MALFORMED_PREFIX = '\x00\xff\xfe GARBLED: ';

function garble(text: string): string {
  return MALFORMED_PREFIX + text.split('').reverse().join('');
}

// ─── Adapter ─────────────────────────────────────────────────────────

export class MockAdapter implements AgentAdapter {
  readonly name = 'mock';

  readonly capabilities: AgentCapabilities = {
    canReadFiles: false,
    canWriteFiles: false,
    canExecuteCommands: false,
    supportsStreaming: false,
    supportsConversation: true,
    maxContextTokens: null,
  };

  private readonly config: Required<MockAdapterConfig>;
  private readonly processes = new Map<string, MockManagedProcess>();

  constructor(config: MockAdapterConfig) {
    this.config = {
      responses: config.responses,
      responseDelay: config.responseDelay ?? 100,
      shouldCrash: config.shouldCrash ?? false,
      crashAfterResponses: config.crashAfterResponses ?? Infinity,
      shouldTimeout: config.shouldTimeout ?? false,
      malformedOutput: config.malformedOutput ?? false,
    };
  }

  // ── isAvailable ──────────────────────────────────────────────────

  async isAvailable(): Promise<boolean> {
    return true;
  }

  // ── spawn ────────────────────────────────────────────────────────

  async spawn(_config: AgentConfig): Promise<AgentProcess> {
    if (this.config.shouldCrash) {
      const id = randomUUID();
      const agentProcess: AgentProcess = {
        id,
        adapterName: this.name,
        health: 'unhealthy',
        running: false,
        failureCount: 1,
        lastError: 'Mock adapter configured to crash on spawn',
      };

      // Still track the process so sendPrompt/onOutput give
      // meaningful "not running" errors instead of "not found"
      const managed: MockManagedProcess = {
        agentProcess,
        listeners: new Map(),
        responseIndex: 0,
        pendingTimers: new Set(),
      };
      this.processes.set(id, managed);

      return agentProcess;
    }

    const id = randomUUID();
    const agentProcess: AgentProcess = {
      id,
      adapterName: this.name,
      health: 'healthy',
      running: true,
      failureCount: 0,
    };

    const managed: MockManagedProcess = {
      agentProcess,
      listeners: new Map(),
      responseIndex: 0,
      pendingTimers: new Set(),
    };

    this.processes.set(id, managed);
    return agentProcess;
  }

  // ── sendPrompt ───────────────────────────────────────────────────

  async sendPrompt(agentProcess: AgentProcess, _prompt: string): Promise<void> {
    const managed = this.processes.get(agentProcess.id);
    if (!managed) {
      throw new Error(`No managed process found for id ${agentProcess.id}`);
    }

    if (!managed.agentProcess.running) {
      throw new Error(`Process ${agentProcess.id} is not running`);
    }

    // Check crash-after-N-responses
    if (managed.responseIndex >= this.config.crashAfterResponses) {
      managed.agentProcess.running = false;
      managed.agentProcess.health = 'unhealthy';
      managed.agentProcess.failureCount += 1;
      managed.agentProcess.lastError = `Mock crash after ${this.config.crashAfterResponses} responses`;
      throw new Error(managed.agentProcess.lastError);
    }

    // Timeout simulation — just never deliver a response
    if (this.config.shouldTimeout) {
      return;
    }

    // Determine which response to deliver
    const responseSpec = this.config.responses[managed.responseIndex];
    if (!responseSpec) {
      // No more scripted responses — deliver nothing
      return;
    }

    const delay = responseSpec.delay ?? this.config.responseDelay;
    const outputText = this.config.malformedOutput
      ? garble(responseSpec.output)
      : responseSpec.output;

    // Schedule delivery
    const timer = setTimeout(() => {
      managed.pendingTimers.delete(timer);
      // Only deliver if process is still running
      if (managed.agentProcess.running) {
        for (const listener of managed.listeners.values()) {
          listener(outputText);
        }
      }
    }, delay);

    managed.pendingTimers.add(timer);
    managed.responseIndex += 1;
  }

  // ── onOutput ─────────────────────────────────────────────────────

  onOutput(agentProcess: AgentProcess, callback: (output: string) => void): () => void {
    const managed = this.processes.get(agentProcess.id);
    if (!managed) {
      throw new Error(`No managed process found for id ${agentProcess.id}`);
    }

    const listenerId = randomUUID();
    managed.listeners.set(listenerId, callback);

    return () => {
      managed.listeners.delete(listenerId);
    };
  }

  // ── isAlive ──────────────────────────────────────────────────────

  isAlive(agentProcess: AgentProcess): boolean {
    const managed = this.processes.get(agentProcess.id);
    if (!managed) {
      return false;
    }
    return managed.agentProcess.running;
  }

  // ── kill ─────────────────────────────────────────────────────────

  async kill(agentProcess: AgentProcess): Promise<void> {
    const managed = this.processes.get(agentProcess.id);
    if (!managed) {
      return;
    }

    // Clear all pending timers
    for (const timer of managed.pendingTimers) {
      clearTimeout(timer);
    }
    managed.pendingTimers.clear();

    managed.agentProcess.running = false;
    managed.agentProcess.health = 'unknown';
    this.processes.delete(agentProcess.id);
  }
}
