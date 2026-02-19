/**
 * Consensus Detection Tests
 *
 * Tests for the consensus detection engine, covering:
 * - Majority consensus mode
 * - Weighted consensus mode
 * - Unanimous consensus mode
 * - Defer handling and deadlock
 * - Latest entries per agent filtering
 */

import { describe, it, expect } from 'vitest';
import {
  detectConsensus,
  getLatestEntriesPerAgent,
} from '@/lib/coordination/consensus';
import type { ProtocolRules, ProtocolEntry, Stance } from '@/lib/protocol/types';

// ─── Helpers ─────────────────────────────────────────────────────────

/** Create minimal ProtocolRules for consensus testing. */
function makeRules(overrides: Partial<ProtocolRules> = {}): ProtocolRules {
  return {
    agents: ['agent-a', 'agent-b', 'agent-c'],
    turnOrder: 'round-robin',
    maxTurnsPerRound: 1,
    turnTimeout: 300,
    consensusThreshold: 0.7,
    consensusMode: 'majority',
    escalation: 'human',
    maxRounds: 5,
    outputFormat: 'structured',
    ...overrides,
  };
}

/** Create a ProtocolEntry with specified stance and confidence. */
function makeEntry(options: {
  author: string;
  stance: Stance;
  confidence: number;
  round?: number;
  turn?: number;
  entryId?: string;
}): ProtocolEntry {
  return {
    metadata: {
      entryId: options.entryId ?? `entry-${options.author}-${options.round ?? 1}`,
      turn: options.turn ?? 1,
      round: options.round ?? 1,
    },
    timestamp: '2026-02-18T10:00:00Z',
    author: options.author,
    status: 'yield',
    fields: {
      stance: options.stance,
      confidence: options.confidence,
      summary: 'Test summary',
      actionRequested: 'n/a',
      evidence: 'n/a',
    },
    body: 'Test body',
    hasYield: true,
  };
}

// ─── getLatestEntriesPerAgent ────────────────────────────────────────

describe('getLatestEntriesPerAgent', () => {
  it('should return the latest entry per agent', () => {
    const entries: ProtocolEntry[] = [
      makeEntry({ author: 'agent-a', stance: 'neutral', confidence: 0.5, round: 1 }),
      makeEntry({ author: 'agent-b', stance: 'approve', confidence: 0.8, round: 1 }),
      makeEntry({ author: 'agent-a', stance: 'approve', confidence: 0.9, round: 1, entryId: 'second-a' }),
    ];

    const latest = getLatestEntriesPerAgent(entries);
    expect(latest.size).toBe(2);
    expect(latest.get('agent-a')?.fields.confidence).toBe(0.9);
    expect(latest.get('agent-b')?.fields.confidence).toBe(0.8);
  });

  it('should filter by round when specified', () => {
    const entries: ProtocolEntry[] = [
      makeEntry({ author: 'agent-a', stance: 'reject', confidence: 0.3, round: 1 }),
      makeEntry({ author: 'agent-a', stance: 'approve', confidence: 0.9, round: 2 }),
      makeEntry({ author: 'agent-b', stance: 'approve', confidence: 0.8, round: 2 }),
    ];

    const round2 = getLatestEntriesPerAgent(entries, 2);
    expect(round2.size).toBe(2);
    expect(round2.get('agent-a')?.fields.stance).toBe('approve');

    const round1 = getLatestEntriesPerAgent(entries, 1);
    expect(round1.size).toBe(1);
    expect(round1.get('agent-a')?.fields.stance).toBe('reject');
  });

  it('should return empty map for empty entries', () => {
    const latest = getLatestEntriesPerAgent([]);
    expect(latest.size).toBe(0);
  });
});

// ─── Majority Consensus ─────────────────────────────────────────────

