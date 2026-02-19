/**
 * Bounce Protocol v0.1 — Validator
 *
 * Validates a parsed (possibly partial) BounceSession for structural
 * and semantic correctness according to the protocol specification.
 *
 * The validator is separate from the parser so it can be run:
 * - Immediately after parsing (parser calls it internally via parseSession)
 * - Independently on a programmatically constructed session
 * - Incrementally when new entries are appended
 *
 * @see docs/protocol/bounce-v0.1.md
 */

import type {
  BounceSession,
  ProtocolEntry,
  ProtocolRules,
  SessionHeader,
  ValidationIssue,
  ValidationResult,
  ValidationSeverity,
} from './types';
import { ValidationCodes } from './types';

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
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REQUIRED_RULE_KEYS: Array<keyof ProtocolRules> = [
  'agents',
  'turnOrder',
  'maxTurnsPerRound',
  'turnTimeout',
  'consensusThreshold',
  'consensusMode',
  'escalation',
  'maxRounds',
  'outputFormat',
];

const RULE_DISPLAY_NAMES: Record<string, string> = {
  agents: 'agents',
  turnOrder: 'turn-order',
  maxTurnsPerRound: 'max-turns-per-round',
  turnTimeout: 'turn-timeout',
  consensusThreshold: 'consensus-threshold',
  consensusMode: 'consensus-mode',
  escalation: 'escalation',
  maxRounds: 'max-rounds',
  outputFormat: 'output-format',
};

// ─── Header Validation ───────────────────────────────────────────────

function validateHeader(
  header: Partial<SessionHeader> | undefined,
  issues: ValidationIssue[],
): void {
  if (!header) {
    issues.push(
      issue('error', ValidationCodes.MISSING_PROTOCOL_VERSION, 'Missing session header'),
    );
    issues.push(
      issue('error', ValidationCodes.MISSING_CREATED, 'Missing session header'),
    );
    issues.push(
      issue('error', ValidationCodes.MISSING_SESSION_ID, 'Missing session header'),
    );
    return;
  }

  if (!header.protocolVersion) {
    issues.push(
      issue('error', ValidationCodes.MISSING_PROTOCOL_VERSION, 'Missing protocol version'),
    );
  } else if (header.protocolVersion === '') {
    issues.push(
      issue('error', ValidationCodes.INVALID_PROTOCOL_VERSION, 'Protocol version is empty'),
    );
  }

  if (!header.created) {
    issues.push(
      issue('error', ValidationCodes.MISSING_CREATED, 'Missing created timestamp'),
    );
  } else if (header.created === '') {
    issues.push(
      issue('error', ValidationCodes.INVALID_CREATED_FORMAT, 'Created timestamp is empty'),
    );
  }

  if (!header.sessionId) {
    issues.push(
      issue('error', ValidationCodes.MISSING_SESSION_ID, 'Missing session ID'),
    );
  } else if (!UUID_RE.test(header.sessionId)) {
    issues.push(
      issue(
        'error',
        ValidationCodes.INVALID_SESSION_ID_FORMAT,
        `Invalid session ID format: "${header.sessionId}"`,
      ),
    );
  }
}

// ─── Title Validation ────────────────────────────────────────────────

function validateTitle(
  title: string | undefined,
  issues: ValidationIssue[],
): void {
  if (title === undefined) {
    issues.push(
      issue('error', ValidationCodes.MISSING_TITLE, 'Missing session title'),
    );
  } else if (title.trim() === '') {
    issues.push(
      issue('error', ValidationCodes.EMPTY_TITLE, 'Session title is empty'),
    );
  }
}

// ─── Rules Validation ────────────────────────────────────────────────

