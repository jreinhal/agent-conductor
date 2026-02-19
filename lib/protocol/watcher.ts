/**
 * Bounce Protocol v0.1 — Session File Watcher
 *
 * Monitors a directory of `.md` session files for changes and emits
 * structured events when sessions are created, updated, or deleted.
 *
 * Uses chokidar for cross-platform file watching with write-settle
 * detection, and SHA-256 content hashing for deduplication.
 *
 * @see docs/protocol/bounce-v0.1.md
 */

import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { ParseResult, ProtocolEntry } from './types';
import { parseSession } from './parser';

// ─── Public Types ────────────────────────────────────────────────────

/** Events emitted by the SessionWatcher. */
export interface WatcherEvent {
  type: 'session-updated' | 'session-created' | 'session-deleted';
  sessionPath: string;
  /** New entries since last event (for updates). */
  newEntries?: ProtocolEntry[];
  /** Full parse result (for creates and first load). */
  parseResult?: ParseResult;
  /** ISO-8601 timestamp of the event. */
  timestamp: string;
}

/** Configuration for the SessionWatcher. */
export interface WatcherOptions {
  /** Directory to watch for .md session files. */
  sessionsDir: string;
  /** Debounce interval in ms (default 200). */
  debounceMs?: number;
  /** Stability threshold in ms — wait for file writes to settle (default 300). */
  stabilityThresholdMs?: number;
}

// ─── Internal State ──────────────────────────────────────────────────

interface CachedSession {
  parseResult: ParseResult;
  contentHash: string;
  entryCount: number;
}

// ─── SessionWatcher ──────────────────────────────────────────────────

export class SessionWatcher extends EventEmitter {
  private readonly sessionsDir: string;
  private readonly debounceMs: number;
  private readonly stabilityThresholdMs: number;
  private cache = new Map<string, CachedSession>();
  private watcher: import('chokidar').FSWatcher | null = null;
  private watching = false;

  constructor(options: WatcherOptions) {
    super();
    this.sessionsDir = options.sessionsDir;
    this.debounceMs = options.debounceMs ?? 200;
    this.stabilityThresholdMs = options.stabilityThresholdMs ?? 300;
  }

  // ─── Public API ──────────────────────────────────────────────────

  /** Start watching the sessions directory. */
  async start(): Promise<void> {
    if (this.watching) return;

    // Dynamic import so the module works in non-Electron Node too.
    const chokidar = await import('chokidar');

    // Watch the directory itself (not a glob) for reliable cross-platform
    // detection.  Filter to .md files in the event handlers.
    this.watcher = chokidar.watch(this.sessionsDir, {
      persistent: true,
      ignoreInitial: false,
      depth: 0,
      awaitWriteFinish: {
        stabilityThreshold: this.stabilityThresholdMs,
        pollInterval: 100,
      },
      usePolling: true,
      interval: this.debounceMs,
    });

    this.watcher.on('add', (filePath: string) => this.handleAdd(filePath));
    this.watcher.on('change', (filePath: string) => this.handleChange(filePath));
    this.watcher.on('unlink', (filePath: string) => this.handleUnlink(filePath));
    this.watcher.on('error', (error: Error) => this.handleError(error));

    // Wait for the initial scan to complete.
    await new Promise<void>((resolve) => {
      this.watcher!.once('ready', () => {
        this.watching = true;
        resolve();
      });
    });
  }

  /** Stop watching and clean up. */
  async stop(): Promise<void> {
    if (!this.watching || !this.watcher) return;
    await this.watcher.close();
    this.watcher = null;
    this.watching = false;
    this.cache.clear();
  }

  /** Get the cached parse result for a session. */
  getSession(sessionPath: string): ParseResult | null {
    const normalizedPath = this.normalizePath(sessionPath);
    return this.cache.get(normalizedPath)?.parseResult ?? null;
  }

  /** Whether the watcher is currently active. */
  isWatching(): boolean {
    return this.watching;
  }

  // ─── Internal Handlers ───────────────────────────────────────────

  private async handleAdd(filePath: string): Promise<void> {
    if (!this.isSessionFile(filePath)) return;
    const normalized = this.normalizePath(filePath);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const hash = this.hashContent(content);
      const parseResult = parseSession(content);
      const entryCount = parseResult.session?.entries?.length ?? 0;

      this.cache.set(normalized, { parseResult, contentHash: hash, entryCount });

      const event: WatcherEvent = {
        type: 'session-created',
        sessionPath: normalized,
        parseResult,
        timestamp: new Date().toISOString(),
      };
      this.emit('session', event);
    } catch (err) {
      this.emitWarning(normalized, err);
    }
  }

  private async handleChange(filePath: string): Promise<void> {
    if (!this.isSessionFile(filePath)) return;
    const normalized = this.normalizePath(filePath);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const hash = this.hashContent(content);

      // Dedup: skip if content hash is unchanged.
      const cached = this.cache.get(normalized);
      if (cached && cached.contentHash === hash) return;

      const parseResult = parseSession(content);
      const newEntryCount = parseResult.session?.entries?.length ?? 0;

      // Compute new entries by diffing.
      let newEntries: ProtocolEntry[] | undefined;
      if (cached) {
        const oldCount = cached.entryCount;
        const allEntries = parseResult.session?.entries ?? [];
        if (newEntryCount > oldCount) {
          newEntries = allEntries.slice(oldCount);
        }
      }

      this.cache.set(normalized, {
        parseResult,
        contentHash: hash,
        entryCount: newEntryCount,
      });

      const event: WatcherEvent = {
        type: 'session-updated',
        sessionPath: normalized,
        newEntries,
        parseResult,
        timestamp: new Date().toISOString(),
      };
      this.emit('session', event);
    } catch (err) {
      this.emitWarning(normalized, err);
    }
  }

  private handleUnlink(filePath: string): void {
    if (!this.isSessionFile(filePath)) return;
    const normalized = this.normalizePath(filePath);
    this.cache.delete(normalized);

    const event: WatcherEvent = {
      type: 'session-deleted',
      sessionPath: normalized,
      timestamp: new Date().toISOString(),
    };
    this.emit('session', event);
  }

  private handleError(error: Error): void {
    // Emit on the 'error' channel so callers can attach a listener.
    // If no listener is attached EventEmitter will throw — we guard
    // against that by checking listenerCount.
    if (this.listenerCount('error') > 0) {
      this.emit('error', error);
    } else {
      console.error('[SessionWatcher] watcher error:', error.message);
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────

  /** Check whether a path is a .md session file (not .lock, not a directory). */
  private isSessionFile(filePath: string): boolean {
    return filePath.endsWith('.md') && !filePath.endsWith('.lock');
  }

  /** SHA-256 hex digest of the file content. */
  private hashContent(content: string): string {
    return createHash('sha256').update(content, 'utf-8').digest('hex');
  }

  /** Normalise to forward-slash paths for consistent Map keys. */
  private normalizePath(filePath: string): string {
    return path.resolve(filePath).replace(/\\/g, '/');
  }

  /** Log and emit a warning for a malformed or unreadable file. */
  private emitWarning(sessionPath: string, err: unknown): void {
    const message =
      err instanceof Error ? err.message : String(err);
    console.warn(`[SessionWatcher] error processing ${sessionPath}: ${message}`);
    // Do NOT re-throw — malformed files must never crash the watcher.
  }
}
