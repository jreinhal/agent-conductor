/**
 * Claude Code Adapter
 *
 * Adapter for the `claude` CLI tool (Claude Code).
 * Spawns `claude` as a child process and communicates via stdin/stdout.
 *
 * @module lib/adapters/claude-code-adapter
 */

import { spawn, type ChildProcess, execFile } from 'child_process';
import { randomUUID } from 'crypto';
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentConfig,
  AgentProcess,
} from './types';

// ─── Internal state ──────────────────────────────────────────────────

interface ManagedProcess {
  child: ChildProcess;
  agentProcess: AgentProcess;
  listeners: Map<string, (output: string) => void>;
  killed: boolean;
}

const IS_WINDOWS = process.platform === 'win32';

/** Grace period (ms) after SIGTERM before sending SIGKILL. */
const KILL_GRACE_MS = 5_000;

// ─── Adapter ─────────────────────────────────────────────────────────

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly name = 'claude-code';

  readonly capabilities: AgentCapabilities = {
    canReadFiles: true,
    canWriteFiles: true,
    canExecuteCommands: true,
    supportsStreaming: true,
    supportsConversation: true,
    maxContextTokens: 200_000,
  };

  /** Map from process id to managed state. */
  private readonly processes = new Map<string, ManagedProcess>();

  // ── isAvailable ──────────────────────────────────────────────────

  async isAvailable(): Promise<boolean> {
    const cmd = IS_WINDOWS ? 'where' : 'which';
    return new Promise<boolean>((resolve) => {
      execFile(cmd, ['claude'], (error) => {
        resolve(!error);
      });
    });
  }

  // ── spawn ────────────────────────────────────────────────────────

  async spawn(config: AgentConfig): Promise<AgentProcess> {
    const id = randomUUID();
    const args = ['--print', '--output-format', 'text', ...(config.args ?? [])];

    const env: Record<string, string> = {
      ...process.env,
      ...(config.env ?? {}),
    } as Record<string, string>;

    const child = spawn('claude', args, {
      cwd: config.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      // On Windows we need to use shell to locate the executable on PATH
      shell: IS_WINDOWS,
    });

    const agentProcess: AgentProcess = {
      id,
      adapterName: this.name,
      health: 'healthy',
      pid: child.pid,
      running: true,
      failureCount: 0,
    };

    const managed: ManagedProcess = {
      child,
      agentProcess,
      listeners: new Map(),
      killed: false,
    };

    // Track process exit
    child.on('exit', (code, signal) => {
      agentProcess.running = false;
      if (code !== 0 && !managed.killed) {
        agentProcess.health = 'unhealthy';
        agentProcess.failureCount += 1;
        agentProcess.lastError = `Process exited with code ${code ?? 'null'}, signal ${signal ?? 'null'}`;
      }
    });

    child.on('error', (err) => {
      agentProcess.running = false;
      agentProcess.health = 'unhealthy';
      agentProcess.failureCount += 1;
      agentProcess.lastError = err.message;
    });

    this.processes.set(id, managed);
    return agentProcess;
  }

  // ── sendPrompt ───────────────────────────────────────────────────

  async sendPrompt(agentProcess: AgentProcess, prompt: string): Promise<void> {
    const managed = this.processes.get(agentProcess.id);
    if (!managed) {
      throw new Error(`No managed process found for id ${agentProcess.id}`);
    }

    if (!managed.agentProcess.running) {
      throw new Error(`Process ${agentProcess.id} is not running`);
    }

    const { child } = managed;

    if (!child.stdin || child.stdin.destroyed) {
      throw new Error(`stdin is not available for process ${agentProcess.id}`);
    }

    return new Promise<void>((resolve, reject) => {
      child.stdin!.write(prompt + '\n', (err) => {
        if (err) {
          managed.agentProcess.health = 'unhealthy';
          managed.agentProcess.failureCount += 1;
          managed.agentProcess.lastError = err.message;
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  // ── onOutput ─────────────────────────────────────────────────────

  onOutput(agentProcess: AgentProcess, callback: (output: string) => void): () => void {
    const managed = this.processes.get(agentProcess.id);
    if (!managed) {
      throw new Error(`No managed process found for id ${agentProcess.id}`);
    }

    const listenerId = randomUUID();
    managed.listeners.set(listenerId, callback);

    const { child } = managed;

    const onStdoutData = (data: Buffer) => {
      callback(data.toString('utf-8'));
    };

    const onStderrData = (data: Buffer) => {
      callback(data.toString('utf-8'));
    };

    child.stdout?.on('data', onStdoutData);
    child.stderr?.on('data', onStderrData);

    // Return unsubscribe function
    return () => {
      managed.listeners.delete(listenerId);
      child.stdout?.off('data', onStdoutData);
      child.stderr?.off('data', onStderrData);
    };
  }

  // ── isAlive ──────────────────────────────────────────────────────

  isAlive(agentProcess: AgentProcess): boolean {
    const managed = this.processes.get(agentProcess.id);
    if (!managed) {
      return false;
    }
    return managed.agentProcess.running && !managed.killed;
  }

  // ── kill ─────────────────────────────────────────────────────────

  async kill(agentProcess: AgentProcess): Promise<void> {
    const managed = this.processes.get(agentProcess.id);
    if (!managed) {
      return;
    }

    managed.killed = true;
    const { child } = managed;

    // If already exited, just clean up
    if (!managed.agentProcess.running) {
      this.processes.delete(agentProcess.id);
      return;
    }

    return new Promise<void>((resolve) => {
      const forceKillTimer = setTimeout(() => {
        try {
          if (IS_WINDOWS) {
            // On Windows, spawn taskkill for a forceful kill
            spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], {
              stdio: 'ignore',
            });
          } else {
            child.kill('SIGKILL');
          }
        } catch {
          // Process may already be dead — ignore
        }
      }, KILL_GRACE_MS);

      child.once('exit', () => {
        clearTimeout(forceKillTimer);
        managed.agentProcess.running = false;
        this.processes.delete(agentProcess.id);
        resolve();
      });

      // Attempt graceful termination
      try {
        if (IS_WINDOWS) {
          // On Windows SIGTERM is not reliably handled; use taskkill without /f
          spawn('taskkill', ['/pid', String(child.pid), '/t'], {
            stdio: 'ignore',
          });
        } else {
          child.kill('SIGTERM');
        }
      } catch {
        // Process may already be dead
        clearTimeout(forceKillTimer);
        managed.agentProcess.running = false;
        this.processes.delete(agentProcess.id);
        resolve();
      }
    });
  }
}
