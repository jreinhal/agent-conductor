/**
 * File-Session UI — Pure Utility Functions
 *
 * Stateless, testable helper functions for the file-session renderer.
 * These are extracted from the UI layer so they can be unit-tested
 * in a Node-only vitest environment without a DOM.
 */

import type { ProtocolEntry, Stance } from '@/lib/protocol/types';

// ─── Entry Diffing ──────────────────────────────────────────────────

/**
 * Given the previous entries array and the current entries array,
 * return only the new entries that were appended.
 *
 * Comparison is by entry ID to handle partial re-parses correctly.
 */
export function diffEntries(
  previous: ProtocolEntry[],
  current: ProtocolEntry[],
): ProtocolEntry[] {
  const previousIds = new Set(previous.map((e) => e.metadata.entryId));
  return current.filter((e) => !previousIds.has(e.metadata.entryId));
}

// ─── Stance Color Mapping ───────────────────────────────────────────

export interface StanceDisplay {
  /** Tailwind text color class. */
  colorClass: string;
  /** Tailwind background color class for badges. */
  bgClass: string;
  /** Short label. */
  label: string;
  /** Lucide icon name. */
  icon: 'check' | 'x' | 'minus' | 'clock';
}

const STANCE_MAP: Record<Stance, StanceDisplay> = {
  approve: {
    colorClass: 'text-emerald-400',
    bgClass: 'bg-emerald-500/20',
    label: 'Approve',
    icon: 'check',
  },
  reject: {
    colorClass: 'text-red-400',
    bgClass: 'bg-red-500/20',
    label: 'Reject',
    icon: 'x',
  },
  neutral: {
    colorClass: 'text-gray-400',
    bgClass: 'bg-gray-500/20',
    label: 'Neutral',
    icon: 'minus',
  },
  defer: {
    colorClass: 'text-amber-400',
    bgClass: 'bg-amber-500/20',
    label: 'Defer',
    icon: 'clock',
  },
};

/**
 * Map a stance to its display properties.
 * Returns the neutral style if the stance is unknown or undefined.
 */
export function getStanceDisplay(stance: Stance | undefined): StanceDisplay {
  if (!stance || !(stance in STANCE_MAP)) {
    return STANCE_MAP.neutral;
  }
  return STANCE_MAP[stance];
}

// ─── Confidence Bar ─────────────────────────────────────────────────

/**
 * Convert a 0.0–1.0 confidence value to a percentage (0–100).
 * Clamps to bounds and returns 0 for undefined/NaN.
 */
export function confidenceToPercent(confidence: number | undefined): number {
  if (confidence === undefined || confidence === null || isNaN(confidence)) {
    return 0;
  }
  return Math.round(Math.max(0, Math.min(1, confidence)) * 100);
}

// ─── Relative Time ──────────────────────────────────────────────────

/**
 * Format an ISO-8601 timestamp as a human-readable relative time string.
 *
 * @param isoTimestamp  ISO-8601 datetime string
 * @param now           Optional "now" reference (for testing)
 * @returns e.g. "just now", "2 min ago", "1 hr ago", "3 days ago"
 */
