/**
 * Bounce Protocol v0.1 — Parser
 *
 * Parses raw markdown strings into structured BounceSession objects.
 * Uses plain string parsing with regex — no external dependencies.
 *
 * Design principles:
 * - Never throws: returns partial results + validation issues on malformed input.
 * - Parses as much as possible even from broken files.
 * - Collects all issues during parsing for batch reporting.
 *
 * @see docs/protocol/bounce-v0.1.md
 */

import type {
  BounceSession,
  EntryFields,
  EntryMetadata,
  EntryStatus,
  OutputFormat,
  ParseResult,
  ProtocolEntry,
  ProtocolRules,
  SessionHeader,
  Stance,
  TurnOrder,
  ConsensusMode,
  EscalationPolicy,
  ValidationIssue,
  ValidationSeverity,
} from './types';
import { ValidationCodes } from './types';

// ─── Regex patterns ──────────────────────────────────────────────────

const HEADER_COMMENT_RE =
  /^<!--\s+(bounce-protocol|created|session-id):\s*(.*?)\s*-->$/;
const TITLE_RE = /^#\s+Bounce Session:\s*(.+)$/;
const ENTRY_MARKER_RE = /^<!--\s+entry:\s*([0-9a-f-]+)\s*-->$/;
const TURN_ROUND_RE = /^<!--\s+turn:\s*(\d+)\s+round:\s*(\d+)\s*-->$/;
const STATUS_LINE_RE =
  /^(\S+)\s+\[author:\s*([^\]]+)\]\s+\[status:\s*([^\]]+)\]$/;
const YIELD_MARKER_RE = /^<!--\s+yield\s*-->$/;
const FIELD_RE = /^(stance|confidence|summary|action_requested|evidence):\s*(.*)$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Helpers ─────────────────────────────────────────────────────────

function issue(
  severity: ValidationSeverity,
  code: string,
  message: string,
  line?: number,
  entryId?: string,
): ValidationIssue {
  const iss: ValidationIssue = { severity, code, message };
  if (line !== undefined) iss.line = line;
  if (entryId !== undefined) iss.entryId = entryId;
  return iss;
}

const VALID_STANCES = new Set(['approve', 'reject', 'neutral', 'defer']);
const VALID_STATUSES = new Set(['open', 'in_progress', 'closed', 'yield']);
const VALID_TURN_ORDERS = new Set(['round-robin', 'free-form', 'supervised']);
const VALID_CONSENSUS_MODES = new Set(['majority', 'weighted', 'unanimous']);
const VALID_ESCALATIONS = new Set(['human', 'default-action', 'timeout-skip']);
const VALID_OUTPUT_FORMATS = new Set(['structured', 'free-text']);

// ─── Section Splitting ───────────────────────────────────────────────

interface SectionBounds {
  rulesStart: number;
  rulesEnd: number;
  contextStart: number;
  contextEnd: number;
  dialogueStart: number;
  dialogueEnd: number;
}

/**
 * Finds the line indices where each major section starts and ends.
 * Returns -1 for sections that are not found.
 */
function findSections(lines: string[]): {
  bounds: Partial<SectionBounds>;
  titleLine: number;
} {
  let titleLine = -1;
  let rulesHeading = -1;
  let contextHeading = -1;
  let dialogueHeading = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (titleLine === -1 && TITLE_RE.test(trimmed)) {
      titleLine = i;
    } else if (trimmed === '## Protocol Rules') {
      rulesHeading = i;
    } else if (trimmed === '## Context') {
      contextHeading = i;
    } else if (trimmed === '## Dialogue') {
      dialogueHeading = i;
    }
  }

  const bounds: Partial<SectionBounds> = {};

  if (rulesHeading !== -1) {
    bounds.rulesStart = rulesHeading + 1;
    bounds.rulesEnd = contextHeading !== -1 ? contextHeading : dialogueHeading !== -1 ? dialogueHeading : lines.length;
  }

  if (contextHeading !== -1) {
    bounds.contextStart = contextHeading + 1;
    bounds.contextEnd = dialogueHeading !== -1 ? dialogueHeading : lines.length;
  }

  if (dialogueHeading !== -1) {
    bounds.dialogueStart = dialogueHeading + 1;
    bounds.dialogueEnd = lines.length;
  }

  return { bounds, titleLine };
}

