'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { BounceSession, ProtocolEntry, ParseResult } from '@/lib/protocol/types';
import { diffEntries } from '@/lib/file-session-utils';

// ─── Types ──────────────────────────────────────────────────────────

export interface UseFileSessionOptions {
  /** Path to the session file */
  sessionPath: string | null;
  /** Whether to auto-scroll to bottom on new entries */
  autoScroll?: boolean;
  /** Polling interval in ms for web mode fallback (default 2000) */
  pollInterval?: number;
}

export interface UseFileSessionReturn {
  /** Parsed session data */
  session: BounceSession | null;
  /** All entries in the session */
  entries: ProtocolEntry[];
  /** Whether the session is loading */
  loading: boolean;
  /** Error message if any */
  error: string | null;
  /** Number of new entries since last view */
  newEntryCount: number;
  /** Mark all entries as seen */
  markAllSeen: () => void;
  /** Whether connected to the watcher */
  connected: boolean;
}

// ─── Session Bridge Interface ───────────────────────────────────────

/**
 * The Electron session bridge interface exposed on `window.sessionBridge`.
 * When running in Electron, the preload script exposes this object
 * so the renderer can receive live file-watcher updates via IPC.
 */
interface SessionBridge {
  /** Subscribe to session updates. Returns an unsubscribe function. */
  onSessionUpdate: (
    callback: (event: { parseResult: ParseResult; sessionPath: string }) => void,
  ) => () => void;
  /** Request the current state of a session file. */
  getSession: (sessionPath: string) => Promise<ParseResult | null>;
  /** Whether the bridge is connected. */
  isConnected: () => boolean;
}

declare global {
  interface Window {
    sessionBridge?: SessionBridge;
  }
}

// ─── Hook ───────────────────────────────────────────────────────────

export function useFileSession(options: UseFileSessionOptions): UseFileSessionReturn {
  const { sessionPath, autoScroll = true, pollInterval = 2000 } = options;

  const [session, setSession] = useState<BounceSession | null>(null);
  const [entries, setEntries] = useState<ProtocolEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [seenCount, setSeenCount] = useState(0);

  // Track previous entries for diffing
  const previousEntriesRef = useRef<ProtocolEntry[]>([]);

  // Calculate new entry count
  const newEntryCount = Math.max(0, entries.length - seenCount);

  // Mark all entries as seen
  const markAllSeen = useCallback(() => {
    setSeenCount(entries.length);
  }, [entries.length]);

  // Process a parse result into state
  const processParseResult = useCallback((parseResult: ParseResult) => {
    if (!parseResult.session) {
      setError('Failed to parse session file');
      return;
    }

    const parsedSession = parseResult.session as BounceSession;
    const newEntries = parsedSession.entries ?? [];

    setSession(parsedSession);
    setEntries(newEntries);
    setError(null);

    previousEntriesRef.current = newEntries;
  }, []);

  // Effect: Electron bridge mode
  useEffect(() => {
    if (!sessionPath) {
      setSession(null);
      setEntries([]);
      setError(null);
      setConnected(false);
      setSeenCount(0);
      return;
    }

    const bridge = typeof window !== 'undefined' ? window.sessionBridge : undefined;

    if (bridge) {
      // Electron mode: use IPC bridge
      setConnected(bridge.isConnected());
      setLoading(true);

      // Initial load
      bridge
        .getSession(sessionPath)
        .then((result) => {
          if (result) {
            processParseResult(result);
          }
          setLoading(false);
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        });

      // Subscribe to live updates
      const unsubscribe = bridge.onSessionUpdate((event) => {
        if (event.sessionPath === sessionPath) {
          processParseResult(event.parseResult);
        }
      });

      return () => {
        unsubscribe();
      };
    }

    // Web mode fallback: no real file access, just mark as disconnected.
    // In web mode, session data would need to be passed in via props
    // or fetched from an API. This hook provides the "disconnected" state
    // so the UI can show an appropriate message.
    setConnected(false);
    setLoading(false);

    return undefined;
  }, [sessionPath, processParseResult]);

  return {
    session,
    entries,
    loading,
    error,
    newEntryCount,
    markAllSeen,
    connected,
  };
}