describe('detectConsensus — majority', () => {
  it('should reach consensus when >50% approve with sufficient confidence', () => {
    const rules = makeRules({
      agents: ['agent-a', 'agent-b', 'agent-c'],
      consensusMode: 'majority',
      consensusThreshold: 0.7,
    });

    const entries: ProtocolEntry[] = [
      makeEntry({ author: 'agent-a', stance: 'approve', confidence: 0.8, round: 1, turn: 1 }),
      makeEntry({ author: 'agent-b', stance: 'approve', confidence: 0.9, round: 1, turn: 2 }),
      makeEntry({ author: 'agent-c', stance: 'reject', confidence: 0.6, round: 1, turn: 3 }),
    ];

    const result = detectConsensus(entries, rules);
    expect(result.outcome).toBe('reached');
    expect(result.round).toBe(1);
    // Average confidence of approvers: (0.8 + 0.9) / 2 = 0.85
    expect(result.score).toBeCloseTo(0.85, 5);
    expect(result.agentStances).toHaveLength(3);
  });

  it('should not reach consensus when <50% approve', () => {
    const rules = makeRules({
      agents: ['agent-a', 'agent-b', 'agent-c'],
      consensusMode: 'majority',
      consensusThreshold: 0.7,
    });

    const entries: ProtocolEntry[] = [
      makeEntry({ author: 'agent-a', stance: 'approve', confidence: 0.9, round: 1, turn: 1 }),
      makeEntry({ author: 'agent-b', stance: 'reject', confidence: 0.8, round: 1, turn: 2 }),
      makeEntry({ author: 'agent-c', stance: 'reject', confidence: 0.7, round: 1, turn: 3 }),
    ];

    const result = detectConsensus(entries, rules);
    expect(result.outcome).toBe('not-reached');
  });

  it('should not reach consensus when average confidence is below threshold', () => {
    const rules = makeRules({
      agents: ['agent-a', 'agent-b', 'agent-c'],
      consensusMode: 'majority',
      consensusThreshold: 0.8,
    });

    const entries: ProtocolEntry[] = [
      makeEntry({ author: 'agent-a', stance: 'approve', confidence: 0.6, round: 1, turn: 1 }),
      makeEntry({ author: 'agent-b', stance: 'approve', confidence: 0.7, round: 1, turn: 2 }),
      makeEntry({ author: 'agent-c', stance: 'neutral', confidence: 0.5, round: 1, turn: 3 }),
    ];

    const result = detectConsensus(entries, rules);
    // Approvers: agent-a(0.6) + agent-b(0.7) = avg 0.65, below threshold 0.8
    expect(result.outcome).toBe('not-reached');
  });

  it('should only consider entries from the latest round', () => {
    const rules = makeRules({
      agents: ['agent-a', 'agent-b'],
      consensusMode: 'majority',
      consensusThreshold: 0.7,
    });

    const entries: ProtocolEntry[] = [
      // Round 1: both reject
      makeEntry({ author: 'agent-a', stance: 'reject', confidence: 0.9, round: 1, turn: 1 }),
      makeEntry({ author: 'agent-b', stance: 'reject', confidence: 0.9, round: 1, turn: 2 }),
      // Round 2: both approve
      makeEntry({ author: 'agent-a', stance: 'approve', confidence: 0.8, round: 2, turn: 1 }),
      makeEntry({ author: 'agent-b', stance: 'approve', confidence: 0.9, round: 2, turn: 2 }),
    ];

    const result = detectConsensus(entries, rules);
    expect(result.outcome).toBe('reached');
    expect(result.round).toBe(2);
  });
});

// ─── Weighted Consensus ─────────────────────────────────────────────

