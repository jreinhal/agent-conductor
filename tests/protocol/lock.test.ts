import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir, utimes } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { withFileLock, LockTimeoutError } from '@/lib/protocol/lock';

// ─── Temp directory management ───────────────────────────────────────

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'bounce-lock-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ─── Helpers ─────────────────────────────────────────────────────────

async function createTempFile(name: string, content: string = ''): Promise<string> {
  const filePath = join(tempDir, name);
  await writeFile(filePath, content, 'utf-8');
  return filePath;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('withFileLock', () => {
  it('should acquire lock, run operation, and release lock', async () => {
    const filePath = await createTempFile('test.md', 'content');

    const result = await withFileLock(filePath, async () => {
      return 'operation-result';
    });

    expect(result).toBe('operation-result');
  });

  it('should return the value from the operation', async () => {
    const filePath = await createTempFile('test.md', 'content');

    const result = await withFileLock(filePath, async () => {
      return { answer: 42 };
    });

    expect(result).toEqual({ answer: 42 });
  });

  it('should release lock even when operation throws', async () => {
    const filePath = await createTempFile('test.md', 'content');

    await expect(
      withFileLock(filePath, async () => {
        throw new Error('operation failed');
      }),
    ).rejects.toThrow('operation failed');

    // Lock should be released — we can re-acquire it
    const result = await withFileLock(filePath, async () => 'recovered');
    expect(result).toBe('recovered');
  });

  it('should serialize concurrent access (two operations do not interleave)', async () => {
    const filePath = await createTempFile('test.md', 'content');
    const order: string[] = [];

    // Start two concurrent locked operations. The second should wait
    // for the first to complete before starting.
    const op1 = withFileLock(
      filePath,
      async () => {
        order.push('op1-start');
        await delay(100);
        order.push('op1-end');
      },
      { retries: 10, retryDelay: 50, lockTimeout: 5000 },
    );

    // Small delay to ensure op1 acquires the lock first
    await delay(10);

    const op2 = withFileLock(
      filePath,
      async () => {
        order.push('op2-start');
        await delay(50);
        order.push('op2-end');
      },
      { retries: 10, retryDelay: 50, lockTimeout: 5000 },
    );

    await Promise.all([op1, op2]);

    // op1 should fully complete before op2 begins
    expect(order.indexOf('op1-start')).toBeLessThan(order.indexOf('op1-end'));
    expect(order.indexOf('op1-end')).toBeLessThan(order.indexOf('op2-start'));
    expect(order.indexOf('op2-start')).toBeLessThan(order.indexOf('op2-end'));
  });

  it('should timeout when lock cannot be acquired within lockTimeout', async () => {
    const filePath = await createTempFile('test.md', 'content');

    // Acquire the lock and hold it for a long time
    const longOperation = withFileLock(
      filePath,
      async () => {
        await delay(3000);
        return 'done';
      },
      { lockTimeout: 10000 },
    );

    // Small delay to ensure the first lock is acquired
    await delay(100);

    // Try to acquire the same lock with a very short timeout.
    // Two possible failure modes:
    //   1. Our lockTimeout fires first -> LockTimeoutError
    //   2. proper-lockfile retries exhaust first -> ELOCKED error
    // Either way, the operation should NOT succeed.
    const shortTimeout = withFileLock(
      filePath,
      async () => 'should-not-run',
      {
        retries: 0,
        retryDelay: 10,
        lockTimeout: 200,
        staleTimeout: 30000,
      },
    );

    // The operation must fail — either with our timeout or proper-lockfile's ELOCKED
    await expect(shortTimeout).rejects.toThrow();

    // Verify the operation callback was never executed by checking it throws
    let caught: Error | undefined;
    try {
      await shortTimeout;
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeDefined();
    // It should be one of our two expected error types
    const isLockTimeout = caught instanceof LockTimeoutError;
    const isElocked = (caught as { code?: string })?.code === 'ELOCKED';
    expect(isLockTimeout || isElocked).toBe(true);

    // Clean up the long operation
    await longOperation;
  });

  it('should recover from stale locks', async () => {
    const filePath = await createTempFile('test.md', 'content');

    // proper-lockfile uses a directory as its lock marker.
    // Create a stale lock directory with an old mtime so that
    // proper-lockfile detects it as stale and removes it.
    const lockPath = `${filePath}.lock`;
    await mkdir(lockPath, { recursive: true });

    // Set mtime to 60 seconds in the past — well beyond our 500ms stale timeout
    const past = new Date(Date.now() - 60_000);
    await utimes(lockPath, past, past);

    // With a short stale timeout, proper-lockfile should detect
    // the lock as stale and recover
    const result = await withFileLock(
      filePath,
      async () => 'recovered-from-stale',
      {
        staleTimeout: 500,
        retries: 3,
        retryDelay: 100,
        lockTimeout: 5000,
      },
    );

    expect(result).toBe('recovered-from-stale');
  });

  it('should support custom retry options', async () => {
    const filePath = await createTempFile('test.md', 'content');

    const result = await withFileLock(
      filePath,
      async () => 'custom-options-result',
      {
        retries: 5,
        retryDelay: 100,
        staleTimeout: 5000,
        lockTimeout: 10000,
      },
    );

    expect(result).toBe('custom-options-result');
  });
});

describe('LockTimeoutError', () => {
  it('should have the correct properties', () => {
    const err = new LockTimeoutError('/path/to/file.md', 5000);

    expect(err.name).toBe('LockTimeoutError');
    expect(err.code).toBe('LOCK_TIMEOUT');
    expect(err.message).toContain('5000ms');
    expect(err.message).toContain('/path/to/file.md');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(LockTimeoutError);
  });
});