function validateRules(
  rules: Partial<ProtocolRules> | undefined,
  issues: ValidationIssue[],
): void {
  if (!rules) {
    issues.push(
      issue('error', ValidationCodes.MISSING_RULES_SECTION, 'Missing protocol rules'),
    );
    return;
  }

  // Check for required keys
  for (const key of REQUIRED_RULE_KEYS) {
    const value = rules[key];
    if (value === undefined || value === null) {
      issues.push(
        issue(
          'error',
          ValidationCodes.MISSING_REQUIRED_RULE,
          `Missing required rule: ${RULE_DISPLAY_NAMES[key] || key}`,
        ),
      );
    }
  }

  // Validate agents list
  if (rules.agents !== undefined) {
    if (rules.agents.length === 0) {
      issues.push(
        issue('error', ValidationCodes.EMPTY_AGENTS_LIST, 'Agents list is empty'),
      );
    } else {
      // Check for duplicates
      const seen = new Set<string>();
      for (const agent of rules.agents) {
        if (agent.trim() === '') {
          issues.push(
            issue('error', ValidationCodes.EMPTY_AGENTS_LIST, 'Agent name is empty'),
          );
        }
        if (seen.has(agent)) {
          issues.push(
            issue(
              'error',
              ValidationCodes.DUPLICATE_AGENT_NAME,
              `Duplicate agent name: "${agent}"`,
            ),
          );
        }
        seen.add(agent);
      }
    }
  }

  // Validate enum values
  if (rules.turnOrder !== undefined && !VALID_TURN_ORDERS.has(rules.turnOrder)) {
    issues.push(
      issue('error', ValidationCodes.INVALID_RULE_VALUE, `Invalid turn-order: "${rules.turnOrder}"`),
    );
  }
  if (rules.consensusMode !== undefined && !VALID_CONSENSUS_MODES.has(rules.consensusMode)) {
    issues.push(
      issue('error', ValidationCodes.INVALID_RULE_VALUE, `Invalid consensus-mode: "${rules.consensusMode}"`),
    );
  }
  if (rules.escalation !== undefined && !VALID_ESCALATIONS.has(rules.escalation)) {
    issues.push(
      issue('error', ValidationCodes.INVALID_RULE_VALUE, `Invalid escalation: "${rules.escalation}"`),
    );
  }
  if (rules.outputFormat !== undefined && !VALID_OUTPUT_FORMATS.has(rules.outputFormat)) {
    issues.push(
      issue('error', ValidationCodes.INVALID_RULE_VALUE, `Invalid output-format: "${rules.outputFormat}"`),
    );
  }

  // Validate numeric ranges
  if (rules.maxTurnsPerRound !== undefined && (rules.maxTurnsPerRound < 1 || !Number.isInteger(rules.maxTurnsPerRound))) {
    issues.push(
      issue('error', ValidationCodes.INVALID_RULE_VALUE, `Invalid max-turns-per-round: ${rules.maxTurnsPerRound}`),
    );
  }
  if (rules.turnTimeout !== undefined && (rules.turnTimeout < 1 || !Number.isInteger(rules.turnTimeout))) {
    issues.push(
      issue('error', ValidationCodes.INVALID_RULE_VALUE, `Invalid turn-timeout: ${rules.turnTimeout}`),
    );
  }
  if (rules.consensusThreshold !== undefined && (rules.consensusThreshold < 0 || rules.consensusThreshold > 1)) {
    issues.push(
      issue('error', ValidationCodes.INVALID_RULE_VALUE, `consensus-threshold ${rules.consensusThreshold} out of range [0.0, 1.0]`),
    );
  }
  if (rules.maxRounds !== undefined && (rules.maxRounds < 1 || rules.maxRounds > 100 || !Number.isInteger(rules.maxRounds))) {
    issues.push(
      issue('error', ValidationCodes.INVALID_RULE_VALUE, `Invalid max-rounds: ${rules.maxRounds}`),
    );
  }
}

// ─── Entry Validation ────────────────────────────────────────────────