describe('detectConsensus — weighted', () => {
  it('should reach consensus when positive score is above threshold', () => {
    const rules = makeRules({
      agents: ['agent-a', 'agent-b', 'agent-c'],
      consensusMode: 'weighted',
      consensusThreshold: 0.5,
    });

    const entries: ProtocolEntry[] = [
      makeEntry({ author: 'agent-a', stance: 'approve', confidence: 0.9, round: 1, turn: 1 }),
      makeEntry({ author: 'agent-b', stance: 'approve', confidence: 0.8, round: 1, turn: 2 }),
      makeEntry({ author: 'agent-c', stance: 'neutral', confidence: 0.5, round: 1, turn: 3 }),
    ];

    const result = detectConsensus(entries, rules);
    // score = (0.9 + 0.8 + 0) / 3 = 0.5667
    expect(result.outcome).toBe('reached');
    expect(result.score).toBeCloseTo(0.5667, 3);
  });

  it('should not reach consensus with negative score', () => {
    const rules = makeRules({
      agents: ['agent-a', 'agent-b', 'agent-c'],
      consensusMode: 'weighted',
      consensusThreshold: 0.5,
    });

    const entries: ProtocolEntry[] = [
      makeEntry({ author: 'agent-a', stance: 'reject', confidence: 0.9, round: 1, turn: 1 }),
      makeEntry({ author: 'agent-b', stance: 'reject', confidence: 0.8, round: 1, turn: 2 }),
      makeEntry({ author: 'agent-c', stance: 'approve', confidence: 0.3, round: 1, turn: 3 }),
    ];

    const result = detectConsensus(entries, rules);
    // score = (-0.9 + -0.8 + 0.3) / 3 = -0.4667
    expect(result.outcome).toBe('not-reached');
    expect(result.score).toBeLessThan(0);
  });

  it('should handle mixed stances correctly', () => {
    const rules = makeRules({
      agents: ['agent-a', 'agent-b'],
      consensusMode: 'weighted',
      consensusThreshold: 0.3,
    });

    const entries: ProtocolEntry[] = [
      makeEntry({ author: 'agent-a', stance: 'approve', confidence: 0.9, round: 1, turn: 1 }),
      makeEntry({ author: 'agent-b', stance: 'reject', confidence: 0.2, round: 1, turn: 2 }),
    ];

    const result = detectConsensus(entries, rules);
    // score = (0.9 - 0.2) / 2 = 0.35
    expect(result.outcome).toBe('reached');
    expect(result.score).toBeCloseTo(0.35, 5);
  });

  it('should treat neutral stance as contributing zero to score', () => {
    const rules = makeRules({
      agents: ['agent-a', 'agent-b'],
      consensusMode: 'weighted',
      consensusThreshold: 0.4,
    });

    const entries: ProtocolEntry[] = [
      makeEntry({ author: 'agent-a', stance: 'approve', confidence: 0.9, round: 1, turn: 1 }),
      makeEntry({ author: 'agent-b', stance: 'neutral', confidence: 0.9, round: 1, turn: 2 }),
    ];

    const result = detectConsensus(entries, rules);
    // score = (0.9 + 0) / 2 = 0.45
    expect(result.outcome).toBe('reached');
    expect(result.score).toBeCloseTo(0.45, 5);
  });
});

// ─── Unanimous Consensus ────────────────────────────────────────────

