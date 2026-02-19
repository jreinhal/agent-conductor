import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { validateSession } from '@/lib/protocol/validator';
import { parseSession } from '@/lib/protocol/parser';
import { ValidationCodes } from '@/lib/protocol/types';
import type { BounceSession, ProtocolEntry, ProtocolRules } from '@/lib/protocol/types';

const FIXTURES = join(__dirname, '..', 'fixtures', 'protocol');

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf-8');
}

/**
 * Helper: build a minimal valid session for test manipulation.
 */
function makeValidSession(): Partial<BounceSession> {
  return {
    header: {
      protocolVersion: '0.1',
      created: '2026-02-18T10:00:00Z',
      sessionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    },
    title: 'Test Session',
    rules: {
      agents: ['agent-a', 'agent-b'],
      turnOrder: 'round-robin',
      maxTurnsPerRound: 1,
      turnTimeout: 300,
      consensusThreshold: 0.7,
      consensusMode: 'majority',
      escalation: 'human',
      maxRounds: 5,
      outputFormat: 'structured',
    },
    context: 'Some test context.',
    entries: [],
  };
}

function makeEntry(overrides: Partial<ProtocolEntry> = {}): ProtocolEntry {
  return {
    metadata: {
      entryId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      turn: 1,
      round: 1,
    },
    timestamp: '2026-02-18T10:01:00Z',
    author: 'agent-a',
    status: 'yield',
    fields: {
      stance: 'approve',
      confidence: 0.8,
      summary: 'Looks good.',
      actionRequested: 'n/a',
      evidence: 'n/a',
    },
    body: 'Test body.',
    hasYield: true,
    ...overrides,
  };
}

