import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { SessionWatcher, WatcherEvent } from '@/lib/protocol/watcher';

// ─── Helpers ─────────────────────────────────────────────────────────

/** Minimal valid Bounce Protocol session content with zero entries. */
function makeMinimalSession(title = 'Test Session'): string {
  return [
    '<!-- bounce-protocol: 0.1 -->',
    '<!-- created: 2026-02-18T10:00:00Z -->',
    '<!-- session-id: a1b2c3d4-e5f6-7890-abcd-ef1234567890 -->',
    '',
    `# Bounce Session: ${title}`,
    '',
    '## Protocol Rules',
    '',
    '```yaml',
    'agents:',
    '  - test-agent',
    'turn-order: round-robin',
    'max-turns-per-round: 1',
    'turn-timeout: 300',
    'consensus-threshold: 0.7',
    'consensus-mode: majority',
    'escalation: human',
    'max-rounds: 3',
    'output-format: structured',
    '```',
    '',
    '## Context',
    '',
    'Test context.',
    '',
    '## Dialogue',
    '',
  ].join('\n');
}

/** A single entry block that can be appended to a session file. */
function makeEntry(
  entryId: string,
  turn: number,
  round: number,
  author = 'test-agent',
): string {
  return [
    `<!-- entry: ${entryId} -->`,
    `<!-- turn: ${turn} round: ${round} -->`,
    `2026-02-18T10:01:30Z [author: ${author}] [status: yield]`,
    'stance: approve',
    'confidence: 0.85',
    'summary: Test entry.',
    'action_requested: n/a',
    'evidence: n/a',
    '',
    'Body of the entry.',
    '',
    '<!-- yield -->',
    '',
  ].join('\n');
}

/** Collect events from a watcher, returning a promise that resolves when
 *  the first event matching the filter arrives (or after timeout). */
function waitForEvent(
  watcher: SessionWatcher,
  filter: WatcherEvent['type'],
  timeoutMs = 5000,
): Promise<WatcherEvent | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    const handler = (event: WatcherEvent) => {
      if (event.type === filter) {
        clearTimeout(timer);
        watcher.removeListener('session', handler);
        resolve(event);
      }
    };
    watcher.on('session', handler);
  });
}

/** Collect ALL events from a watcher into an array. */
function collectEvents(
  watcher: SessionWatcher,
  filter?: WatcherEvent['type'],
): WatcherEvent[] {
  const events: WatcherEvent[] = [];
  watcher.on('session', (event: WatcherEvent) => {
    if (!filter || event.type === filter) {
      events.push(event);
    }
  });
  return events;
}