export function formatRelativeTime(
  isoTimestamp: string,
  now?: Date,
): string {
  const then = new Date(isoTimestamp);
  if (isNaN(then.getTime())) return isoTimestamp; // fallback to raw string

  const reference = now ?? new Date();
  const diffMs = reference.getTime() - then.getTime();

  if (diffMs < 0) return 'just now'; // future timestamps
  if (diffMs < 60_000) return 'just now';

  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 60) return `${diffMin} min ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;

  const diffDays = Math.floor(diffHr / 24);
  if (diffDays === 1) return '1 day ago';
  return `${diffDays} days ago`;
}

// ─── Agent Color Generation ─────────────────────────────────────────

/**
 * Deterministic color class for an agent name.
 * Hashes the name and picks from a palette of Tailwind color classes.
 *
 * Returns an object with `bg` and `text` Tailwind classes.
 */
export interface AgentColor {
  bg: string;
  text: string;
  ring: string;
}

const AGENT_PALETTE: AgentColor[] = [
  { bg: 'bg-blue-500', text: 'text-blue-400', ring: 'ring-blue-500/30' },
  { bg: 'bg-violet-500', text: 'text-violet-400', ring: 'ring-violet-500/30' },
  { bg: 'bg-emerald-500', text: 'text-emerald-400', ring: 'ring-emerald-500/30' },
  { bg: 'bg-amber-500', text: 'text-amber-400', ring: 'ring-amber-500/30' },
  { bg: 'bg-rose-500', text: 'text-rose-400', ring: 'ring-rose-500/30' },
  { bg: 'bg-cyan-500', text: 'text-cyan-400', ring: 'ring-cyan-500/30' },
  { bg: 'bg-orange-500', text: 'text-orange-400', ring: 'ring-orange-500/30' },
  { bg: 'bg-pink-500', text: 'text-pink-400', ring: 'ring-pink-500/30' },
  { bg: 'bg-teal-500', text: 'text-teal-400', ring: 'ring-teal-500/30' },
  { bg: 'bg-indigo-500', text: 'text-indigo-400', ring: 'ring-indigo-500/30' },
];

/**
 * Simple djb2-style hash for short strings.
 * Returns a non-negative integer.
 */
export function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Get a deterministic color for an agent name.
 */
export function getAgentColor(agentName: string): AgentColor {
  if (!agentName) return AGENT_PALETTE[0];
  const index = hashString(agentName) % AGENT_PALETTE.length;
  return AGENT_PALETTE[index];
}

// ─── Session Status ─────────────────────────────────────────────────

export type SessionStatus = 'active' | 'complete' | 'waiting';

/**
 * Determine overall session status from entries and rules.
 *
 * - "complete": last entry has status "closed" or all rounds exhausted
 * - "waiting": no entries yet
 * - "active": otherwise
 */
export function getSessionStatus(
  entries: ProtocolEntry[],
  maxRounds?: number,
): SessionStatus {
  if (entries.length === 0) return 'waiting';

  const lastEntry = entries[entries.length - 1];

  // Check if session is explicitly closed
  if (lastEntry.status === 'closed') return 'complete';

  // Check if max rounds exhausted
  if (maxRounds !== undefined && lastEntry.metadata.round >= maxRounds) {
    return 'complete';
  }

  return 'active';
}

// ─── Current Round ──────────────────────────────────────────────────

/**
 * Get the current round number from entries.
 * Returns 0 if there are no entries.
 */
export function getCurrentRound(entries: ProtocolEntry[]): number {
  if (entries.length === 0) return 0;
  return entries[entries.length - 1].metadata.round;
}

// ─── Status Badge ───────────────────────────────────────────────────

export interface StatusBadgeDisplay {
  label: string;
  colorClass: string;
  bgClass: string;
}

const STATUS_BADGE_MAP: Record<SessionStatus, StatusBadgeDisplay> = {
  active: {
    label: 'Active',
    colorClass: 'text-emerald-400',
    bgClass: 'bg-emerald-500/20',
  },
  complete: {
    label: 'Complete',
    colorClass: 'text-blue-400',
    bgClass: 'bg-blue-500/20',
  },
  waiting: {
    label: 'Waiting',
    colorClass: 'text-gray-400',
    bgClass: 'bg-gray-500/20',
  },
};

export function getStatusBadge(status: SessionStatus): StatusBadgeDisplay {
  return STATUS_BADGE_MAP[status];
}

// ─── Entry Status Badge ─────────────────────────────────────────────

export interface EntryStatusDisplay {
  label: string;
  colorClass: string;
  bgClass: string;
}

export function getEntryStatusDisplay(status: string): EntryStatusDisplay {
  switch (status) {
    case 'yield':
      return { label: 'Yield', colorClass: 'text-emerald-400', bgClass: 'bg-emerald-500/15' };
    case 'open':
      return { label: 'Open', colorClass: 'text-amber-400', bgClass: 'bg-amber-500/15' };
    case 'in_progress':
      return { label: 'In Progress', colorClass: 'text-blue-400', bgClass: 'bg-blue-500/15' };
    case 'closed':
      return { label: 'Closed', colorClass: 'text-gray-400', bgClass: 'bg-gray-500/15' };
    default:
      return { label: status, colorClass: 'text-gray-400', bgClass: 'bg-gray-500/15' };
  }
}

// ─── Agent Initials ─────────────────────────────────────────────────

/**
 * Extract up to 2 initials from an agent name.
 * e.g. "code-reviewer" -> "CR", "Alice" -> "AL"
 */
export function getAgentInitials(name: string): string {
  if (!name) return '??';
  const parts = name.split(/[-_\s]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}