// ─── Header Parsing ──────────────────────────────────────────────────

function parseHeader(
  lines: string[],
  issues: ValidationIssue[],
): Partial<SessionHeader> {
  const header: Partial<SessionHeader> = {};
  // Scan the first several lines for header comments (allow some flexibility)
  const scanLimit = Math.min(lines.length, 10);
  for (let i = 0; i < scanLimit; i++) {
    const match = lines[i].trim().match(HEADER_COMMENT_RE);
    if (!match) continue;
    const [, key, value] = match;
    switch (key) {
      case 'bounce-protocol':
        header.protocolVersion = value;
        break;
      case 'created':
        header.created = value;
        break;
      case 'session-id':
        header.sessionId = value;
        break;
    }
  }

  // Validate presence
  if (!header.protocolVersion) {
    issues.push(
      issue('error', ValidationCodes.MISSING_PROTOCOL_VERSION, 'Missing bounce-protocol header comment'),
    );
  }
  if (!header.created) {
    issues.push(
      issue('error', ValidationCodes.MISSING_CREATED, 'Missing created header comment'),
    );
  }
  if (!header.sessionId) {
    issues.push(
      issue('error', ValidationCodes.MISSING_SESSION_ID, 'Missing session-id header comment'),
    );
  }

  // Validate formats
  if (header.protocolVersion !== undefined && header.protocolVersion === '') {
    issues.push(
      issue('error', ValidationCodes.INVALID_PROTOCOL_VERSION, 'Protocol version is empty'),
    );
  }
  if (header.created !== undefined && header.created === '') {
    issues.push(
      issue('error', ValidationCodes.INVALID_CREATED_FORMAT, 'Created timestamp is empty'),
    );
  }
  if (header.sessionId !== undefined) {
    if (header.sessionId === '' || !UUID_RE.test(header.sessionId)) {
      issues.push(
        issue(
          'error',
          ValidationCodes.INVALID_SESSION_ID_FORMAT,
          `Invalid session-id format: "${header.sessionId}" (expected UUID v4)`,
        ),
      );
    }
  }

  return header;
}

// ─── Title Parsing ───────────────────────────────────────────────────

function parseTitle(
  lines: string[],
  titleLine: number,
  issues: ValidationIssue[],
): string | undefined {
  if (titleLine === -1) {
    issues.push(
      issue('error', ValidationCodes.MISSING_TITLE, 'Missing session title (# Bounce Session: ...)'),
    );
    return undefined;
  }
  const match = lines[titleLine].trim().match(TITLE_RE);
  if (!match) {
    issues.push(
      issue('error', ValidationCodes.MISSING_TITLE, 'Malformed session title', titleLine + 1),
    );
    return undefined;
  }
  const title = match[1].trim();
  if (title === '') {
    issues.push(
      issue('error', ValidationCodes.EMPTY_TITLE, 'Session title is empty', titleLine + 1),
    );
    return '';
  }
  return title;
}

// ─── Rules Parsing ───────────────────────────────────────────────────

