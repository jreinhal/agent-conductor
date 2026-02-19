/**
 * Bounce Protocol v0.1 — Append-Only Serializer
 *
 * Produces valid Bounce Protocol markdown from structured data.
 * Strictly append-only: existing file content is NEVER rewritten.
 *
 * Three entry points:
 * - `createSession()` — generates a complete new session file.
 * - `serializeEntry()` — renders a single entry to a markdown string.
 * - `appendEntry()` — reads an existing file and appends a serialized entry.
 *
 * @see docs/protocol/bounce-v0.1.md
 */

import { readFile, writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import type {
  EntryStatus,
  ProtocolEntry,
  ProtocolRules,
} from './types';
import { withFileLock } from './lock';

// ─── Types ───────────────────────────────────────────────────────────

/** Options for creating a new session file. */
export interface CreateSessionOptions {
  /** Human-readable session name (appears in the title). */
  sessionName: string;
  /** Protocol rules configuration. */
  rules: ProtocolRules;
  /** Free-form markdown context for the session. */
  context: string;
  /** Session UUID v4. Auto-generated if omitted. */
  sessionId?: string;
  /** ISO-8601 creation timestamp. Auto-generated if omitted. */
  created?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────

/** Generate an ISO-8601 UTC timestamp. */
function isoNow(): string {
  return new Date().toISOString();
}

/** Map a camelCase ProtocolRules key to the kebab-case YAML key. */
function rulesKeyToYaml(key: string): string {
  const map: Record<string, string> = {
    turnOrder: 'turn-order',
    maxTurnsPerRound: 'max-turns-per-round',
    turnTimeout: 'turn-timeout',
    consensusThreshold: 'consensus-threshold',
    consensusMode: 'consensus-mode',
    escalation: 'escalation',
    maxRounds: 'max-rounds',
    outputFormat: 'output-format',
  };
  return map[key] ?? key;
}

// ─── Session Creation ────────────────────────────────────────────────

/**
 * Create a complete new Bounce Protocol session file as a markdown string.
 *
 * The output conforms to the v0.1 file format specification:
 * header comments, title, Protocol Rules (YAML code block), Context, and
 * an empty Dialogue section ready for entries to be appended.
 */
export function createSession(options: CreateSessionOptions): string {
  const sessionId = options.sessionId ?? randomUUID();
  const created = options.created ?? isoNow();

  const lines: string[] = [];

  // ── Header comments ────────────────────────────────────────────
  lines.push(`<!-- bounce-protocol: 0.1 -->`);
  lines.push(`<!-- created: ${created} -->`);
  lines.push(`<!-- session-id: ${sessionId} -->`);
  lines.push('');

  // ── Title ──────────────────────────────────────────────────────
  lines.push(`# Bounce Session: ${options.sessionName}`);
  lines.push('');

  // ── Protocol Rules ─────────────────────────────────────────────
  lines.push('## Protocol Rules');
  lines.push('');
  lines.push('```yaml');
  lines.push(serializeRules(options.rules));
  lines.push('```');
  lines.push('');

  // ── Context ────────────────────────────────────────────────────
  lines.push('## Context');
  lines.push('');
  lines.push(options.context);
  lines.push('');

  // ── Dialogue ───────────────────────────────────────────────────
  lines.push('## Dialogue');
  lines.push('');

  return lines.join('\n');
}

/**
 * Serialize a ProtocolRules object into the YAML-like block content
 * (without the fenced code block markers).
 */
function serializeRules(rules: ProtocolRules): string {
  const lines: string[] = [];

  // agents list
  lines.push('agents:');
  for (const agent of rules.agents) {
    lines.push(`  - ${agent}`);
  }

  // Scalar fields in canonical order
  const scalarFields: Array<keyof Omit<ProtocolRules, 'agents'>> = [
    'turnOrder',
    'maxTurnsPerRound',
    'turnTimeout',
    'consensusThreshold',
    'consensusMode',
    'escalation',
    'maxRounds',
    'outputFormat',
  ];

  for (const field of scalarFields) {
    const yamlKey = rulesKeyToYaml(field);
    const value = rules[field];
    lines.push(`${yamlKey}: ${value}`);
  }

  return lines.join('\n');
}

// ─── Entry Serialization ─────────────────────────────────────────────

/**
 * Serialize a single entry to its markdown string representation.
 *
 * Generates:
 * - HTML comment metadata (entry ID, turn/round)
 * - Status line (timestamp, author, status)
 * - Structured fields (if present)
 * - Body text
 * - `<!-- yield -->` marker
 *
 * If `metadata.entryId` is empty or not provided, a new UUID v4 is generated.
 * If `timestamp` is empty or not provided, the current time is used.
 */
export function serializeEntry(
  entry: Omit<ProtocolEntry, 'hasYield'>,
): string {
  const entryId = entry.metadata.entryId || randomUUID();
  const timestamp = entry.timestamp || isoNow();
  const turn = entry.metadata.turn;
  const round = entry.metadata.round;
  const author = entry.author;
  const status: EntryStatus = entry.status;

  const lines: string[] = [];

  // ── Metadata comments ──────────────────────────────────────────
  lines.push(`<!-- entry: ${entryId} -->`);
  lines.push(`<!-- turn: ${turn} round: ${round} -->`);

  // ── Status line ────────────────────────────────────────────────
  lines.push(`${timestamp} [author: ${author}] [status: ${status}]`);

  // ── Structured fields (if any) ─────────────────────────────────
  const fields = entry.fields;
  if (fields) {
    if (fields.stance !== undefined) {
      lines.push(`stance: ${fields.stance}`);
    }
    if (fields.confidence !== undefined) {
      lines.push(`confidence: ${fields.confidence}`);
    }
    if (fields.summary !== undefined) {
      lines.push(`summary: ${fields.summary}`);
    }
    if (fields.actionRequested !== undefined) {
      lines.push(`action_requested: ${fields.actionRequested}`);
    }
    if (fields.evidence !== undefined) {
      lines.push(`evidence: ${fields.evidence}`);
    }
  }

  // ── Body ───────────────────────────────────────────────────────
  if (entry.body) {
    lines.push('');
    lines.push(entry.body);
  }

  // ── Yield marker ───────────────────────────────────────────────
  lines.push('');
  lines.push('<!-- yield -->');
  lines.push('');

  return lines.join('\n');
}

// ─── File Append ─────────────────────────────────────────────────────

/**
 * Append a serialized entry to an existing session file.
 *
 * This function:
 * 1. Acquires an exclusive file lock (via AC-006 `withFileLock`).
 * 2. Reads the current file content.
 * 3. Appends the serialized entry at the end.
 * 4. Writes the updated content back.
 * 5. Releases the lock.
 *
 * Existing content is NEVER modified — only new bytes are added at the end.
 */
export async function appendEntry(
  sessionPath: string,
  entry: Omit<ProtocolEntry, 'hasYield'>,
): Promise<void> {
  const serialized = serializeEntry(entry);

  await withFileLock(sessionPath, async () => {
    const existing = await readFile(sessionPath, 'utf-8');

    // Ensure we start on a new line after existing content
    const separator = existing.endsWith('\n') ? '' : '\n';
    const updated = existing + separator + serialized;

    await writeFile(sessionPath, updated, 'utf-8');
  });
}