describe('detectConsensus — unanimous', () => {
  it('should reach consensus when all agents approve with high confidence', () => {
    const rules = makeRules({
      agents: ['agent-a', 'agent-b', 'agent-c'],
      consensusMode: 'unanimous',
      consensusThreshold: 0.7,
    });

    const entries: ProtocolEntry[] = [
      makeEntry({ author: 'agent-a', stance: 'approve', confidence: 0.8, round: 1, turn: 1 }),
      makeEntry({ author: 'agent-b', stance: 'approve', confidence: 0.9, round: 1, turn: 2 }),
      makeEntry({ author: 'agent-c', stance: 'approve', confidence: 0.75, round: 1, turn: 3 }),
    ];

    const result = detectConsensus(entries, rules);
    expect(result.outcome).toBe('reached');
    // Score should be the minimum confidence: 0.75
    expect(result.score).toBeCloseTo(0.75, 5);
  });

  it('should not reach consensus when one agent rejects', () => {
    const rules = makeRules({
      agents: ['agent-a', 'agent-b', 'agent-c'],
      consensusMode: 'unanimous',
      consensusThreshold: 0.7,
    });

    const entries: ProtocolEntry[] = [
      makeEntry({ author: 'agent-a', stance: 'approve', confidence: 0.9, round: 1, turn: 1 }),
      makeEntry({ author: 'agent-b', stance: 'reject', confidence: 0.8, round: 1, turn: 2 }),
      makeEntry({ author: 'agent-c', stance: 'approve', confidence: 0.85, round: 1, turn: 3 }),
    ];

    const result = detectConsensus(entries, rules);
    expect(result.outcome).toBe('not-reached');
    expect(result.score).toBe(0);
  });

  it('should not reach consensus when confidence is below threshold', () => {
    const rules = makeRules({
      agents: ['agent-a', 'agent-b'],
      consensusMode: 'unanimous',
      consensusThreshold: 0.8,
    });

    const entries: ProtocolEntry[] = [
      makeEntry({ author: 'agent-a', stance: 'approve', confidence: 0.9, round: 1, turn: 1 }),
      makeEntry({ author: 'agent-b', stance: 'approve', confidence: 0.7, round: 1, turn: 2 }),
    ];

    const result = detectConsensus(entries, rules);
    // agent-b has confidence 0.7, below threshold 0.8
    expect(result.outcome).toBe('not-reached');
  });

  it('should reach consensus when all agents meet exact threshold', () => {
    const rules = makeRules({
      agents: ['agent-a', 'agent-b'],
      consensusMode: 'unanimous',
      consensusThreshold: 0.7,
    });

    const entries: ProtocolEntry[] = [
      makeEntry({ author: 'agent-a', stance: 'approve', confidence: 0.7, round: 1, turn: 1 }),
      makeEntry({ author: 'agent-b', stance: 'approve', confidence: 0.7, round: 1, turn: 2 }),
    ];

    const result = detectConsensus(entries, rules);
    expect(result.outcome).toBe('reached');
  });
});

// ─── Defer Handling ─────────────────────────────────────────────────

describe('detectConsensus — defer handling', () => {
  it('should exclude defer agents from consensus calculation', () => {
    const rules = makeRules({
      agents: ['agent-a', 'agent-b', 'agent-c'],
      consensusMode: 'majority',
      consensusThreshold: 0.7,
    });

    const entries: ProtocolEntry[] = [
      makeEntry({ author: 'agent-a', stance: 'approve', confidence: 0.8, round: 1, turn: 1 }),
      makeEntry({ author: 'agent-b', stance: 'defer', confidence: 0.3, round: 1, turn: 2 }),
      makeEntry({ author: 'agent-c', stance: 'reject', confidence: 0.5, round: 1, turn: 3 }),
    ];

    const result = detectConsensus(entries, rules);
    // Active agents: agent-a (approve) and agent-c (reject)
    // 1 approve out of 2 active = 50%, not >50%, so not reached
    expect(result.outcome).toBe('not-reached');
    // All agents should still appear in agentStances
    expect(result.agentStances).toHaveLength(3);
  });

  it('should detect deadlock when all agents defer', () => {
    const rules = makeRules({
      agents: ['agent-a', 'agent-b', 'agent-c'],
      consensusMode: 'majority',
      consensusThreshold: 0.7,
    });

    const entries: ProtocolEntry[] = [
      makeEntry({ author: 'agent-a', stance: 'defer', confidence: 0.3, round: 1, turn: 1 }),
      makeEntry({ author: 'agent-b', stance: 'defer', confidence: 0.2, round: 1, turn: 2 }),
      makeEntry({ author: 'agent-c', stance: 'defer', confidence: 0.1, round: 1, turn: 3 }),
    ];

    const result = detectConsensus(entries, rules);
    expect(result.outcome).toBe('deadlock');
    expect(result.score).toBe(0);
  });

  it('should reach consensus with defer agents excluded in weighted mode', () => {
    const rules = makeRules({
      agents: ['agent-a', 'agent-b', 'agent-c'],
      consensusMode: 'weighted',
      consensusThreshold: 0.5,
    });

    const entries: ProtocolEntry[] = [
      makeEntry({ author: 'agent-a', stance: 'approve', confidence: 0.9, round: 1, turn: 1 }),
      makeEntry({ author: 'agent-b', stance: 'defer', confidence: 0.3, round: 1, turn: 2 }),
      makeEntry({ author: 'agent-c', stance: 'approve', confidence: 0.7, round: 1, turn: 3 }),
    ];

    const result = detectConsensus(entries, rules);
    // Active: agent-a (approve 0.9) and agent-c (approve 0.7)
    // score = (0.9 + 0.7) / 2 = 0.8
    expect(result.outcome).toBe('reached');
    expect(result.score).toBeCloseTo(0.8, 5);
  });

  it('should reach consensus with defer agents excluded in unanimous mode', () => {
    const rules = makeRules({
      agents: ['agent-a', 'agent-b', 'agent-c'],
      consensusMode: 'unanimous',
      consensusThreshold: 0.7,
    });

    const entries: ProtocolEntry[] = [
      makeEntry({ author: 'agent-a', stance: 'approve', confidence: 0.8, round: 1, turn: 1 }),
      makeEntry({ author: 'agent-b', stance: 'defer', confidence: 0.2, round: 1, turn: 2 }),
      makeEntry({ author: 'agent-c', stance: 'approve', confidence: 0.9, round: 1, turn: 3 }),
    ];

    const result = detectConsensus(entries, rules);
    // Active: agent-a (approve 0.8) and agent-c (approve 0.9) -- both above 0.7
    expect(result.outcome).toBe('reached');
  });
});