function parseRules(
  lines: string[],
  bounds: Partial<SectionBounds>,
  issues: ValidationIssue[],
): Partial<ProtocolRules> | undefined {
  if (bounds.rulesStart === undefined || bounds.rulesEnd === undefined) {
    issues.push(
      issue('error', ValidationCodes.MISSING_RULES_SECTION, 'Missing ## Protocol Rules section'),
    );
    return undefined;
  }

  // Extract content between the fenced code block markers
  const sectionLines = lines.slice(bounds.rulesStart, bounds.rulesEnd);
  let inCodeBlock = false;
  const yamlLines: string[] = [];
  for (const line of sectionLines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```') && !inCodeBlock) {
      inCodeBlock = true;
      continue;
    }
    if (trimmed.startsWith('```') && inCodeBlock) {
      break;
    }
    if (inCodeBlock) {
      yamlLines.push(line);
    }
  }

  // Simple line-by-line YAML-like parser
  const rules: Partial<ProtocolRules> = {};
  const agents: string[] = [];
  let parsingAgents = false;

  for (const line of yamlLines) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    // Check for agent list item
    if (parsingAgents) {
      if (trimmed.startsWith('- ')) {
        agents.push(trimmed.slice(2).trim());
        continue;
      } else {
        parsingAgents = false;
      }
    }

    // Check for key-value pair
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();

    switch (key) {
      case 'agents':
        parsingAgents = true;
        // If there's a value on the same line (inline list), skip — we expect list items
        break;
      case 'turn-order':
        if (VALID_TURN_ORDERS.has(value)) {
          rules.turnOrder = value as TurnOrder;
        } else {
          issues.push(
            issue('error', ValidationCodes.INVALID_RULE_VALUE, `Invalid turn-order value: "${value}"`),
          );
        }
        break;
      case 'max-turns-per-round': {
        const n = parseInt(value, 10);
        if (isNaN(n) || n < 1) {
          issues.push(
            issue('error', ValidationCodes.INVALID_RULE_VALUE, `Invalid max-turns-per-round: "${value}"`),
          );
        } else {
          rules.maxTurnsPerRound = n;
        }
        break;
      }
      case 'turn-timeout': {
        const n = parseInt(value, 10);
        if (isNaN(n) || n < 1) {
          issues.push(
            issue('error', ValidationCodes.INVALID_RULE_VALUE, `Invalid turn-timeout: "${value}"`),
          );
        } else {
          rules.turnTimeout = n;
        }
        break;
      }
      case 'consensus-threshold': {
        const n = parseFloat(value);
        if (isNaN(n) || n < 0 || n > 1) {
          issues.push(
            issue('error', ValidationCodes.INVALID_RULE_VALUE, `Invalid consensus-threshold: "${value}" (must be 0.0-1.0)`),
          );
        } else {
          rules.consensusThreshold = n;
        }
        break;
      }
      case 'consensus-mode':
        if (VALID_CONSENSUS_MODES.has(value)) {
          rules.consensusMode = value as ConsensusMode;
        } else {
          issues.push(
            issue('error', ValidationCodes.INVALID_RULE_VALUE, `Invalid consensus-mode: "${value}"`),
          );
        }
        break;
      case 'escalation':
        if (VALID_ESCALATIONS.has(value)) {
          rules.escalation = value as EscalationPolicy;
        } else {
          issues.push(
            issue('error', ValidationCodes.INVALID_RULE_VALUE, `Invalid escalation: "${value}"`),
          );
        }
        break;
      case 'max-rounds': {
        const n = parseInt(value, 10);
        if (isNaN(n) || n < 1 || n > 100) {
          issues.push(
            issue('error', ValidationCodes.INVALID_RULE_VALUE, `Invalid max-rounds: "${value}" (must be 1-100)`),
          );
        } else {
          rules.maxRounds = n;
        }
        break;
      }
      case 'output-format':
        if (VALID_OUTPUT_FORMATS.has(value)) {
          rules.outputFormat = value as OutputFormat;
        } else {
          issues.push(
            issue('error', ValidationCodes.INVALID_RULE_VALUE, `Invalid output-format: "${value}"`),
          );
        }
        break;
    }
  }

  if (agents.length > 0) {
    rules.agents = agents;
  }

  return rules;
}

// ─── Context Parsing ─────────────────────────────────────────────────

function parseContext(
  lines: string[],
  bounds: Partial<SectionBounds>,
  issues: ValidationIssue[],
): string | undefined {
  if (bounds.contextStart === undefined || bounds.contextEnd === undefined) {
    issues.push(
      issue('error', ValidationCodes.MISSING_CONTEXT_SECTION, 'Missing ## Context section'),
    );
    return undefined;
  }

  const contextLines = lines.slice(bounds.contextStart, bounds.contextEnd);
  return contextLines.join('\n').trim();
}

// ─── Entry Parsing ───────────────────────────────────────────────────

