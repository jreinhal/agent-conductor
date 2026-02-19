/**
 * Bounce Protocol v0.1 — File Lock Wrapper
 *
 * Provides file-level locking for concurrent access to session files.
 * Uses `proper-lockfile` for cross-process lock management with retry,
 * backoff, and stale lock detection.
 *
 * @see docs/protocol/bounce-v0.1.md — Rule 5 (atomic append), Rule 6 (concurrent writes)
 */

import lockfile from 'proper-lockfile';

// ─── Types ───────────────────────────────────────────────────────────

/** Options for file lock acquisition. */
export interface LockOptions {
  /** Number of retry attempts on contention. Default: 3. */
  retries?: number;
  /** Delay between retries in milliseconds. Default: 200. */
  retryDelay?: number;
  /** Time in milliseconds after which a lock is considered stale. Default: 10000. */
  staleTimeout?: number;
  /** Maximum time in milliseconds to wait for lock acquisition. Default: 5000. */
  lockTimeout?: number;
}

/** Error thrown when lock acquisition times out. */
export class LockTimeoutError extends Error {
  public readonly code = 'LOCK_TIMEOUT';

  constructor(filePath: string, timeout: number) {
    super(`Lock acquisition timed out after ${timeout}ms for file: ${filePath}`);
    this.name = 'LockTimeoutError';
  }
}

// ─── Defaults ────────────────────────────────────────────────────────

const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 200;
const DEFAULT_STALE_TIMEOUT = 10_000;
const DEFAULT_LOCK_TIMEOUT = 5_000;

// ─── Implementation ──────────────────────────────────────────────────

/**
 * Execute an operation while holding an exclusive file lock.
 *
 * Acquires a lock on `filePath`, runs `operation`, and releases the lock
 * in a `finally` block regardless of success or failure.
 *
 * Lock file is created at `[filePath].lock`.
 *
 * @param filePath  - Absolute path to the file to lock.
 * @param operation - Async function to execute while the lock is held.
 * @param options   - Lock acquisition options.
 * @returns The return value of `operation`.
 * @throws {LockTimeoutError} If the lock cannot be acquired within `lockTimeout`.
 */
export async function withFileLock<T>(
  filePath: string,
  operation: () => Promise<T>,
  options?: LockOptions,
): Promise<T> {
  const retries = options?.retries ?? DEFAULT_RETRIES;
  const retryDelay = options?.retryDelay ?? DEFAULT_RETRY_DELAY;
  const staleTimeout = options?.staleTimeout ?? DEFAULT_STALE_TIMEOUT;
  const lockTimeout = options?.lockTimeout ?? DEFAULT_LOCK_TIMEOUT;

  // Build proper-lockfile options with retry and stale detection.
  // proper-lockfile uses `retries` as either a number or an options object
  // for the `retry` package. We convert our flat options into the retry format.
  const lockOpts: lockfile.LockOptions = {
    stale: staleTimeout,
    retries: {
      retries,
      minTimeout: retryDelay,
      maxTimeout: retryDelay * 4,
      factor: 2,
    },
    lockfilePath: `${filePath}.lock`,
  };

  // Wrap in a timeout race to enforce lockTimeout
  let release: (() => Promise<void>) | undefined;

  try {
    release = await raceWithTimeout(
      lockfile.lock(filePath, lockOpts),
      lockTimeout,
      filePath,
    );

    return await operation();
  } finally {
    if (release) {
      try {
        await release();
      } catch {
        // Lock may already have been released (e.g. stale cleanup).
        // Swallow release errors to avoid masking the original error.
      }
    }
  }
}

/**
 * Race a promise against a timeout. If the timeout wins, throw LockTimeoutError.
 */
function raceWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  filePath: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new LockTimeoutError(filePath, timeoutMs));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
