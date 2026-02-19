/**
 * Turn Coordinator Tests
 *
 * Tests for the TurnCoordinator state machine, covering:
 * - Round-robin turn order
 * - Free-form turn order
 * - Supervised turn order
 * - Timeout handling
 * - Escalation policies
 * - Session lifecycle
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TurnCoordinator } from '@/lib/coordination/turn-coordinator';
import type { TurnCoordinatorOptions, TurnState } from '@/lib/coordination/turn-coordinator';
import type { ProtocolRules, ProtocolEntry } from '@/lib/protocol/types';

// ─── Helpers ─────────────────────────────────────────────────────────

/** Create minimal ProtocolRules with round-robin defaults. */
function makeRules(overrides: Partial<ProtocolRules> = {}): ProtocolRules {
  return {
    agents: ['agent-a', 'agent-b', 'agent-c'],
    turnOrder: 'round-robin',
    maxTurnsPerRound: 1,
    turnTimeout: 300,
    consensusThreshold: 0.7,
    consensusMode: 'majority',
    escalation: 'timeout-skip',
    maxRounds: 3,
    outputFormat: 'structured',
    ...overrides,
  };
}

/** Create a minimal ProtocolEntry for testing. */
function makeEntry(overrides: Partial<ProtocolEntry> & { author: string }): ProtocolEntry {
  return {
    metadata: {
      entryId: 'test-entry-id',
      turn: 1,
      round: 1,
    },
    timestamp: '2026-02-18T10:00:00Z',
    author: overrides.author,
    status: 'yield',
    fields: {},
    body: 'Test body',
    hasYield: true,
    ...overrides,
  };
}

/** Collect state transitions from a TurnCoordinator. */
function collectStateChanges(coordinator: TurnCoordinator): Array<{ from: TurnState; to: TurnState }> {
  const changes: Array<{ from: TurnState; to: TurnState }> = [];
  coordinator.on('state-change', (from: TurnState, to: TurnState) => {
    changes.push({ from, to });
  });
  return changes;
}

// ─── Round-Robin Turn Order ──────────────────────────────────────────