function parseEntries(
  lines: string[],
  bounds: Partial<SectionBounds>,
  outputFormat: OutputFormat | undefined,
  issues: ValidationIssue[],
): ProtocolEntry[] {
  if (bounds.dialogueStart === undefined || bounds.dialogueEnd === undefined) {
    issues.push(
      issue('error', ValidationCodes.MISSING_DIALOGUE_SECTION, 'Missing ## Dialogue section'),
    );
    return [];
  }

  const entries: ProtocolEntry[] = [];
  const dialogueLines = lines.slice(bounds.dialogueStart, bounds.dialogueEnd);
  const lineOffset = bounds.dialogueStart; // for computing absolute line numbers

  // Find all entry start positions
  const entryStarts: number[] = [];
  for (let i = 0; i < dialogueLines.length; i++) {
    if (ENTRY_MARKER_RE.test(dialogueLines[i].trim())) {
      entryStarts.push(i);
    }
  }

  for (let idx = 0; idx < entryStarts.length; idx++) {
    const start = entryStarts[idx];
    const end = idx + 1 < entryStarts.length ? entryStarts[idx + 1] : dialogueLines.length;
    const entryLines = dialogueLines.slice(start, end);
    const absLineStart = lineOffset + start + 1; // 1-indexed

    const entry = parseSingleEntry(entryLines, absLineStart, outputFormat, issues);
    if (entry) {
      entries.push(entry);
    }
  }

  return entries;
}

function parseSingleEntry(
  entryLines: string[],
  absLineStart: number,
  outputFormat: OutputFormat | undefined,
  issues: ValidationIssue[],
): ProtocolEntry | null {
  // Line 0: entry marker
  const entryMatch = entryLines[0]?.trim().match(ENTRY_MARKER_RE);
  if (!entryMatch) {
    issues.push(
      issue('error', ValidationCodes.MISSING_ENTRY_ID, 'Entry marker not found', absLineStart),
    );
    return null;
  }
  const entryId = entryMatch[1];

  // Line 1: turn/round
  const metadata: EntryMetadata = { entryId, turn: 0, round: 0 };
  if (entryLines.length > 1) {
    const turnMatch = entryLines[1]?.trim().match(TURN_ROUND_RE);
    if (turnMatch) {
      metadata.turn = parseInt(turnMatch[1], 10);
      metadata.round = parseInt(turnMatch[2], 10);
    } else {
      issues.push(
        issue(
          'error',
          ValidationCodes.MISSING_TURN_ROUND,
          `Missing or malformed turn/round comment for entry ${entryId}`,
          absLineStart + 1,
          entryId,
        ),
      );
    }
  } else {
    issues.push(
      issue(
        'error',
        ValidationCodes.MISSING_TURN_ROUND,
        `Entry ${entryId} is truncated (missing turn/round)`,
        absLineStart,
        entryId,
      ),
    );
  }

  // Line 2: status line
  let timestamp = '';
  let author = '';
  let status: EntryStatus = 'open';
  let statusLineParsed = false;

  if (entryLines.length > 2) {
    const statusMatch = entryLines[2]?.trim().match(STATUS_LINE_RE);
    if (statusMatch) {
      timestamp = statusMatch[1];
      author = statusMatch[2].trim();
      const rawStatus = statusMatch[3].trim();
      if (VALID_STATUSES.has(rawStatus)) {
        status = rawStatus as EntryStatus;
      } else {
        issues.push(
          issue(
            'error',
            ValidationCodes.INVALID_ENTRY_STATUS,
            `Invalid entry status: "${rawStatus}" for entry ${entryId}`,
            absLineStart + 2,
            entryId,
          ),
        );
      }
      statusLineParsed = true;
    } else {
      issues.push(
        issue(
          'error',
          ValidationCodes.MISSING_STATUS_LINE,
          `Missing or malformed status line for entry ${entryId}`,
          absLineStart + 2,
          entryId,
        ),
      );
    }
  }

  // Lines 3+: structured fields and body
  const fields: Partial<EntryFields> = {};
  const bodyLines: string[] = [];
  let hasYield = false;
  let pastFields = false;

  const fieldStart = statusLineParsed ? 3 : 2;
  for (let i = fieldStart; i < entryLines.length; i++) {
    const trimmed = entryLines[i].trim();

    // Check for yield marker
    if (YIELD_MARKER_RE.test(trimmed)) {
      hasYield = true;
      continue;
    }

    // Parse structured fields (only before we transition to body)
    if (!pastFields) {
      const fieldMatch = trimmed.match(FIELD_RE);
      if (fieldMatch) {
        const [, fieldName, fieldValue] = fieldMatch;
        switch (fieldName) {
          case 'stance':
            fields.stance = fieldValue.trim() as Stance;
            break;
          case 'confidence': {
            const n = parseFloat(fieldValue.trim());
            if (!isNaN(n)) {
              fields.confidence = n;
            }
            break;
          }
          case 'summary':
            fields.summary = fieldValue.trim();
            break;
          case 'action_requested':
            fields.actionRequested = fieldValue.trim();
            break;
          case 'evidence':
            fields.evidence = fieldValue.trim();
            break;
        }
        continue;
      }
      // Empty line or non-field line transitions to body
      if (trimmed === '') {
        pastFields = true;
        continue;
      }
      // If it doesn't match a field and isn't empty, it's body content
      pastFields = true;
    }

    // Collect body lines (exclude trailing yield markers which were already caught)
    if (!YIELD_MARKER_RE.test(trimmed)) {
      bodyLines.push(entryLines[i]);
    }
  }

  // Validate structured fields inline
  if (fields.stance !== undefined && !VALID_STANCES.has(fields.stance)) {
    issues.push(
      issue(
        'error',
        ValidationCodes.INVALID_STANCE,
        `Invalid stance value: "${fields.stance}" for entry ${entryId}`,
        absLineStart,
        entryId,
      ),
    );
  }

  if (fields.confidence !== undefined) {
    if (isNaN(fields.confidence)) {
      issues.push(
        issue(
          'error',
          ValidationCodes.INVALID_CONFIDENCE,
          `Invalid confidence value for entry ${entryId}`,
          absLineStart,
          entryId,
        ),
      );
    } else if (fields.confidence < 0 || fields.confidence > 1) {
      issues.push(
        issue(
          'error',
          ValidationCodes.CONFIDENCE_OUT_OF_RANGE,
          `Confidence ${fields.confidence} out of range [0.0, 1.0] for entry ${entryId}`,
          absLineStart,
          entryId,
        ),
      );
    }
  }

  if (!hasYield) {
    issues.push(
      issue(
        'warning',
        ValidationCodes.MISSING_YIELD_MARKER,
        `Entry ${entryId} is missing the <!-- yield --> marker`,
        absLineStart,
        entryId,
      ),
    );
  }

  // Trim trailing empty lines from body
  let body = bodyLines.join('\n');
  body = body.replace(/\n+$/, '').replace(/^\n+/, '');

  return {
    metadata,
    timestamp,
    author,
    status,
    fields,
    body,
    hasYield,
  };
}

