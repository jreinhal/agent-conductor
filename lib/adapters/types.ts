/**
 * Agent Adapter Interface & Types
 *
 * Defines the contract every CLI agent adapter must implement.
 * Adapters bridge between the orchestrator and real CLI tools
 * (claude, codex, gemini-cli, etc.) or mock implementations.
 *
 * @module lib/adapters/types
 */

// ─── Agent Capabilities ─────────────────────────────────────────────

/** Capabilities a CLI agent supports. */
export interface AgentCapabilities {
  /** Whether the agent can read files from the filesystem. */
  canReadFiles: boolean;
  /** Whether the agent can write/modify files on the filesystem. */
  canWriteFiles: boolean;
  /** Whether the agent can execute shell commands. */
  canExecuteCommands: boolean;
  /** Whether the agent supports streamed (incremental) output. */
  supportsStreaming: boolean;
  /** Whether the agent supports multi-turn conversation within a single process. */
  supportsConversation: boolean;
  /** Maximum context window in tokens, or null if unknown/unlimited. */
  maxContextTokens: number | null;
}

// ─── Agent Configuration ─────────────────────────────────────────────

/** Configuration for spawning an agent process. */
export interface AgentConfig {
  /** Working directory for the agent process. */
  cwd: string;
  /** Environment variables to pass to the agent process. */
  env?: Record<string, string>;
  /** Additional CLI arguments to pass when spawning. */
  args?: string[];
  /** Session file path for file-based coordination (Bounce Protocol). */
  sessionPath?: string;
}

// ─── Agent Health ────────────────────────────────────────────────────

/** Health status of an agent process. */
export type AgentHealth = 'healthy' | 'unhealthy' | 'probing' | 'unknown';

// ─── Agent Process Handle ────────────────────────────────────────────

/** Handle to a running agent process. */
export interface AgentProcess {
  /** Unique process identifier (adapter-assigned). */
  id: string;
  /** Name of the adapter that spawned this process. */
  adapterName: string;
  /** Current health status. */
  health: AgentHealth;
  /** OS-level process ID, if the agent runs as a native process. */
  pid?: number;
  /** Whether the process is currently running. */
  running: boolean;
  /** Consecutive failure count (used by the circuit breaker). */
  failureCount: number;
  /** Last error message, populated when health is 'unhealthy'. */
  lastError?: string;
}

// ─── Circuit Breaker ─────────────────────────────────────────────────

/** Circuit breaker state for an adapter. */
export interface CircuitBreakerState {
  /** Current health assessment. */
  health: AgentHealth;
  /** Number of consecutive failures observed. */
  failureCount: number;
  /** Timestamp (ms since epoch) of the most recent failure, or null. */
  lastFailureTime: number | null;
  /** Milliseconds to wait before probing again after opening the circuit. */
  cooldownMs: number;
  /** Failure threshold that trips the circuit breaker open. */
  maxFailures: number;
}

// ─── Core Adapter Interface ──────────────────────────────────────────

/**
 * Core adapter interface.
 *
 * Every CLI agent (claude, codex, gemini-cli, mock, etc.) must provide
 * an implementation of this interface so the orchestrator can manage its
 * lifecycle uniformly.
 */
export interface AgentAdapter {
  /** Unique adapter name (e.g. "claude-code", "codex", "gemini-cli"). */
  readonly name: string;

  /** Declared capabilities of this agent type. */
  readonly capabilities: AgentCapabilities;

  /**
   * Check whether the underlying CLI tool is installed and available.
   * For real adapters this typically runs `which`/`where` on the binary.
   * For mocks this always returns true.
   */
  isAvailable(): Promise<boolean>;

  /**
   * Spawn a new agent process with the given configuration.
   * Returns a handle that can be used with the other lifecycle methods.
   */
  spawn(config: AgentConfig): Promise<AgentProcess>;

  /**
   * Send a prompt/instruction to a running agent.
   * The adapter decides whether to write to stdin or spawn a sub-process.
   */
  sendPrompt(process: AgentProcess, prompt: string): Promise<void>;

  /**
   * Register a callback that is invoked whenever the agent produces output.
   * Returns an unsubscribe function.
   */
  onOutput(process: AgentProcess, callback: (output: string) => void): () => void;

  /**
   * Check whether an agent process is still alive (running).
   */
  isAlive(process: AgentProcess): boolean;

  /**
   * Gracefully terminate an agent process.
   * Implementations should send SIGTERM, wait a grace period, then SIGKILL.
   */
  kill(process: AgentProcess): Promise<void>;
}
