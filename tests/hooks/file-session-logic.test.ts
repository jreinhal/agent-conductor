/**
 * Tests for file-session pure logic utilities.
 *
 * These functions are extracted from the React UI layer so they can
 * be tested in a Node-only vitest environment without a DOM.
 */

import { describe, it, expect } from 'vitest';
import type { ProtocolEntry, Stance } from '@/lib/protocol/types';
import {
  diffEntries,
  getStanceDisplay,
  confidenceToPercent,
  formatRelativeTime,
  getAgentColor,
  hashString,
  getSessionStatus,
  getCurrentRound,
  getStatusBadge,
  getEntryStatusDisplay,
  getAgentInitials,
} from '@/lib/file-session-utils';

// ─── Helpers ────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<ProtocolEntry> & { entryId?: string; round?: number; turn?: number }): ProtocolEntry {
  const { entryId, round, turn, ...rest } = overrides;
  return {
    metadata: {
      entryId: entryId ?? `entry-${Math.random().toString(36).slice(2, 10)}`,
      turn: turn ?? 1,
      round: round ?? 1,
    },
    timestamp: '2025-01-15T10:00:00Z',
    author: 'agent-a',
    status: 'yield',
    fields: {},
    body: '',
    hasYield: true,
    ...rest,
  };
}

// ─── diffEntries ────────────────────────────────────────────────────

describe('diffEntries', () => {
  it('returns empty array when both arrays are empty', () => {
    expect(diffEntries([], [])).toEqual([]);
  });

  it('returns all entries when previous is empty', () => {
    const current = [makeEntry({ entryId: 'a' }), makeEntry({ entryId: 'b' })];
    const result = diffEntries([], current);
    expect(result).toHaveLength(2);
    expect(result[0].metadata.entryId).toBe('a');
    expect(result[1].metadata.entryId).toBe('b');
  });

  it('returns empty when current equals previous', () => {
    const entries = [makeEntry({ entryId: 'a' }), makeEntry({ entryId: 'b' })];
    expect(diffEntries(entries, entries)).toEqual([]);
  });

  it('returns only new entries when entries are appended', () => {
    const prev = [makeEntry({ entryId: 'a' }), makeEntry({ entryId: 'b' })];
    const current = [
      ...prev,
      makeEntry({ entryId: 'c' }),
      makeEntry({ entryId: 'd' }),
    ];
    const result = diffEntries(prev, current);
    expect(result).toHaveLength(2);
    expect(result[0].metadata.entryId).toBe('c');
    expect(result[1].metadata.entryId).toBe('d');
  });

  it('handles re-parse where IDs overlap partially', () => {
    const prev = [makeEntry({ entryId: 'a' }), makeEntry({ entryId: 'b' })];
    const current = [makeEntry({ entryId: 'b' }), makeEntry({ entryId: 'c' })];
    const result = diffEntries(prev, current);
    expect(result).toHaveLength(1);
    expect(result[0].metadata.entryId).toBe('c');
  });
});

// ─── getStanceDisplay ───────────────────────────────────────────────

describe('getStanceDisplay', () => {
  it('returns green check for approve', () => {
    const display = getStanceDisplay('approve');
    expect(display.icon).toBe('check');
    expect(display.label).toBe('Approve');
    expect(display.colorClass).toContain('emerald');
  });

  it('returns red X for reject', () => {
    const display = getStanceDisplay('reject');
    expect(display.icon).toBe('x');
    expect(display.label).toBe('Reject');
    expect(display.colorClass).toContain('red');
  });

  it('returns gray minus for neutral', () => {
    const display = getStanceDisplay('neutral');
    expect(display.icon).toBe('minus');
    expect(display.label).toBe('Neutral');
    expect(display.colorClass).toContain('gray');
  });

  it('returns amber clock for defer', () => {
    const display = getStanceDisplay('defer');
    expect(display.icon).toBe('clock');
    expect(display.label).toBe('Defer');
    expect(display.colorClass).toContain('amber');
  });

  it('returns neutral for undefined stance', () => {
    const display = getStanceDisplay(undefined);
    expect(display.icon).toBe('minus');
    expect(display.label).toBe('Neutral');
  });

  it('returns neutral for invalid stance', () => {
    const display = getStanceDisplay('invalid' as Stance);
    expect(display.icon).toBe('minus');
    expect(display.label).toBe('Neutral');
  });
});

