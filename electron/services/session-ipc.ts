/**
 * Bounce Protocol — IPC Bridge (Electron main process)
 *
 * Connects the SessionWatcher (file system) to the renderer process
 * via Electron IPC channels. The renderer subscribes to specific
 * session paths and receives push events when those files change.
 *
 * IPC Channels:
 *   session:subscribe         — Renderer subscribes to a session path
 *   session:unsubscribe       — Renderer unsubscribes from a session path
 *   session:get-current       — Renderer requests current state of a session
 *   session:list              — List all session files in the sessions directory
 *   session:update            — Main → Renderer push when session changes
 *   session:create            — Renderer requests creation of a new session
 *   session:append-entry      — Renderer requests appending an entry to a session
 */

import { ipcMain, BrowserWindow } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { SessionWatcher, WatcherEvent } from '../../lib/protocol/watcher';
import type { ParseResult } from '../../lib/protocol/types';

// ─── Types for IPC payloads ──────────────────────────────────────────

export interface CreateSessionOptions {
  /** Filename (without directory). Example: "my-session.md" */
  filename: string;
  /** Initial markdown content for the session file. */
  content: string;
}

export interface AppendEntryPayload {
  /** Raw markdown text to append (including entry comments, fields, yield). */
  markdownText: string;
}

// ─── Registration ────────────────────────────────────────────────────

/**
 * Register all session-related IPC handlers and wire them to the
 * given SessionWatcher instance. Call this once from the main process
 * after the watcher has been started.
 */
export function registerSessionIPC(
  mainWindow: BrowserWindow,
  watcher: SessionWatcher,
): void {
  /** Set of normalised session paths the renderer is subscribed to. */
  const subscriptions = new Set<string>();

  // ── Watcher → Renderer push ────────────────────────────────────

  const onSession = (event: WatcherEvent) => {
    if (!subscriptions.has(event.sessionPath)) return;
    if (mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('session:update', event);
  };

  watcher.on('session', onSession);

  // Clean up when the window closes.
  mainWindow.once('closed', () => {
    watcher.removeListener('session', onSession);
    subscriptions.clear();
  });

  // ── session:subscribe ──────────────────────────────────────────

  ipcMain.handle(
    'session:subscribe',
    async (_ipcEvent, sessionPath: string): Promise<ParseResult | null> => {
      const normalized = normalizePath(sessionPath);
      subscriptions.add(normalized);
      // Return the current state so the renderer doesn't need a second round-trip.
      return watcher.getSession(normalized);
    },
  );

  // ── session:unsubscribe ────────────────────────────────────────

  ipcMain.on('session:unsubscribe', (_ipcEvent, sessionPath: string) => {
    const normalized = normalizePath(sessionPath);
    subscriptions.delete(normalized);
  });

  // ── session:get-current ────────────────────────────────────────

  ipcMain.handle(
    'session:get-current',
    async (_ipcEvent, sessionPath: string): Promise<ParseResult | null> => {
      const normalized = normalizePath(sessionPath);
      return watcher.getSession(normalized);
    },
  );

  // ── session:list ───────────────────────────────────────────────

  ipcMain.handle('session:list', async (): Promise<string[]> => {
    try {
      const dir = (watcher as unknown as { sessionsDir: string }).sessionsDir;
      const files = await fs.readdir(dir);
      return files
        .filter((f) => f.endsWith('.md') && !f.endsWith('.lock'))
        .map((f) => path.join(dir, f).replace(/\\/g, '/'));
    } catch {
      return [];
    }
  });

  // ── session:create ─────────────────────────────────────────────

  ipcMain.handle(
    'session:create',
    async (_ipcEvent, options: CreateSessionOptions): Promise<string> => {
      const dir = (watcher as unknown as { sessionsDir: string }).sessionsDir;
      const filePath = path.join(dir, options.filename);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, options.content, 'utf-8');
      return filePath.replace(/\\/g, '/');
    },
  );

  // ── session:append-entry ───────────────────────────────────────

  ipcMain.handle(
    'session:append-entry',
    async (
      _ipcEvent,
      sessionPath: string,
      payload: AppendEntryPayload,
    ): Promise<boolean> => {
      try {
        await fs.appendFile(sessionPath, '\n' + payload.markdownText, 'utf-8');
        return true;
      } catch (err) {
        console.error('[session-ipc] append-entry failed:', err);
        return false;
      }
    },
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function normalizePath(filePath: string): string {
  return path.resolve(filePath).replace(/\\/g, '/');
}