describe('validateSession', () => {
  // ── Valid session passes ───────────────────────────────────────────

  describe('valid session', () => {
    it('should pass with no issues for a minimal valid session', () => {
      const result = validateSession(makeValidSession());
      expect(result.valid).toBe(true);
      const errors = result.issues.filter((i) => i.severity === 'error');
      expect(errors).toHaveLength(0);
    });

    it('should pass validation on a parsed valid fixture', () => {
      const parsed = parseSession(loadFixture('valid-two-agent-debate.md'));
      const result = validateSession(parsed.session!);
      expect(result.valid).toBe(true);
    });

    it('should pass validation on a parsed minimal fixture', () => {
      const parsed = parseSession(loadFixture('valid-minimal.md'));
      const result = validateSession(parsed.session!);
      expect(result.valid).toBe(true);
    });
  });

  // ── Missing required rule fields ──────────────────────────────────

  describe('missing required rule fields', () => {
    it('should produce error for each missing rule', () => {
      const session = makeValidSession();
      session.rules = { agents: ['agent-a'] } as ProtocolRules;

      const result = validateSession(session);
      expect(result.valid).toBe(false);

      const missingRuleIssues = result.issues.filter(
        (i) => i.code === ValidationCodes.MISSING_REQUIRED_RULE,
      );
      // Should be missing: turnOrder, maxTurnsPerRound, turnTimeout,
      // consensusThreshold, consensusMode, escalation, maxRounds, outputFormat
      expect(missingRuleIssues.length).toBe(8);
    });

    it('should produce error when rules section is entirely missing', () => {
      const session = makeValidSession();
      delete session.rules;

      const result = validateSession(session);
      expect(result.valid).toBe(false);
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain(ValidationCodes.MISSING_RULES_SECTION);
    });
  });

  // ── Duplicate agent names ─────────────────────────────────────────

  describe('duplicate agent names', () => {
    it('should produce DUPLICATE_AGENT_NAME error', () => {
      const session = makeValidSession();
      session.rules!.agents = ['agent-a', 'agent-b', 'agent-a'];

      const result = validateSession(session);
      expect(result.valid).toBe(false);
      const dupIssues = result.issues.filter(
        (i) => i.code === ValidationCodes.DUPLICATE_AGENT_NAME,
      );
      expect(dupIssues.length).toBe(1);
      expect(dupIssues[0].message).toContain('agent-a');
    });
  });

  // ── Duplicate entry IDs ───────────────────────────────────────────

  describe('duplicate entry IDs', () => {
    it('should produce DUPLICATE_ENTRY_ID error', () => {
      const session = makeValidSession();
      const entry1 = makeEntry();
      const entry2 = makeEntry({
        metadata: { entryId: entry1.metadata.entryId, turn: 2, round: 1 },
        author: 'agent-b',
      });
      session.entries = [entry1, entry2];

      const result = validateSession(session);
      expect(result.valid).toBe(false);
      const dupIssues = result.issues.filter(
        (i) => i.code === ValidationCodes.DUPLICATE_ENTRY_ID,
      );
      expect(dupIssues.length).toBe(1);
    });

    it('should also detect duplicates from a parsed fixture', () => {
      const parsed = parseSession(loadFixture('invalid-duplicate-entry-id.md'));
      const result = validateSession(parsed.session!);
      const dupIssues = result.issues.filter(
        (i) => i.code === ValidationCodes.DUPLICATE_ENTRY_ID,
      );
      expect(dupIssues.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Confidence out of range ───────────────────────────────────────

  describe('confidence out of range', () => {
    it('should produce error for confidence > 1.0', () => {
      const session = makeValidSession();
      session.entries = [
        makeEntry({
          fields: {
            stance: 'approve',
            confidence: 1.5,
            summary: 'test',
            actionRequested: 'n/a',
            evidence: 'n/a',
          },
        }),
      ];

      const result = validateSession(session);
      expect(result.valid).toBe(false);
      const confIssues = result.issues.filter(
        (i) => i.code === ValidationCodes.CONFIDENCE_OUT_OF_RANGE,
      );
      expect(confIssues.length).toBe(1);
    });

    it('should produce error for confidence < 0', () => {
      const session = makeValidSession();
      session.entries = [
        makeEntry({
          fields: {
            stance: 'approve',
            confidence: -0.5,
            summary: 'test',
            actionRequested: 'n/a',
            evidence: 'n/a',
          },
        }),
      ];

      const result = validateSession(session);
      expect(result.valid).toBe(false);
      const confIssues = result.issues.filter(
        (i) => i.code === ValidationCodes.CONFIDENCE_OUT_OF_RANGE,
      );
      expect(confIssues.length).toBe(1);
    });
  });

  // ── Invalid stance values ─────────────────────────────────────────

  describe('invalid stance values', () => {
    it('should produce INVALID_STANCE error for non-enum value', () => {
      const session = makeValidSession();
      session.entries = [
        makeEntry({
          fields: {
            stance: 'maybe' as any,
            confidence: 0.8,
            summary: 'test',
            actionRequested: 'n/a',
            evidence: 'n/a',
          },
        }),
      ];

      const result = validateSession(session);
      expect(result.valid).toBe(false);
      const stanceIssues = result.issues.filter(
        (i) => i.code === ValidationCodes.INVALID_STANCE,
      );
      expect(stanceIssues.length).toBe(1);
    });

    it('should produce INVALID_STANCE for strongly-agree', () => {
      const session = makeValidSession();
      session.entries = [
        makeEntry({
          fields: {
            stance: 'strongly-agree' as any,
            confidence: 0.9,
            summary: 'test',
            actionRequested: 'n/a',
            evidence: 'n/a',
          },
        }),
      ];

      const result = validateSession(session);
      const stanceIssues = result.issues.filter(
        (i) => i.code === ValidationCodes.INVALID_STANCE,
      );
      expect(stanceIssues.length).toBe(1);
    });
  });

  // ── Non-monotonic round numbers ───────────────────────────────────

  describe('non-monotonic round numbers', () => {
    it('should produce ROUND_NOT_MONOTONIC warning', () => {
      const session = makeValidSession();
      session.entries = [
        makeEntry({
          metadata: { entryId: '11111111-2222-3333-4444-555555555555', turn: 1, round: 2 },
        }),
        makeEntry({
          metadata: { entryId: '22222222-3333-4444-5555-666666666666', turn: 1, round: 1 },
          author: 'agent-b',
        }),
      ];

      const result = validateSession(session);
      const roundIssues = result.issues.filter(
        (i) => i.code === ValidationCodes.ROUND_NOT_MONOTONIC,
      );
      expect(roundIssues.length).toBe(1);
      expect(roundIssues[0].severity).toBe('warning');
    });
  });

  // ── Missing yield markers ─────────────────────────────────────────

  describe('missing yield markers', () => {
    it('should produce MISSING_YIELD_MARKER warning', () => {
      const session = makeValidSession();
      session.entries = [makeEntry({ hasYield: false })];

      const result = validateSession(session);
      const yieldIssues = result.issues.filter(
        (i) => i.code === ValidationCodes.MISSING_YIELD_MARKER,
      );
      expect(yieldIssues.length).toBe(1);
      expect(yieldIssues[0].severity).toBe('warning');
    });
  });

  // ── Unknown agent in entry ────────────────────────────────────────

  describe('unknown agent in entry', () => {
    it('should produce UNKNOWN_AGENT error when author not in agents list', () => {
      const session = makeValidSession();
      session.entries = [
        makeEntry({ author: 'rogue-agent' }),
      ];

      const result = validateSession(session);
      expect(result.valid).toBe(false);
      const agentIssues = result.issues.filter(
        (i) => i.code === ValidationCodes.UNKNOWN_AGENT,
      );
      expect(agentIssues.length).toBe(1);
      expect(agentIssues[0].message).toContain('rogue-agent');
    });
  });

  // ── Missing required structured fields ────────────────────────────

  describe('missing required structured fields (structured format)', () => {
    it('should produce MISSING_REQUIRED_FIELD errors when fields are missing', () => {
      const session = makeValidSession();
      session.rules!.outputFormat = 'structured';
      session.entries = [
        makeEntry({
          fields: {
            // Only stance provided, rest missing
            stance: 'approve',
          },
        }),
      ];

      const result = validateSession(session);
      expect(result.valid).toBe(false);
      const fieldIssues = result.issues.filter(
        (i) => i.code === ValidationCodes.MISSING_REQUIRED_FIELD,
      );
      // Should be missing: confidence, summary, action_requested, evidence
      expect(fieldIssues.length).toBe(4);
    });

    it('should NOT produce missing field errors when format is free-text', () => {
      const session = makeValidSession();
      session.rules!.outputFormat = 'free-text';
      session.entries = [
        makeEntry({
          fields: {},
        }),
      ];

      const result = validateSession(session);
      const fieldIssues = result.issues.filter(
        (i) => i.code === ValidationCodes.MISSING_REQUIRED_FIELD,
      );
      expect(fieldIssues.length).toBe(0);
    });
  });

  // ── Missing header fields ─────────────────────────────────────────

  describe('missing header', () => {
    it('should produce errors when header is undefined', () => {
      const session = makeValidSession();
      delete session.header;

      const result = validateSession(session);
      expect(result.valid).toBe(false);
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain(ValidationCodes.MISSING_PROTOCOL_VERSION);
      expect(codes).toContain(ValidationCodes.MISSING_CREATED);
      expect(codes).toContain(ValidationCodes.MISSING_SESSION_ID);
    });
  });

  // ── Missing title ─────────────────────────────────────────────────

  describe('missing title', () => {
    it('should produce MISSING_TITLE error', () => {
      const session = makeValidSession();
      delete session.title;

      const result = validateSession(session);
      expect(result.valid).toBe(false);
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain(ValidationCodes.MISSING_TITLE);
    });

    it('should produce EMPTY_TITLE error for empty string', () => {
      const session = makeValidSession();
      session.title = '';

      const result = validateSession(session);
      expect(result.valid).toBe(false);
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain(ValidationCodes.EMPTY_TITLE);
    });
  });

  // ── Missing context ───────────────────────────────────────────────

  describe('missing context', () => {
    it('should produce MISSING_CONTEXT_SECTION error', () => {
      const session = makeValidSession();
      delete session.context;

      const result = validateSession(session);
      expect(result.valid).toBe(false);
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain(ValidationCodes.MISSING_CONTEXT_SECTION);
    });
  });

  // ── Empty agents list ─────────────────────────────────────────────

  describe('empty agents list', () => {
    it('should produce EMPTY_AGENTS_LIST error', () => {
      const session = makeValidSession();
      session.rules!.agents = [];

      const result = validateSession(session);
      expect(result.valid).toBe(false);
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain(ValidationCodes.EMPTY_AGENTS_LIST);
    });
  });

  // ── Round-robin order enforcement ─────────────────────────────────

  describe('round-robin turn order enforcement', () => {
    it('should produce OUT_OF_ORDER_TURN warning for wrong order', () => {
      const session = makeValidSession();
      session.rules!.turnOrder = 'round-robin';
      session.rules!.agents = ['agent-a', 'agent-b'];
      session.entries = [
        makeEntry({
          metadata: { entryId: '11111111-2222-3333-4444-555555555555', turn: 1, round: 1 },
          author: 'agent-b', // should be agent-a first
        }),
        makeEntry({
          metadata: { entryId: '22222222-3333-4444-5555-666666666666', turn: 2, round: 1 },
          author: 'agent-a', // should be agent-b second
        }),
      ];

      const result = validateSession(session);
      const orderIssues = result.issues.filter(
        (i) => i.code === ValidationCodes.OUT_OF_ORDER_TURN,
      );
      expect(orderIssues.length).toBeGreaterThanOrEqual(1);
      expect(orderIssues[0].severity).toBe('warning');
    });

    it('should NOT check turn order for free-form mode', () => {
      const session = makeValidSession();
      session.rules!.turnOrder = 'free-form';
      session.rules!.agents = ['agent-a', 'agent-b'];
      session.entries = [
        makeEntry({
          metadata: { entryId: '11111111-2222-3333-4444-555555555555', turn: 1, round: 1 },
          author: 'agent-b',
        }),
      ];

      const result = validateSession(session);
      const orderIssues = result.issues.filter(
        (i) => i.code === ValidationCodes.OUT_OF_ORDER_TURN,
      );
      expect(orderIssues.length).toBe(0);
    });
  });

  // ── Invalid session ID format ─────────────────────────────────────

  describe('invalid session ID format', () => {
    it('should produce INVALID_SESSION_ID_FORMAT for non-UUID', () => {
      const session = makeValidSession();
      session.header!.sessionId = 'not-a-uuid';

      const result = validateSession(session);
      expect(result.valid).toBe(false);
      const codes = result.issues.map((i) => i.code);
      expect(codes).toContain(ValidationCodes.INVALID_SESSION_ID_FORMAT);
    });
  });
});