// ─── confidenceToPercent ────────────────────────────────────────────

describe('confidenceToPercent', () => {
  it('returns 0 for undefined', () => {
    expect(confidenceToPercent(undefined)).toBe(0);
  });

  it('returns 0 for NaN', () => {
    expect(confidenceToPercent(NaN)).toBe(0);
  });

  it('converts 0.0 to 0', () => {
    expect(confidenceToPercent(0)).toBe(0);
  });

  it('converts 1.0 to 100', () => {
    expect(confidenceToPercent(1.0)).toBe(100);
  });

  it('converts 0.75 to 75', () => {
    expect(confidenceToPercent(0.75)).toBe(75);
  });

  it('converts 0.333 to 33', () => {
    expect(confidenceToPercent(0.333)).toBe(33);
  });

  it('clamps values above 1.0 to 100', () => {
    expect(confidenceToPercent(1.5)).toBe(100);
  });

  it('clamps negative values to 0', () => {
    expect(confidenceToPercent(-0.5)).toBe(0);
  });
});

// ─── formatRelativeTime ─────────────────────────────────────────────

describe('formatRelativeTime', () => {
  const now = new Date('2025-01-15T12:00:00Z');

  it('returns "just now" for timestamps less than 1 minute ago', () => {
    expect(formatRelativeTime('2025-01-15T11:59:30Z', now)).toBe('just now');
  });

  it('returns "just now" for future timestamps', () => {
    expect(formatRelativeTime('2025-01-15T13:00:00Z', now)).toBe('just now');
  });

  it('returns minutes for timestamps < 1 hour ago', () => {
    expect(formatRelativeTime('2025-01-15T11:55:00Z', now)).toBe('5 min ago');
    expect(formatRelativeTime('2025-01-15T11:30:00Z', now)).toBe('30 min ago');
  });

  it('returns hours for timestamps < 24 hours ago', () => {
    expect(formatRelativeTime('2025-01-15T10:00:00Z', now)).toBe('2 hr ago');
    expect(formatRelativeTime('2025-01-14T18:00:00Z', now)).toBe('18 hr ago');
  });

  it('returns "1 day ago" for singular day', () => {
    expect(formatRelativeTime('2025-01-14T12:00:00Z', now)).toBe('1 day ago');
  });

  it('returns days for timestamps > 24 hours ago', () => {
    expect(formatRelativeTime('2025-01-12T12:00:00Z', now)).toBe('3 days ago');
  });

  it('returns raw string for invalid timestamps', () => {
    expect(formatRelativeTime('not-a-date', now)).toBe('not-a-date');
  });

  it('returns raw string for empty timestamp', () => {
    expect(formatRelativeTime('', now)).toBe('');
  });
});

// ─── hashString & getAgentColor ─────────────────────────────────────

describe('hashString', () => {
  it('returns a non-negative integer', () => {
    const h = hashString('agent-a');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(h)).toBe(true);
  });

  it('produces deterministic output', () => {
    expect(hashString('agent-a')).toBe(hashString('agent-a'));
    expect(hashString('code-reviewer')).toBe(hashString('code-reviewer'));
  });

  it('produces different hashes for different inputs', () => {
    expect(hashString('agent-a')).not.toBe(hashString('agent-b'));
  });
});

describe('getAgentColor', () => {
  it('returns a color object with bg, text, ring', () => {
    const color = getAgentColor('agent-a');
    expect(color).toHaveProperty('bg');
    expect(color).toHaveProperty('text');
    expect(color).toHaveProperty('ring');
    expect(color.bg).toMatch(/^bg-/);
    expect(color.text).toMatch(/^text-/);
    expect(color.ring).toMatch(/^ring-/);
  });

  it('returns consistent colors for the same name', () => {
    const c1 = getAgentColor('code-reviewer');
    const c2 = getAgentColor('code-reviewer');
    expect(c1).toEqual(c2);
  });

  it('returns different colors for different names (probabilistic)', () => {
    // Not guaranteed but very likely with 10 colors
    const names = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot'];
    const colors = names.map((n) => getAgentColor(n).bg);
    const uniqueColors = new Set(colors);
    expect(uniqueColors.size).toBeGreaterThan(1);
  });

  it('returns first palette entry for empty name', () => {
    const color = getAgentColor('');
    expect(color.bg).toBe('bg-blue-500');
  });
});