/** Sleep for the given milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Watcher factory with short timings for tests ────────────────────

function createWatcher(sessionsDir: string): SessionWatcher {
  return new SessionWatcher({
    sessionsDir,
    debounceMs: 100,
    stabilityThresholdMs: 200,
  });
}

// Generous wait for polling-based watcher to detect filesystem changes on Windows.
const DETECT_WAIT = 3000;

// ─── Test Suite ──────────────────────────────────────────────────────

describe('SessionWatcher', () => {
  let tempDir: string;
  let watcher: SessionWatcher;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'watcher-test-'));
  });

  afterEach(async () => {
    if (watcher?.isWatching()) {
      await watcher.stop();
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  // ── File creation detection ──────────────────────────────────────

  describe('new file creation', () => {
    it('should detect a new .md file and emit session-created', async () => {
      watcher = createWatcher(tempDir);
      await watcher.start();

      // Set up to wait for the event before writing the file.
      const eventPromise = waitForEvent(watcher, 'session-created', 8000);

      const filePath = join(tempDir, 'new-session.md');
      await writeFile(filePath, makeMinimalSession(), 'utf-8');

      const event = await eventPromise;
      expect(event).not.toBeNull();
      expect(event!.type).toBe('session-created');
      expect(event!.parseResult).toBeDefined();
      expect(event!.parseResult!.session).not.toBeNull();
      expect(event!.parseResult!.session?.title).toBe('Test Session');
      expect(event!.timestamp).toBeTruthy();
    }, 15000);
  });

  // ── File modification detection ──────────────────────────────────

  describe('file modification (new entry appended)', () => {
    it('should detect modification and emit session-updated with new entries', async () => {
      // Pre-create the session file before starting the watcher.
      const filePath = join(tempDir, 'update-session.md');
      await writeFile(filePath, makeMinimalSession(), 'utf-8');

      watcher = createWatcher(tempDir);
      await watcher.start();

      // Wait for initial add event to settle.
      await sleep(DETECT_WAIT);

      // Set up to capture update events.
      const eventPromise = waitForEvent(watcher, 'session-updated', 8000);

      // Append an entry.
      const entryBlock = makeEntry(
        'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        1,
        1,
      );
      const original = makeMinimalSession();
      await writeFile(filePath, original + entryBlock, 'utf-8');

      const event = await eventPromise;
      expect(event).not.toBeNull();
      expect(event!.type).toBe('session-updated');
      expect(event!.newEntries).toBeDefined();
      expect(event!.newEntries!.length).toBe(1);
      expect(event!.newEntries![0].metadata.entryId).toBe(
        'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      );
    }, 20000);
  });

  // ── .lock file ignoring ──────────────────────────────────────────

  describe('ignoring .lock files', () => {
    it('should not emit events for .lock files', async () => {
      watcher = createWatcher(tempDir);
      await watcher.start();

      const allEvents = collectEvents(watcher);

      // Write a .lock file.
      const lockPath = join(tempDir, 'session.lock');
      await writeFile(lockPath, 'lock content', 'utf-8');

      // Also create a proper .md file as a control.
      const mdPath = join(tempDir, 'real-session.md');
      await writeFile(mdPath, makeMinimalSession(), 'utf-8');

      await sleep(DETECT_WAIT);

      // We should only see events for the .md file, not the .lock file.
      const lockEvents = allEvents.filter((e) =>
        e.sessionPath.endsWith('.lock'),
      );
      expect(lockEvents).toHaveLength(0);

      const mdEvents = allEvents.filter((e) =>
        e.sessionPath.endsWith('.md'),
      );
      expect(mdEvents.length).toBeGreaterThanOrEqual(1);
    }, 10000);
  });

  // ── Deduplication (same content hash) ────────────────────────────

  describe('deduplication of no-op changes', () => {
    it('should not emit session-updated when content hash is unchanged', async () => {
      const content = makeMinimalSession();
      const filePath = join(tempDir, 'dedup-session.md');
      await writeFile(filePath, content, 'utf-8');

      watcher = createWatcher(tempDir);
      await watcher.start();
      await sleep(DETECT_WAIT);

      const updateEvents = collectEvents(watcher, 'session-updated');

      // Re-write the exact same content (no-op).
      await writeFile(filePath, content, 'utf-8');
      await sleep(DETECT_WAIT);

      // Re-write again.
      await writeFile(filePath, content, 'utf-8');
      await sleep(DETECT_WAIT);

      // No session-updated events should fire for same content.
      expect(updateEvents).toHaveLength(0);
    }, 15000);
  });

  // ── Correct new entries on update ────────────────────────────────

  describe('correct new entries on update', () => {
    it('should emit only the newly appended entries, not all entries', async () => {
      const entry1 = makeEntry('11111111-1111-1111-1111-111111111111', 1, 1);
      const base = makeMinimalSession() + entry1;

      const filePath = join(tempDir, 'diff-session.md');
      await writeFile(filePath, base, 'utf-8');

      watcher = createWatcher(tempDir);
      await watcher.start();
      await sleep(DETECT_WAIT);

      const eventPromise = waitForEvent(watcher, 'session-updated', 8000);

      // Append a second entry.
      const entry2 = makeEntry('22222222-2222-2222-2222-222222222222', 2, 1);
      await writeFile(filePath, base + entry2, 'utf-8');

      const event = await eventPromise;
      expect(event).not.toBeNull();
      expect(event!.newEntries).toBeDefined();
      expect(event!.newEntries!.length).toBe(1);
      expect(event!.newEntries![0].metadata.entryId).toBe(
        '22222222-2222-2222-2222-222222222222',
      );

      // The full parse result should still contain both entries.
      expect(event!.parseResult?.session?.entries?.length).toBe(2);
    }, 20000);
  });

  // ── Malformed file handling ──────────────────────────────────────

  describe('malformed file handling', () => {
    it('should not crash when a file contains garbage content', async () => {
      watcher = createWatcher(tempDir);
      await watcher.start();

      const eventPromise = waitForEvent(watcher, 'session-created', 8000);

      const filePath = join(tempDir, 'garbage.md');
      await writeFile(filePath, '$$$ not valid protocol $$$', 'utf-8');

      const event = await eventPromise;
      // Should still emit a session-created event (parser never throws).
      expect(event).not.toBeNull();
      expect(event!.type).toBe('session-created');
      expect(event!.parseResult).toBeDefined();
      // The parse result will have validation errors but not crash.
      expect(event!.parseResult!.validation.valid).toBe(false);
    }, 15000);

    it('should not crash when a file is empty', async () => {
      watcher = createWatcher(tempDir);
      await watcher.start();

      const eventPromise = waitForEvent(watcher, 'session-created', 8000);

      const filePath = join(tempDir, 'empty.md');
      await writeFile(filePath, '', 'utf-8');

      const event = await eventPromise;
      // Should still emit a session-created event.
      expect(event).not.toBeNull();
      expect(event!.parseResult).toBeDefined();
    }, 15000);
  });

  // ── File deletion detection ──────────────────────────────────────

  describe('file deletion', () => {
    it('should emit session-deleted when a file is removed', async () => {
      const filePath = join(tempDir, 'delete-me.md');
      await writeFile(filePath, makeMinimalSession(), 'utf-8');

      watcher = createWatcher(tempDir);
      await watcher.start();
      await sleep(DETECT_WAIT);

      const eventPromise = waitForEvent(watcher, 'session-deleted', 8000);

      await unlink(filePath);

      const event = await eventPromise;
      expect(event).not.toBeNull();
      expect(event!.type).toBe('session-deleted');
      expect(event!.sessionPath).toContain('delete-me.md');
    }, 20000);
  });

  // ── getSession cache ─────────────────────────────────────────────

  describe('getSession cache', () => {
    it('should return the cached parse result for a known session', async () => {
      const filePath = join(tempDir, 'cached-session.md');
      await writeFile(filePath, makeMinimalSession('Cached'), 'utf-8');

      watcher = createWatcher(tempDir);
      await watcher.start();

      // Wait for the initial add event to populate the cache.
      await sleep(DETECT_WAIT);

      const normalizedPath = filePath.replace(/\\/g, '/');
      const result = watcher.getSession(normalizedPath);
      expect(result).not.toBeNull();
      expect(result!.session?.title).toBe('Cached');
    }, 10000);

    it('should return null for unknown session paths', async () => {
      watcher = createWatcher(tempDir);
      await watcher.start();

      const result = watcher.getSession('/nonexistent/path.md');
      expect(result).toBeNull();
    });
  });

  // ── Lifecycle ────────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('should report isWatching correctly', async () => {
      watcher = createWatcher(tempDir);

      expect(watcher.isWatching()).toBe(false);
      await watcher.start();
      expect(watcher.isWatching()).toBe(true);
      await watcher.stop();
      expect(watcher.isWatching()).toBe(false);
    });

    it('should handle double start gracefully', async () => {
      watcher = createWatcher(tempDir);

      await watcher.start();
      // Second start should be a no-op.
      await watcher.start();
      expect(watcher.isWatching()).toBe(true);
    });

    it('should handle stop when not started', async () => {
      watcher = createWatcher(tempDir);

      // Should not throw.
      await watcher.stop();
      expect(watcher.isWatching()).toBe(false);
    });
  });
});
