'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import {
  FileText,
  Users,
  ArrowDown,
  WifiOff,
  Loader2,
  AlertCircle,
  RotateCcw,
} from 'lucide-react';
import type { BounceSession, ProtocolEntry, ProtocolRules } from '@/lib/protocol/types';
import { useFileSession } from '@/hooks/useFileSession';
import { SessionEntryCard } from './SessionEntryCard';
import { SessionTimeline } from './SessionTimeline';
import {
  getSessionStatus,
  getStatusBadge,
  getCurrentRound,
} from '@/lib/file-session-utils';

// ─── Types ──────────────────────────────────────────────────────────

export interface FileSessionPanelProps {
  sessionPath: string;
  className?: string;
}

// ─── Default Protocol Rules ─────────────────────────────────────────

const DEFAULT_RULES: ProtocolRules = {
  agents: [],
  turnOrder: 'round-robin',
  maxTurnsPerRound: 4,
  turnTimeout: 120,
  consensusThreshold: 0.7,
  consensusMode: 'majority',
  escalation: 'human',
  maxRounds: 5,
  outputFormat: 'structured',
};

// ─── Component ──────────────────────────────────────────────────────

export function FileSessionPanel({ sessionPath, className = '' }: FileSessionPanelProps) {
  const {
    session,
    entries,
    loading,
    error,
    newEntryCount,
    markAllSeen,
    connected,
  } = useFileSession({ sessionPath, autoScroll: true });

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollBottomRef = useRef<HTMLDivElement>(null);
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const [seenEntryIds, setSeenEntryIds] = useState<Set<string>>(new Set());

  // Track which entries are "new" for animation
  const prevEntryCountRef = useRef(0);
  useEffect(() => {
    if (entries.length > prevEntryCountRef.current) {
      // New entries arrived: mark old ones as seen
      const oldIds = entries.slice(0, prevEntryCountRef.current).map((e) => e.metadata.entryId);
      setSeenEntryIds(new Set(oldIds));
    }
    prevEntryCountRef.current = entries.length;
  }, [entries]);

  // Auto-scroll on new entries
  useEffect(() => {
    if (!isScrolledUp && scrollBottomRef.current) {
      scrollBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [entries.length, isScrolledUp]);

  // Detect scroll position
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    setIsScrolledUp(distFromBottom > 100);
  }, []);

  // Scroll to bottom handler
  const scrollToBottom = useCallback(() => {
    scrollBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    markAllSeen();
    setIsScrolledUp(false);
  }, [markAllSeen]);

  // Derive display data
  const rules = session?.rules ?? DEFAULT_RULES;
  const currentRound = getCurrentRound(entries);
  const sessionStatus = getSessionStatus(entries, rules.maxRounds);
  const statusBadge = getStatusBadge(sessionStatus);
  const agentCount = rules.agents.length;
  const title = session?.title ?? 'Loading session...';

  // ─── Loading State ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className={`flex flex-col bg-[#14141a] rounded-xl border border-[#2a2a38] overflow-hidden h-[600px] ${className}`}>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-gray-500">
            <Loader2 className="w-8 h-8 animate-spin" />
            <p className="text-sm">Loading session...</p>
          </div>
        </div>
      </div>
    );
  }

  // ─── Error State ──────────────────────────────────────────────────
  if (error) {
    return (
      <div className={`flex flex-col bg-[#14141a] rounded-xl border border-[#2a2a38] overflow-hidden h-[600px] ${className}`}>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="p-3 rounded-full bg-red-500/10">
              <AlertCircle className="w-6 h-6 text-red-400" />
            </div>
            <p className="text-sm font-medium text-red-400">Failed to load session</p>
            <p className="text-xs text-gray-500 max-w-xs">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  // ─── Disconnected State ───────────────────────────────────────────
  if (!connected && !session) {
    return (
      <div className={`flex flex-col bg-[#14141a] rounded-xl border border-[#2a2a38] overflow-hidden h-[600px] ${className}`}>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="p-3 rounded-full bg-gray-500/10">
              <WifiOff className="w-6 h-6 text-gray-500" />
            </div>
            <p className="text-sm font-medium text-gray-400">Not connected</p>
            <p className="text-xs text-gray-500 max-w-xs">
              File session watching is only available in desktop mode (Electron).
              In web mode, session data must be loaded through other means.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ─── Main Render ──────────────────────────────────────────────────
  return (
    <div
      className={`
        flex flex-col bg-[#14141a] rounded-xl border border-[#2a2a38] overflow-hidden h-[600px]
        shadow-sm hover:shadow-md
        ${className}
      `}
      style={{
        transition:
          'box-shadow 300ms cubic-bezier(0.25, 0.1, 0.25, 1), border-color 250ms cubic-bezier(0.25, 0.1, 0.25, 1)',
      }}
    >
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1f1f2a] bg-[#18181f]/50">
        <div className="flex items-center gap-3 min-w-0">
          {/* File icon with pulse when active */}
          <div className="relative shrink-0">
            <FileText
              className={`w-4 h-4 ${sessionStatus === 'active' ? 'text-emerald-400' : 'text-gray-500'}`}
            />
            {sessionStatus === 'active' && (
              <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </div>

          {/* Title */}
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-semibold text-gray-100 truncate">
              {title}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Status badge */}
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${statusBadge.bgClass} ${statusBadge.colorClass}`}
          >
            {statusBadge.label}
          </span>

          {/* Agent count */}
          <div className="flex items-center gap-1 text-gray-500">
            <Users className="w-3 h-3" />
            <span className="text-[10px] tabular-nums">{agentCount}</span>
          </div>

          {/* Round counter */}
          <div className="flex items-center gap-1 text-gray-500">
            <RotateCcw className="w-3 h-3" />
            <span className="text-[10px] tabular-nums">
              {currentRound}/{rules.maxRounds}
            </span>
          </div>

          {/* Connection indicator */}
          {!connected && (
            <WifiOff className="w-3 h-3 text-amber-400" title="Live updates disconnected" />
          )}
        </div>
      </div>

      {/* ── Timeline Bar ────────────────────────────────────────────── */}
      <SessionTimeline
        entries={entries}
        rules={rules}
        currentRound={currentRound}
      />

      {/* ── Entry List ──────────────────────────────────────────────── */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto p-3 space-y-3 scrollable"
        onScroll={handleScroll}
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {entries.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-gray-500">
            <div className="w-12 h-12 mb-3 rounded-full bg-[#1f1f2a] flex items-center justify-center">
              <FileText className="w-6 h-6" />
            </div>
            <p className="text-sm font-medium">No entries yet</p>
            <p className="text-xs mt-1 text-gray-600">
              Waiting for agents to contribute...
            </p>
          </div>
        )}

        {entries.map((entry) => {
          const isNewEntry = !seenEntryIds.has(entry.metadata.entryId);
          return (
            <SessionEntryCard
              key={entry.metadata.entryId}
              entry={entry}
              isNew={isNewEntry}
            />
          );
        })}

        {/* Scroll anchor */}
        <div ref={scrollBottomRef} />
      </div>

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-[#1f1f2a] bg-[#18181f]/50">
        {/* Current state */}
        <div className="flex items-center gap-2">
          <div
            className={`w-1.5 h-1.5 rounded-full ${
              sessionStatus === 'active'
                ? 'bg-emerald-400 animate-pulse'
                : sessionStatus === 'complete'
                  ? 'bg-blue-400'
                  : 'bg-gray-500'
            }`}
          />
          <span className="text-[11px] text-gray-500">
            {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
            {sessionStatus === 'active' && ' — live'}
          </span>
        </div>

        {/* "New entries below" button */}
        {isScrolledUp && newEntryCount > 0 && (
          <button
            onClick={scrollToBottom}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/20 text-blue-400 text-[11px] font-medium hover:bg-blue-500/30"
            style={{ transition: 'background-color 150ms ease' }}
          >
            <ArrowDown className="w-3 h-3" />
            {newEntryCount} new {newEntryCount === 1 ? 'entry' : 'entries'}
          </button>
        )}
      </div>
    </div>
  );
}