// ─── getSessionStatus ───────────────────────────────────────────────

describe('getSessionStatus', () => {
  it('returns "waiting" when there are no entries', () => {
    expect(getSessionStatus([])).toBe('waiting');
  });

  it('returns "active" when entries exist but session is not complete', () => {
    const entries = [makeEntry({ status: 'yield', round: 1 })];
    expect(getSessionStatus(entries, 5)).toBe('active');
  });

  it('returns "complete" when last entry has status "closed"', () => {
    const entries = [
      makeEntry({ status: 'yield', round: 1 }),
      makeEntry({ status: 'closed', round: 2 }),
    ];
    expect(getSessionStatus(entries, 5)).toBe('complete');
  });

  it('returns "complete" when max rounds are exhausted', () => {
    const entries = [makeEntry({ status: 'yield', round: 3 })];
    expect(getSessionStatus(entries, 3)).toBe('complete');
  });

  it('returns "active" when maxRounds is undefined', () => {
    const entries = [makeEntry({ status: 'yield', round: 100 })];
    expect(getSessionStatus(entries)).toBe('active');
  });
});

// ─── getCurrentRound ────────────────────────────────────────────────

describe('getCurrentRound', () => {
  it('returns 0 when there are no entries', () => {
    expect(getCurrentRound([])).toBe(0);
  });

  it('returns the round of the last entry', () => {
    const entries = [
      makeEntry({ round: 1 }),
      makeEntry({ round: 2 }),
      makeEntry({ round: 3 }),
    ];
    expect(getCurrentRound(entries)).toBe(3);
  });
});

// ─── getStatusBadge ─────────────────────────────────────────────────

describe('getStatusBadge', () => {
  it('returns correct badge for active', () => {
    const badge = getStatusBadge('active');
    expect(badge.label).toBe('Active');
    expect(badge.colorClass).toContain('emerald');
  });

  it('returns correct badge for complete', () => {
    const badge = getStatusBadge('complete');
    expect(badge.label).toBe('Complete');
    expect(badge.colorClass).toContain('blue');
  });

  it('returns correct badge for waiting', () => {
    const badge = getStatusBadge('waiting');
    expect(badge.label).toBe('Waiting');
    expect(badge.colorClass).toContain('gray');
  });
});

// ─── getEntryStatusDisplay ──────────────────────────────────────────

describe('getEntryStatusDisplay', () => {
  it('returns Yield for yield status', () => {
    expect(getEntryStatusDisplay('yield').label).toBe('Yield');
  });

  it('returns Open for open status', () => {
    expect(getEntryStatusDisplay('open').label).toBe('Open');
  });

  it('returns In Progress for in_progress status', () => {
    expect(getEntryStatusDisplay('in_progress').label).toBe('In Progress');
  });

  it('returns Closed for closed status', () => {
    expect(getEntryStatusDisplay('closed').label).toBe('Closed');
  });

  it('returns raw status for unknown status', () => {
    expect(getEntryStatusDisplay('unknown').label).toBe('unknown');
  });
});

// ─── getAgentInitials ───────────────────────────────────────────────

describe('getAgentInitials', () => {
  it('returns two-letter initials from hyphenated name', () => {
    expect(getAgentInitials('code-reviewer')).toBe('CR');
  });

  it('returns two-letter initials from underscore name', () => {
    expect(getAgentInitials('code_reviewer')).toBe('CR');
  });

  it('returns two-letter initials from space-separated name', () => {
    expect(getAgentInitials('code reviewer')).toBe('CR');
  });

  it('returns first two chars uppercased for single-word name', () => {
    expect(getAgentInitials('alice')).toBe('AL');
  });

  it('returns ?? for empty name', () => {
    expect(getAgentInitials('')).toBe('??');
  });

  it('handles single character name', () => {
    expect(getAgentInitials('A')).toBe('A');
  });
});
