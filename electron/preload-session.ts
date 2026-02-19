/**
 * Bounce Protocol — Preload Bridge (renderer side)
 *
 * Exposes a `sessionBridge` object on `window` that the React app
 * can use to interact with session files through the Electron IPC
 * layer without direct access to Node or ipcRenderer.
 *
 * Usage in the renderer:
 *   window.sessionBridge.subscribe('/path/to/session.md', (event) => { ... });
 *   const result = await window.sessionBridge.getCurrentSession('/path/to/session.md');
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { WatcherEvent } from '../lib/protocol/watcher';
import type { ParseResult } from '../lib/protocol/types';
import type { CreateSessionOptions, AppendEntryPayload } from './services/session-ipc';

// Callback registry keyed by session path — allows multiple
// subscriptions to the same session and proper cleanup.
const callbackMap = new Map<string, Set<(event: WatcherEvent) => void>>();

// Single listener on the 'session:update' channel that dispatches
// events to the correct callbacks.
ipcRenderer.on('session:update', (_event, watcherEvent: WatcherEvent) => {
  const callbacks = callbackMap.get(watcherEvent.sessionPath);
  if (callbacks) {
    for (const cb of callbacks) {
      try {
        cb(watcherEvent);
      } catch (err) {
        console.error('[sessionBridge] callback error:', err);
      }
    }
  }
});

contextBridge.exposeInMainWorld('sessionBridge', {
  /**
   * Subscribe to live updates for a session file.
   * Returns the current parse result (or null) and pushes future changes
   * to the provided callback.
   */
  subscribe: async (
    sessionPath: string,
    callback: (event: WatcherEvent) => void,
  ): Promise<ParseResult | null> => {
    // Register local callback.
    if (!callbackMap.has(sessionPath)) {
      callbackMap.set(sessionPath, new Set());
    }
    callbackMap.get(sessionPath)!.add(callback);

    // Tell the main process we want updates for this path.
    return ipcRenderer.invoke('session:subscribe', sessionPath);
  },

  /**
   * Unsubscribe a specific callback from a session path.
   * If no callbacks remain, tells the main process to stop sending updates.
   */
  unsubscribe: (
    sessionPath: string,
    callback?: (event: WatcherEvent) => void,
  ): void => {
    const callbacks = callbackMap.get(sessionPath);
    if (callbacks) {
      if (callback) {
        callbacks.delete(callback);
      } else {
        callbacks.clear();
      }
      if (callbacks.size === 0) {
        callbackMap.delete(sessionPath);
        ipcRenderer.send('session:unsubscribe', sessionPath);
      }
    }
  },

  /** Get the current parsed state of a session file. */
  getCurrentSession: (sessionPath: string): Promise<ParseResult | null> => {
    return ipcRenderer.invoke('session:get-current', sessionPath);
  },

  /** List all .md session files in the sessions directory. */
  listSessions: (): Promise<string[]> => {
    return ipcRenderer.invoke('session:list');
  },

  /** Create a new session file with the given content. */
  createSession: (options: CreateSessionOptions): Promise<string> => {
    return ipcRenderer.invoke('session:create', options);
  },

  /** Append a raw markdown entry to an existing session file. */
  appendEntry: (
    sessionPath: string,
    payload: AppendEntryPayload,
  ): Promise<boolean> => {
    return ipcRenderer.invoke('session:append-entry', sessionPath, payload);
  },
});
