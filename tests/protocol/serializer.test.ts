import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  createSession,
  serializeEntry,
  appendEntry,
  type CreateSessionOptions,
} from '@/lib/protocol/serializer';
import { parseSession } from '@/lib/protocol/parser';
import type { ProtocolEntry, ProtocolRules } from '@/lib/protocol/types';

// ─── Fixtures ────────────────────────────────────────────────────────

const DEFAULT_RULES: ProtocolRules = {
  agents: ['agent-alpha', 'agent-beta'],
  turnOrder: 'round-robin',
  maxTurnsPerRound: 1,
  turnTimeout: 300,
  consensusThreshold: 0.7,
  consensusMode: 'majority',
  escalation: 'human',
  maxRounds: 5,
  outputFormat: 'structured',
};

function makeEntry(overrides?: Partial<Omit<ProtocolEntry, 'hasYield'>>): Omit<ProtocolEntry, 'hasYield'> {
  return {
    metadata: {
      entryId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      turn: 1,
      round: 1,
    },
    timestamp: '2026-02-18T10:01:30Z',
    author: 'agent-alpha',
    status: 'yield',
    fields: {
      stance: 'approve',
      confidence: 0.85,
      summary: 'Test summary for entry.',
      actionRequested: 'n/a',
      evidence: 'n/a',
    },
    body: 'This is the body of the entry.\n\nIt has multiple paragraphs.',
    ...overrides,
  };
}

// ─── Temp directory management ───────────────────────────────────────

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'bounce-serializer-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ─── createSession ───────────────────────────────────────────────────