function validateEntries(
  entries: ProtocolEntry[] | undefined,
  rules: Partial<ProtocolRules> | undefined,
  issues: ValidationIssue[],
): void {
  if (!entries || entries.length === 0) return;

  const agentSet = new Set(rules?.agents ?? []);
  const outputFormat = rules?.outputFormat;
  const turnOrder = rules?.turnOrder;
  const seenEntryIds = new Set<string>();
  let lastRound = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const eid = entry.metadata.entryId;

    // Duplicate entry IDs
    if (seenEntryIds.has(eid)) {
      issues.push(
        issue('error', ValidationCodes.DUPLICATE_ENTRY_ID, `Duplicate entry ID: "${eid}"`, undefined, eid),
      );
    }
    seenEntryIds.add(eid);

    // Author must be in agents list (when we have agents and output-format is known)
    if (agentSet.size > 0 && entry.author && !agentSet.has(entry.author)) {
      issues.push(
        issue(
          'error',
          ValidationCodes.UNKNOWN_AGENT,
          `Entry author "${entry.author}" is not in the agents list`,
          undefined,
          eid,
        ),
      );
    }

    // Stance validation
    if (entry.fields.stance !== undefined && !VALID_STANCES.has(entry.fields.stance)) {
      issues.push(
        issue(
          'error',
          ValidationCodes.INVALID_STANCE,
          `Invalid stance: "${entry.fields.stance}"`,
          undefined,
          eid,
        ),
      );
    }

    // Confidence range
    if (entry.fields.confidence !== undefined) {
      if (isNaN(entry.fields.confidence)) {
        issues.push(
          issue(
            'error',
            ValidationCodes.INVALID_CONFIDENCE,
            `Invalid confidence value for entry ${eid}`,
            undefined,
            eid,
          ),
        );
      } else if (entry.fields.confidence < 0 || entry.fields.confidence > 1) {
        issues.push(
          issue(
            'error',
            ValidationCodes.CONFIDENCE_OUT_OF_RANGE,
            `Confidence ${entry.fields.confidence} out of range [0.0, 1.0]`,
            undefined,
            eid,
          ),
        );
      }
    }

    // Required structured fields when output-format is "structured"
    if (outputFormat === 'structured') {
      const requiredFields = ['stance', 'confidence', 'summary', 'actionRequested', 'evidence'] as const;
      for (const field of requiredFields) {
        if (entry.fields[field] === undefined) {
          const displayName = field === 'actionRequested' ? 'action_requested' : field;
          issues.push(
            issue(
              'error',
              ValidationCodes.MISSING_REQUIRED_FIELD,
              `Missing required structured field: ${displayName}`,
              undefined,
              eid,
            ),
          );
        }
      }
    }

    // Yield marker
    if (!entry.hasYield) {
      issues.push(
        issue(
          'warning',
          ValidationCodes.MISSING_YIELD_MARKER,
          `Entry ${eid} is missing the yield marker`,
          undefined,
          eid,
        ),
      );
    }

    // Round monotonicity
    const round = entry.metadata.round;
    if (round > 0 && lastRound > 0 && round < lastRound) {
      issues.push(
        issue(
          'warning',
          ValidationCodes.ROUND_NOT_MONOTONIC,
          `Round ${round} appears after round ${lastRound} (non-monotonic)`,
          undefined,
          eid,
        ),
      );
    }
    if (round > 0) {
      lastRound = round;
    }
  }

  // Turn order enforcement (round-robin check)
  if (turnOrder === 'round-robin' && rules?.agents && rules.agents.length > 1) {
    validateRoundRobinOrder(entries, rules.agents, issues);
  }
}

/**
 * Check that entries in round-robin mode follow the agent order.
 * Violations produce warnings (entries must not be deleted per Rule 1).
 */
function validateRoundRobinOrder(
  entries: ProtocolEntry[],
  agents: string[],
  issues: ValidationIssue[],
): void {
  // Group entries by round
  const byRound = new Map<number, ProtocolEntry[]>();
  for (const entry of entries) {
    const round = entry.metadata.round;
    if (!byRound.has(round)) {
      byRound.set(round, []);
    }
    byRound.get(round)!.push(entry);
  }

  for (const [round, roundEntries] of byRound) {
    for (let i = 0; i < roundEntries.length; i++) {
      const expectedAgent = agents[i % agents.length];
      const actualAgent = roundEntries[i].author;
      if (actualAgent && expectedAgent && actualAgent !== expectedAgent) {
        issues.push(
          issue(
            'warning',
            ValidationCodes.OUT_OF_ORDER_TURN,
            `Expected "${expectedAgent}" but got "${actualAgent}" at position ${i + 1} in round ${round}`,
            undefined,
            roundEntries[i].metadata.entryId,
          ),
        );
      }
    }
  }
}

// ─── Main Validator ──────────────────────────────────────────────────

/**
 * Validate a parsed (possibly partial) BounceSession.
 *
 * Returns a ValidationResult indicating whether the session is valid
 * and listing all issues found. Errors block processing; warnings are advisory.
 */
export function validateSession(
  session: Partial<BounceSession>,
): ValidationResult {
  const issues: ValidationIssue[] = [];

  validateHeader(session.header, issues);
  validateTitle(session.title, issues);
  validateRules(session.rules, issues);

  if (session.context === undefined) {
    issues.push(
      issue('error', ValidationCodes.MISSING_CONTEXT_SECTION, 'Missing context section'),
    );
  }

  validateEntries(session.entries, session.rules, issues);

  const hasErrors = issues.some((i) => i.severity === 'error');

  return {
    valid: !hasErrors,
    issues,
  };
}