// ─── Edge Cases ─────────────────────────────────────────────────────

describe('detectConsensus — edge cases', () => {
  it('should handle empty entries array', () => {
    const rules = makeRules({ consensusMode: 'majority' });
    const result = detectConsensus([], rules);
    expect(result.outcome).toBe('not-reached');
    expect(result.score).toBe(0);
    expect(result.round).toBe(0);
  });

  it('should use only the latest entry per agent in the latest round', () => {
    const rules = makeRules({
      agents: ['agent-a', 'agent-b'],
      consensusMode: 'majority',
      consensusThreshold: 0.7,
    });

    const entries: ProtocolEntry[] = [
      // Agent-a first entry: reject
      makeEntry({ author: 'agent-a', stance: 'reject', confidence: 0.9, round: 1, turn: 1, entryId: 'a1' }),
      makeEntry({ author: 'agent-b', stance: 'approve', confidence: 0.8, round: 1, turn: 2, entryId: 'b1' }),
      // Agent-a revised entry in same round: approve
      makeEntry({ author: 'agent-a', stance: 'approve', confidence: 0.85, round: 1, turn: 3, entryId: 'a2' }),
    ];

    const result = detectConsensus(entries, rules);
    // Both agents now approve: agent-a(0.85), agent-b(0.8)
    expect(result.outcome).toBe('reached');
    expect(result.score).toBeCloseTo(0.825, 5);
  });

  it('should handle single agent session', () => {
    const rules = makeRules({
      agents: ['agent-a'],
      consensusMode: 'unanimous',
      consensusThreshold: 0.7,
    });

    const entries: ProtocolEntry[] = [
      makeEntry({ author: 'agent-a', stance: 'approve', confidence: 0.9, round: 1, turn: 1 }),
    ];

    const result = detectConsensus(entries, rules);
    expect(result.outcome).toBe('reached');
  });

  it('should return not-reached when all active agents are neutral in majority mode', () => {
    const rules = makeRules({
      agents: ['agent-a', 'agent-b'],
      consensusMode: 'majority',
      consensusThreshold: 0.5,
    });

    const entries: ProtocolEntry[] = [
      makeEntry({ author: 'agent-a', stance: 'neutral', confidence: 0.5, round: 1, turn: 1 }),
      makeEntry({ author: 'agent-b', stance: 'neutral', confidence: 0.5, round: 1, turn: 2 }),
    ];

    const result = detectConsensus(entries, rules);
    expect(result.outcome).toBe('not-reached');
  });
});