describe('createSession', () => {
  it('should produce valid parseable markdown', () => {
    const md = createSession({
      sessionName: 'Test Session',
      rules: DEFAULT_RULES,
      context: 'This is the context for the test session.',
      sessionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      created: '2026-02-18T10:00:00Z',
    });

    const result = parseSession(md);

    expect(result.validation.valid).toBe(true);
    expect(result.session).not.toBeNull();
    expect(result.session?.header?.protocolVersion).toBe('0.1');
    expect(result.session?.header?.sessionId).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    expect(result.session?.header?.created).toBe('2026-02-18T10:00:00Z');
    expect(result.session?.title).toBe('Test Session');
    expect(result.session?.entries).toEqual([]);
  });

  it('should generate UUID and timestamp when not provided', () => {
    const md = createSession({
      sessionName: 'Auto-generated IDs',
      rules: DEFAULT_RULES,
      context: 'Testing auto-generation.',
    });

    const result = parseSession(md);
    expect(result.validation.valid).toBe(true);
    expect(result.session?.header?.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(result.session?.header?.created).toBeTruthy();
  });

  it('should serialize all protocol rules correctly', () => {
    const md = createSession({
      sessionName: 'Rules Test',
      rules: DEFAULT_RULES,
      context: 'Context.',
      sessionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      created: '2026-02-18T10:00:00Z',
    });

    const result = parseSession(md);
    const rules = result.session?.rules;

    expect(rules?.agents).toEqual(['agent-alpha', 'agent-beta']);
    expect(rules?.turnOrder).toBe('round-robin');
    expect(rules?.maxTurnsPerRound).toBe(1);
    expect(rules?.turnTimeout).toBe(300);
    expect(rules?.consensusThreshold).toBe(0.7);
    expect(rules?.consensusMode).toBe('majority');
    expect(rules?.escalation).toBe('human');
    expect(rules?.maxRounds).toBe(5);
    expect(rules?.outputFormat).toBe('structured');
  });

  it('should include context section', () => {
    const md = createSession({
      sessionName: 'Context Test',
      rules: DEFAULT_RULES,
      context: 'Review the authentication module for vulnerabilities.',
      sessionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      created: '2026-02-18T10:00:00Z',
    });

    const result = parseSession(md);
    expect(result.session?.context).toContain('Review the authentication module');
  });

  it('should include the ## Dialogue heading', () => {
    const md = createSession({
      sessionName: 'Dialogue Section Test',
      rules: DEFAULT_RULES,
      context: 'Context.',
    });

    expect(md).toContain('## Dialogue');
  });

  it('should handle different rule configurations', () => {
    const customRules: ProtocolRules = {
      agents: ['lead', 'dev', 'reviewer'],
      turnOrder: 'supervised',
      maxTurnsPerRound: 2,
      turnTimeout: 600,
      consensusThreshold: 0.9,
      consensusMode: 'unanimous',
      escalation: 'timeout-skip',
      maxRounds: 10,
      outputFormat: 'free-text',
    };

    const md = createSession({
      sessionName: 'Custom Rules',
      rules: customRules,
      context: 'Custom config test.',
      sessionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      created: '2026-02-18T10:00:00Z',
    });

    const result = parseSession(md);
    expect(result.validation.valid).toBe(true);
    expect(result.session?.rules?.agents).toEqual(['lead', 'dev', 'reviewer']);
    expect(result.session?.rules?.turnOrder).toBe('supervised');
    expect(result.session?.rules?.maxTurnsPerRound).toBe(2);
    expect(result.session?.rules?.consensusMode).toBe('unanimous');
    expect(result.session?.rules?.escalation).toBe('timeout-skip');
    expect(result.session?.rules?.outputFormat).toBe('free-text');
  });
});

// ─── serializeEntry ──────────────────────────────────────────────────

describe('serializeEntry', () => {
  it('should produce correct format with all fields', () => {
    const entry = makeEntry();
    const text = serializeEntry(entry);

    expect(text).toContain('<!-- entry: f47ac10b-58cc-4372-a567-0e02b2c3d479 -->');
    expect(text).toContain('<!-- turn: 1 round: 1 -->');
    expect(text).toContain('2026-02-18T10:01:30Z [author: agent-alpha] [status: yield]');
    expect(text).toContain('stance: approve');
    expect(text).toContain('confidence: 0.85');
    expect(text).toContain('summary: Test summary for entry.');
    expect(text).toContain('action_requested: n/a');
    expect(text).toContain('evidence: n/a');
    expect(text).toContain('This is the body of the entry.');
    expect(text).toContain('<!-- yield -->');
  });

  it('should generate entry UUID when empty', () => {
    const entry = makeEntry({
      metadata: { entryId: '', turn: 1, round: 1 },
    });
    const text = serializeEntry(entry);

    // Should have an entry comment with a valid UUID (not empty)
    const match = text.match(/<!-- entry: ([0-9a-f-]+) -->/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(match![1]).not.toBe('');
  });

  it('should generate timestamp when empty', () => {
    const entry = makeEntry({ timestamp: '' });
    const text = serializeEntry(entry);

    // Timestamp should be a valid ISO-8601 string (not empty)
    const statusLineMatch = text.match(/^(\S+)\s+\[author:/m);
    expect(statusLineMatch).not.toBeNull();
    // Verify it's a valid date
    const ts = statusLineMatch![1];
    expect(new Date(ts).toISOString()).toBeTruthy();
  });

  it('should handle free-text format entries (no structured fields)', () => {
    const entry = makeEntry({
      fields: {},
      body: 'Just a free-form response without any structured fields.',
    });
    const text = serializeEntry(entry);

    expect(text).toContain('<!-- entry:');
    expect(text).toContain('<!-- turn:');
    expect(text).toContain('[author: agent-alpha]');
    expect(text).not.toContain('stance:');
    expect(text).not.toContain('confidence:');
    expect(text).not.toContain('summary:');
    expect(text).toContain('Just a free-form response');
    expect(text).toContain('<!-- yield -->');
  });

  it('should handle partial structured fields', () => {
    const entry = makeEntry({
      fields: {
        stance: 'neutral',
        confidence: 0.5,
      },
    });
    const text = serializeEntry(entry);

    expect(text).toContain('stance: neutral');
    expect(text).toContain('confidence: 0.5');
    expect(text).not.toContain('summary:');
    expect(text).not.toContain('action_requested:');
    expect(text).not.toContain('evidence:');
  });

  it('should handle entry with no body', () => {
    const entry = makeEntry({ body: '' });
    const text = serializeEntry(entry);

    // Should still have yield marker
    expect(text).toContain('<!-- yield -->');
    // Should have fields
    expect(text).toContain('stance: approve');
  });

  it('should handle different status values', () => {
    for (const status of ['open', 'in_progress', 'closed', 'yield'] as const) {
      const entry = makeEntry({ status });
      const text = serializeEntry(entry);
      expect(text).toContain(`[status: ${status}]`);
    }
  });
});

// ─── appendEntry ─────────────────────────────────────────────────────

describe('appendEntry', () => {
  it('should append entry to end of file without modifying existing content', async () => {
    const sessionPath = join(tempDir, 'session.md');

    // Create initial session file
    const initialContent = createSession({
      sessionName: 'Append Test',
      rules: DEFAULT_RULES,
      context: 'Testing append functionality.',
      sessionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      created: '2026-02-18T10:00:00Z',
    });

    await writeFile(sessionPath, initialContent, 'utf-8');

    // Capture content before append
    const before = await readFile(sessionPath, 'utf-8');

    // Append an entry
    const entry = makeEntry();
    await appendEntry(sessionPath, entry);

    // Read updated content
    const after = await readFile(sessionPath, 'utf-8');

    // Original content should be preserved at the start
    expect(after.startsWith(before.trimEnd())).toBe(true);

    // New content should be at the end
    expect(after).toContain('<!-- entry: f47ac10b-58cc-4372-a567-0e02b2c3d479 -->');
    expect(after).toContain('<!-- yield -->');
  });

  it('should append multiple entries sequentially', async () => {
    const sessionPath = join(tempDir, 'multi-session.md');

    const initialContent = createSession({
      sessionName: 'Multi Append',
      rules: DEFAULT_RULES,
      context: 'Testing multiple appends.',
      sessionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      created: '2026-02-18T10:00:00Z',
    });

    await writeFile(sessionPath, initialContent, 'utf-8');

    // Append two entries
    const entry1 = makeEntry({
      metadata: { entryId: '11111111-1111-1111-1111-111111111111', turn: 1, round: 1 },
      author: 'agent-alpha',
      body: 'First entry body.',
    });
    const entry2 = makeEntry({
      metadata: { entryId: '22222222-2222-2222-2222-222222222222', turn: 2, round: 1 },
      author: 'agent-beta',
      body: 'Second entry body.',
    });

    await appendEntry(sessionPath, entry1);
    await appendEntry(sessionPath, entry2);

    const content = await readFile(sessionPath, 'utf-8');

    // Both entries should be present
    expect(content).toContain('11111111-1111-1111-1111-111111111111');
    expect(content).toContain('22222222-2222-2222-2222-222222222222');

    // First entry should appear before second
    const idx1 = content.indexOf('11111111-1111-1111-1111-111111111111');
    const idx2 = content.indexOf('22222222-2222-2222-2222-222222222222');
    expect(idx1).toBeLessThan(idx2);
  });
});

// ─── Round-trip ──────────────────────────────────────────────────────

describe('round-trip: create -> append -> parse', () => {
  it('should produce a valid parseable session with entries', async () => {
    const sessionPath = join(tempDir, 'roundtrip.md');

    // 1. Create session
    const initialContent = createSession({
      sessionName: 'Round-Trip Test',
      rules: DEFAULT_RULES,
      context: 'Testing full round-trip: create, append, parse.',
      sessionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      created: '2026-02-18T10:00:00Z',
    });

    await writeFile(sessionPath, initialContent, 'utf-8');

    // 2. Append entries
    const entry1 = makeEntry({
      metadata: { entryId: 'c3d4e5f6-a7b8-9012-cdef-123456789012', turn: 1, round: 1 },
      author: 'agent-alpha',
      status: 'yield',
      fields: {
        stance: 'approve',
        confidence: 0.7,
        summary: 'Recommends approach A.',
        actionRequested: 'agent-beta to review.',
        evidence: 'docs/spec.md',
      },
      body: 'I recommend approach A for the following reasons.',
    });

    const entry2 = makeEntry({
      metadata: { entryId: 'd4e5f6a7-b8c9-0123-def0-234567890123', turn: 2, round: 1 },
      author: 'agent-beta',
      status: 'yield',
      fields: {
        stance: 'neutral',
        confidence: 0.5,
        summary: 'Needs more information.',
        actionRequested: 'agent-alpha to provide evidence.',
        evidence: 'n/a',
      },
      body: 'I need more data before I can agree.',
    });

    await appendEntry(sessionPath, entry1);
    await appendEntry(sessionPath, entry2);

    // 3. Parse the result
    const content = await readFile(sessionPath, 'utf-8');
    const result = parseSession(content);

    // 4. Verify structure
    expect(result.validation.valid).toBe(true);
    expect(result.session?.header?.protocolVersion).toBe('0.1');
    expect(result.session?.header?.sessionId).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    expect(result.session?.title).toBe('Round-Trip Test');
    expect(result.session?.rules?.agents).toEqual(['agent-alpha', 'agent-beta']);

    // Verify entries
    expect(result.session?.entries).toHaveLength(2);

    const e1 = result.session?.entries?.[0];
    expect(e1?.metadata.entryId).toBe('c3d4e5f6-a7b8-9012-cdef-123456789012');
    expect(e1?.metadata.turn).toBe(1);
    expect(e1?.metadata.round).toBe(1);
    expect(e1?.author).toBe('agent-alpha');
    expect(e1?.status).toBe('yield');
    expect(e1?.fields.stance).toBe('approve');
    expect(e1?.fields.confidence).toBe(0.7);
    expect(e1?.fields.summary).toBe('Recommends approach A.');
    expect(e1?.fields.actionRequested).toBe('agent-beta to review.');
    expect(e1?.fields.evidence).toBe('docs/spec.md');
    expect(e1?.body).toContain('I recommend approach A');
    expect(e1?.hasYield).toBe(true);

    const e2 = result.session?.entries?.[1];
    expect(e2?.metadata.entryId).toBe('d4e5f6a7-b8c9-0123-def0-234567890123');
    expect(e2?.metadata.turn).toBe(2);
    expect(e2?.metadata.round).toBe(1);
    expect(e2?.author).toBe('agent-beta');
    expect(e2?.fields.stance).toBe('neutral');
    expect(e2?.fields.confidence).toBe(0.5);
    expect(e2?.hasYield).toBe(true);
  });

  it('should handle free-text entries in round-trip', async () => {
    const sessionPath = join(tempDir, 'roundtrip-freetext.md');

    const freeTextRules: ProtocolRules = {
      ...DEFAULT_RULES,
      outputFormat: 'free-text',
    };

    const initialContent = createSession({
      sessionName: 'Free-Text Round-Trip',
      rules: freeTextRules,
      context: 'Testing free-text entries.',
      sessionId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
      created: '2026-02-18T11:00:00Z',
    });

    await writeFile(sessionPath, initialContent, 'utf-8');

    const entry = makeEntry({
      metadata: { entryId: 'e5f6a7b8-c9d0-1234-ef01-345678901234', turn: 1, round: 1 },
      author: 'agent-alpha',
      status: 'yield',
      fields: {},
      body: 'This is a free-text entry with no structured fields.\n\nJust markdown content.',
    });

    await appendEntry(sessionPath, entry);

    const content = await readFile(sessionPath, 'utf-8');
    const result = parseSession(content);

    expect(result.session?.entries).toHaveLength(1);
    const e = result.session?.entries?.[0];
    expect(e?.metadata.entryId).toBe('e5f6a7b8-c9d0-1234-ef01-345678901234');
    expect(e?.body).toContain('free-text entry with no structured fields');
    expect(e?.hasYield).toBe(true);
  });
});