describe('TurnCoordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('round-robin turn order', () => {
    it('should activate agents in order', () => {
      const agentTurns: Array<{ agent: string; round: number; turn: number }> = [];
      const rules = makeRules({ agents: ['agent-a', 'agent-b'] });
      const coordinator = new TurnCoordinator({
        rules,
        onAgentTurn: (agent, round, turn) => agentTurns.push({ agent, round, turn }),
      });

      coordinator.start();
      expect(coordinator.getCurrentAgent()).toBe('agent-a');
      expect(coordinator.getCurrentRound()).toBe(1);
      expect(coordinator.getCurrentTurn()).toBe(1);
      expect(agentTurns).toEqual([{ agent: 'agent-a', round: 1, turn: 1 }]);

      coordinator.recordYield('agent-a');
      expect(coordinator.getCurrentAgent()).toBe('agent-b');
      expect(coordinator.getCurrentTurn()).toBe(2);
      expect(agentTurns).toEqual([
        { agent: 'agent-a', round: 1, turn: 1 },
        { agent: 'agent-b', round: 1, turn: 2 },
      ]);

      coordinator.dispose();
    });

    it('should detect out-of-order entries via isAgentAllowed', () => {
      const rules = makeRules({ agents: ['agent-a', 'agent-b', 'agent-c'] });
      const coordinator = new TurnCoordinator({ rules });

      coordinator.start();
      // Currently agent-a's turn
      expect(coordinator.isAgentAllowed('agent-a')).toBe(true);
      expect(coordinator.isAgentAllowed('agent-b')).toBe(false);
      expect(coordinator.isAgentAllowed('agent-c')).toBe(false);

      coordinator.recordYield('agent-a');
      // Now agent-b's turn
      expect(coordinator.isAgentAllowed('agent-a')).toBe(false);
      expect(coordinator.isAgentAllowed('agent-b')).toBe(true);
      expect(coordinator.isAgentAllowed('agent-c')).toBe(false);

      coordinator.dispose();
    });

    it('should complete a round after all agents yield', () => {
      const roundsCompleted: number[] = [];
      const rules = makeRules({ agents: ['agent-a', 'agent-b'], maxRounds: 5 });
      const coordinator = new TurnCoordinator({
        rules,
        onRoundComplete: (round) => roundsCompleted.push(round),
      });

      coordinator.start();
      coordinator.recordYield('agent-a');
      coordinator.recordYield('agent-b');

      expect(roundsCompleted).toEqual([1]);
      // Should now be in round 2 with agent-a active again
      expect(coordinator.getCurrentRound()).toBe(2);
      expect(coordinator.getCurrentAgent()).toBe('agent-a');

      coordinator.dispose();
    });

    it('should complete session when max-rounds reached', () => {
      let sessionReason: string | null = null;
      const rules = makeRules({ agents: ['agent-a', 'agent-b'], maxRounds: 2 });
      const coordinator = new TurnCoordinator({
        rules,
        onSessionComplete: (reason) => { sessionReason = reason; },
      });

      coordinator.start();

      // Round 1
      coordinator.recordYield('agent-a');
      coordinator.recordYield('agent-b');

      // Round 2
      coordinator.recordYield('agent-a');
      coordinator.recordYield('agent-b');

      expect(coordinator.isComplete()).toBe(true);
      expect(coordinator.getCompletionReason()).toBe('max-rounds-reached');
      expect(sessionReason).toBe('max-rounds-reached');

      coordinator.dispose();
    });
  });

  // ─── Free-Form Turn Order ──────────────────────────────────────────

  describe('free-form turn order', () => {
    it('should allow any agent to contribute', () => {
      const rules = makeRules({
        agents: ['agent-a', 'agent-b', 'agent-c'],
        turnOrder: 'free-form',
      });
      const coordinator = new TurnCoordinator({ rules });

      coordinator.start();

      // In free-form, all agents are allowed
      expect(coordinator.isAgentAllowed('agent-a')).toBe(true);
      expect(coordinator.isAgentAllowed('agent-b')).toBe(true);
      expect(coordinator.isAgentAllowed('agent-c')).toBe(true);

      coordinator.dispose();
    });

    it('should complete round when all agents have contributed', () => {
      const roundsCompleted: number[] = [];
      const rules = makeRules({
        agents: ['agent-a', 'agent-b', 'agent-c'],
        turnOrder: 'free-form',
        maxRounds: 5,
      });
      const coordinator = new TurnCoordinator({
        rules,
        onRoundComplete: (round) => roundsCompleted.push(round),
      });

      coordinator.start();
      // agent-a goes first (auto-selected)
      coordinator.recordEntry(makeEntry({ author: 'agent-a' }));
      coordinator.recordYield('agent-a');

      // agent-b goes next
      coordinator.recordEntry(makeEntry({ author: 'agent-b' }));
      coordinator.recordYield('agent-b');

      // agent-c goes last -- should complete the round
      coordinator.recordEntry(makeEntry({ author: 'agent-c' }));
      coordinator.recordYield('agent-c');

      expect(roundsCompleted).toEqual([1]);
      expect(coordinator.getCurrentRound()).toBe(2);

      coordinator.dispose();
    });

    it('should accept contributions in any order', () => {
      const roundsCompleted: number[] = [];
      const rules = makeRules({
        agents: ['agent-a', 'agent-b', 'agent-c'],
        turnOrder: 'free-form',
        maxRounds: 5,
      });
      const coordinator = new TurnCoordinator({
        rules,
        onRoundComplete: (round) => roundsCompleted.push(round),
      });

      coordinator.start();
      // agent-c contributes first (out of listed order -- that's fine in free-form)
      coordinator.recordEntry(makeEntry({ author: 'agent-c' }));
      coordinator.recordYield('agent-c');

      coordinator.recordEntry(makeEntry({ author: 'agent-a' }));
      coordinator.recordYield('agent-a');

      coordinator.recordEntry(makeEntry({ author: 'agent-b' }));
      coordinator.recordYield('agent-b');

      expect(roundsCompleted).toEqual([1]);

      coordinator.dispose();
    });
  });

  // ─── Supervised Turn Order ─────────────────────────────────────────

  describe('supervised turn order', () => {
    it('should only allow the action_requested agent to go next', () => {
      const rules = makeRules({
        agents: ['lead', 'worker-a', 'worker-b'],
        turnOrder: 'supervised',
      });
      const coordinator = new TurnCoordinator({ rules });

      coordinator.start();
      // First agent (lead) goes first by default
      expect(coordinator.getCurrentAgent()).toBe('lead');
      expect(coordinator.isAgentAllowed('lead')).toBe(true);
      expect(coordinator.isAgentAllowed('worker-a')).toBe(false);

      // Lead requests worker-a to go next
      coordinator.recordEntry(makeEntry({
        author: 'lead',
        fields: {
          stance: 'neutral',
          confidence: 0.5,
          summary: 'Directing worker-a',
          actionRequested: 'worker-a to provide analysis.',
          evidence: 'n/a',
        },
      }));
      coordinator.recordYield('lead');

      expect(coordinator.getCurrentAgent()).toBe('worker-a');
      expect(coordinator.isAgentAllowed('worker-a')).toBe(true);
      expect(coordinator.isAgentAllowed('worker-b')).toBe(false);

      coordinator.dispose();
    });

    it('should complete round when no action_requested is specified', () => {
      const roundsCompleted: number[] = [];
      const rules = makeRules({
        agents: ['lead', 'worker-a'],
        turnOrder: 'supervised',
        maxRounds: 5,
      });
      const coordinator = new TurnCoordinator({
        rules,
        onRoundComplete: (round) => roundsCompleted.push(round),
      });

      coordinator.start();

      // Lead yields without requesting next agent
      coordinator.recordEntry(makeEntry({
        author: 'lead',
        fields: {
          stance: 'approve',
          confidence: 0.8,
          summary: 'Done',
          actionRequested: 'n/a',
          evidence: 'n/a',
        },
      }));
      coordinator.recordYield('lead');

      expect(roundsCompleted).toEqual([1]);

      coordinator.dispose();
    });
  });

  // ─── Timeout Handling ──────────────────────────────────────────────

  describe('timeout handling', () => {
    it('should trigger timeout after configured delay', () => {
      const timeouts: string[] = [];
      const rules = makeRules({
        agents: ['agent-a', 'agent-b'],
        turnTimeout: 5, // 5 seconds
        escalation: 'timeout-skip',
      });
      const coordinator = new TurnCoordinator({
        rules,
        onTimeout: (agent) => timeouts.push(agent),
      });

      coordinator.start();
      expect(coordinator.getCurrentAgent()).toBe('agent-a');

      // Advance time past the timeout
      vi.advanceTimersByTime(5000);

      expect(timeouts).toEqual(['agent-a']);
      // timeout-skip should advance to next agent
      expect(coordinator.getCurrentAgent()).toBe('agent-b');

      coordinator.dispose();
    });

    it('should not trigger timeout if yield is received before timer', () => {
      const timeouts: string[] = [];
      const rules = makeRules({
        agents: ['agent-a', 'agent-b'],
        turnTimeout: 5,
        escalation: 'timeout-skip',
      });
      const coordinator = new TurnCoordinator({
        rules,
        onTimeout: (agent) => timeouts.push(agent),
      });

      coordinator.start();
      // Yield agent-a before its timeout fires
      vi.advanceTimersByTime(3000);
      coordinator.recordYield('agent-a');

      // Agent-b is now active with a fresh 5s timer.
      // Advance only 2 seconds (still under agent-b's 5s timeout).
      vi.advanceTimersByTime(2000);

      // No timeouts should have fired: agent-a yielded in time,
      // and agent-b's timer has not expired yet.
      expect(timeouts).toEqual([]);

      coordinator.dispose();
    });

    it('should apply timeout-skip escalation and advance to next agent', () => {
      const escalations: string[] = [];
      const rules = makeRules({
        agents: ['agent-a', 'agent-b', 'agent-c'],
        turnTimeout: 2,
        escalation: 'timeout-skip',
      });
      const coordinator = new TurnCoordinator({
        rules,
        onEscalation: (reason) => escalations.push(reason),
      });

      coordinator.start();
      expect(coordinator.getCurrentAgent()).toBe('agent-a');

      // Timeout agent-a
      vi.advanceTimersByTime(2000);
      expect(coordinator.getCurrentAgent()).toBe('agent-b');
      expect(escalations.length).toBe(1);
      expect(escalations[0]).toContain('agent-a');
      expect(escalations[0]).toContain('timeout-skip');

      coordinator.dispose();
    });

    it('should pause on human escalation policy', () => {
      const escalations: string[] = [];
      const rules = makeRules({
        agents: ['agent-a', 'agent-b'],
        turnTimeout: 2,
        escalation: 'human',
      });
      const coordinator = new TurnCoordinator({
        rules,
        onEscalation: (reason) => escalations.push(reason),
      });

      coordinator.start();

      // Timeout agent-a
      vi.advanceTimersByTime(2000);

      // With human escalation, the coordinator stays in 'escalating' state
      expect(coordinator.getState()).toBe('escalating');
      expect(escalations.length).toBe(1);
      expect(escalations[0]).toContain('human');

      coordinator.dispose();
    });
  });

  // ─── Session Lifecycle ─────────────────────────────────────────────

  describe('session lifecycle', () => {
    it('should start in idle state', () => {
      const rules = makeRules();
      const coordinator = new TurnCoordinator({ rules });
      expect(coordinator.getState()).toBe('idle');
      expect(coordinator.getCurrentAgent()).toBeNull();
      expect(coordinator.getCurrentRound()).toBe(0);
      expect(coordinator.getCurrentTurn()).toBe(0);
      expect(coordinator.isComplete()).toBe(false);
      coordinator.dispose();
    });

    it('should throw when starting from non-idle state', () => {
      const rules = makeRules();
      const coordinator = new TurnCoordinator({ rules });

      coordinator.start();
      expect(() => coordinator.start()).toThrow(/Cannot start/);

      coordinator.dispose();
    });

    it('should handle session with no agents gracefully', () => {
      let completedReason: string | null = null;
      const rules = makeRules({ agents: [] });
      const coordinator = new TurnCoordinator({
        rules,
        onSessionComplete: (reason) => { completedReason = reason; },
      });

      coordinator.start();
      expect(coordinator.isComplete()).toBe(true);
      expect(completedReason).toBe('no-agents');

      coordinator.dispose();
    });

    it('should track state transitions via events', () => {
      const rules = makeRules({ agents: ['agent-a', 'agent-b'], maxRounds: 1 });
      const coordinator = new TurnCoordinator({ rules });
      const changes = collectStateChanges(coordinator);

      coordinator.start();
      coordinator.recordYield('agent-a');
      coordinator.recordYield('agent-b');

      // Expect: idle->agent-active, agent-active->yield-received, yield-received->next-agent,
      // next-agent->agent-active, agent-active->yield-received, yield-received->next-agent,
      // next-agent->round-complete, round-complete->session-complete
      expect(changes.length).toBeGreaterThan(0);
      expect(changes[0]).toEqual({ from: 'idle', to: 'agent-active' });
      expect(changes[changes.length - 1].to).toBe('session-complete');

      coordinator.dispose();
    });

    it('should not process yields after session is complete', () => {
      const rules = makeRules({ agents: ['agent-a'], maxRounds: 1 });
      const coordinator = new TurnCoordinator({ rules });

      coordinator.start();
      coordinator.recordYield('agent-a');

      expect(coordinator.isComplete()).toBe(true);

      // Further yields should be silently ignored
      const stateBeforeExtraYield = coordinator.getState();
      coordinator.recordYield('agent-a');
      expect(coordinator.getState()).toBe(stateBeforeExtraYield);

      coordinator.dispose();
    });

    it('should handle forceAdvance correctly', () => {
      const rules = makeRules({ agents: ['agent-a', 'agent-b', 'agent-c'] });
      const coordinator = new TurnCoordinator({ rules });

      coordinator.start();
      expect(coordinator.getCurrentAgent()).toBe('agent-a');

      coordinator.forceAdvance();
      expect(coordinator.getCurrentAgent()).toBe('agent-b');

      coordinator.forceAdvance();
      expect(coordinator.getCurrentAgent()).toBe('agent-c');

      coordinator.dispose();
    });

    it('should run multiple rounds with full round-robin cycle', () => {
      const agentTurns: Array<{ agent: string; round: number }> = [];
      const rules = makeRules({
        agents: ['agent-a', 'agent-b'],
        maxRounds: 3,
      });
      const coordinator = new TurnCoordinator({
        rules,
        onAgentTurn: (agent, round) => agentTurns.push({ agent, round }),
      });

      coordinator.start();

      // Round 1
      coordinator.recordYield('agent-a');
      coordinator.recordYield('agent-b');
      // Round 2
      coordinator.recordYield('agent-a');
      coordinator.recordYield('agent-b');
      // Round 3
      coordinator.recordYield('agent-a');
      coordinator.recordYield('agent-b');

      expect(coordinator.isComplete()).toBe(true);
      expect(agentTurns).toEqual([
        { agent: 'agent-a', round: 1 },
        { agent: 'agent-b', round: 1 },
        { agent: 'agent-a', round: 2 },
        { agent: 'agent-b', round: 2 },
        { agent: 'agent-a', round: 3 },
        { agent: 'agent-b', round: 3 },
      ]);

      coordinator.dispose();
    });
  });
});