// ─── Main Parser ─────────────────────────────────────────────────────

/**
 * Parse a raw Bounce Protocol markdown string into a structured ParseResult.
 *
 * This function never throws. On malformed input it returns partial results
 * along with validation issues describing what went wrong.
 */
export function parseSession(rawMarkdown: string): ParseResult {
  const issues: ValidationIssue[] = [];

  if (!rawMarkdown || rawMarkdown.trim() === '') {
    issues.push(
      issue('error', ValidationCodes.MISSING_PROTOCOL_VERSION, 'Empty input'),
    );
    issues.push(
      issue('error', ValidationCodes.MISSING_CREATED, 'Empty input'),
    );
    issues.push(
      issue('error', ValidationCodes.MISSING_SESSION_ID, 'Empty input'),
    );
    issues.push(
      issue('error', ValidationCodes.MISSING_TITLE, 'Empty input'),
    );
    return {
      session: null,
      validation: {
        valid: false,
        issues,
      },
    };
  }

  const lines = rawMarkdown.split('\n');

  // 1. Parse header
  const header = parseHeader(lines, issues);

  // 2. Find sections
  const { bounds, titleLine } = findSections(lines);

  // 3. Parse title
  const title = parseTitle(lines, titleLine, issues);

  // 4. Parse rules
  const rules = parseRules(lines, bounds, issues);

  // 5. Parse context
  const context = parseContext(lines, bounds, issues);

  // 6. Parse dialogue entries
  const outputFormat = rules?.outputFormat;
  const entries = parseEntries(lines, bounds, outputFormat, issues);

  // Build partial session
  const session: Partial<BounceSession> = { rawSource: rawMarkdown };
  if (header.protocolVersion || header.created || header.sessionId) {
    session.header = header as SessionHeader;
  }
  if (title !== undefined) {
    session.title = title;
  }
  if (rules) {
    session.rules = rules as ProtocolRules;
  }
  if (context !== undefined) {
    session.context = context;
  }
  session.entries = entries;

  const hasErrors = issues.some((i) => i.severity === 'error');

  return {
    session,
    validation: {
      valid: !hasErrors,
      issues,
    },
  };
}
