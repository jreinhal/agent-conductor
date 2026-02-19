/**
 * Bounce Protocol v0.1 — Type Definitions
 *
 * Strongly typed models for the Bounce Protocol file format.
 * Used by the parser, serializer, validator, file watcher, and UI.
 *
 * @see docs/protocol/bounce-v0.1.md
 */

// ─── Enums ───────────────────────────────────────────────────────────

/** How turns are assigned within a round. */
export type TurnOrder = 'round-robin' | 'free-form' | 'supervised';

/** Algorithm for computing consensus from agent stances. */
export type ConsensusMode = 'majority' | 'weighted' | 'unanimous';

/** Action taken when a turn times out or the session cannot progress. */
export type EscalationPolicy = 'human' | 'default-action' | 'timeout-skip';

/** Whether agents must use structured fields or may use free-text only. */
export type OutputFormat = 'structured' | 'free-text';

/** An agent's declared position on the topic under discussion. */
export type Stance = 'approve' | 'reject' | 'neutral' | 'defer';

/** The completion state of an individual entry. */
export type EntryStatus = 'open' | 'in_progress' | 'closed' | 'yield';

// ─── Protocol Rules ──────────────────────────────────────────────────

/** Configuration governing a Bounce session's behavior. */
export interface ProtocolRules {
  /** Ordered list of participating agent names. */
  agents: string[];
  /** How turns are assigned. */
  turnOrder: TurnOrder;
  /** Maximum entries any single agent may contribute per round. */
  maxTurnsPerRound: number;
  /** Seconds before a turn times out. */
  turnTimeout: number;
  /** Minimum consensus score for session resolution (0.0–1.0). */
  consensusThreshold: number;
  /** Algorithm for computing consensus. */
  consensusMode: ConsensusMode;
  /** Action on timeout or deadlock. */
  escalation: EscalationPolicy;
  /** Hard limit on number of rounds. */
  maxRounds: number;
  /** Whether structured fields are required in entries. */
  outputFormat: OutputFormat;
}

// ─── Session Header ──────────────────────────────────────────────────

/** Machine-readable metadata from the file header HTML comments. */
export interface SessionHeader {
  /** Protocol version (e.g. "0.1"). */
  protocolVersion: string;
  /** ISO-8601 datetime of session creation. */
  created: string;
  /** UUID v4 session identifier. */
  sessionId: string;
}

// ─── Dialogue Entry ──────────────────────────────────────────────────

/** Metadata extracted from entry HTML comments. */
export interface EntryMetadata {
  /** UUID v4 entry identifier. */
  entryId: string;
  /** 1-indexed turn number within the round. */
  turn: number;
  /** 1-indexed round number within the session. */
  round: number;
}

/** Structured fields in a dialogue entry (required when output-format is "structured"). */
export interface EntryFields {
  /** The agent's declared position. */
  stance: Stance;
  /** Self-assessed certainty (0.0–1.0). */
  confidence: number;
  /** Brief summary of the entry's key point. */
  summary: string;
  /** Specific next step or "n/a". */
  actionRequested: string;
  /** File paths, URLs, or "n/a". */
  evidence: string;
}

/** A single agent contribution to the dialogue. */
export interface ProtocolEntry {
  /** Entry metadata from HTML comments. */
  metadata: EntryMetadata;
  /** ISO-8601 datetime of entry creation. */
  timestamp: string;
  /** Name of the contributing agent. */
  author: string;
  /** Entry completion status. */
  status: EntryStatus;
  /** Structured fields (may be partial when output-format is "free-text"). */
  fields: Partial<EntryFields>;
  /** Free-form markdown body. */
  body: string;
  /** Whether the entry has a closing yield marker. */
  hasYield: boolean;
}

// ─── Parsed Session ──────────────────────────────────────────────────

/** A fully parsed Bounce Protocol session file. */
export interface BounceSession {
  /** Machine-readable header metadata. */
  header: SessionHeader;
  /** Session title (from the level-1 heading). */
  title: string;
  /** Protocol rules configuration. */
  rules: ProtocolRules;
  /** Context section markdown content. */
  context: string;
  /** Ordered list of dialogue entries. */
  entries: ProtocolEntry[];
  /** Raw markdown source (for round-trip fidelity). */
  rawSource: string;
}

// ─── Validation ──────────────────────────────────────────────────────

/** Severity level of a validation issue. */
export type ValidationSeverity = 'error' | 'warning';

/** A single validation issue found in a session file. */
export interface ValidationIssue {
  /** Severity: errors block processing, warnings are advisory. */
  severity: ValidationSeverity;
  /** Machine-readable error code (e.g. "MISSING_HEADER_FIELD"). */
  code: string;
  /** Human-readable description of the issue. */
  message: string;
  /** 1-indexed line number where the issue was detected, if available. */
  line?: number;
  /** Entry UUID if the issue is within a specific entry. */
  entryId?: string;
}

/** Result of validating a session file. */
export interface ValidationResult {
  /** Whether the session is valid (no errors; warnings are allowed). */
  valid: boolean;
  /** List of issues found. */
  issues: ValidationIssue[];
}

// ─── Parse Result ────────────────────────────────────────────────────

/** Result of parsing a session file (may be partial on malformed input). */
export interface ParseResult {
  /** Parsed session (may be partial if errors were encountered). */
  session: Partial<BounceSession> | null;
  /** Validation issues encountered during parsing. */
  validation: ValidationResult;
}

// ─── Consensus ───────────────────────────────────────────────────────

/** Outcome of a consensus detection check. */
export type ConsensusOutcome = 'reached' | 'not-reached' | 'deadlock';

/** Result of running consensus detection on a session's entries. */
export interface ConsensusResult {
  /** Whether consensus was reached, not reached, or deadlocked. */
  outcome: ConsensusOutcome;
  /** Computed consensus score (meaning depends on consensus-mode). */
  score: number;
  /** Per-agent stance summary for the evaluated round. */
  agentStances: Array<{
    agent: string;
    stance: Stance;
    confidence: number;
  }>;
  /** Round number that was evaluated. */
  round: number;
}

// ─── Error Codes ─────────────────────────────────────────────────────

/** Canonical validation error codes for stable programmatic handling. */
export const ValidationCodes = {
  // Header errors
  MISSING_PROTOCOL_VERSION: 'MISSING_PROTOCOL_VERSION',
  MISSING_CREATED: 'MISSING_CREATED',
  MISSING_SESSION_ID: 'MISSING_SESSION_ID',
  INVALID_PROTOCOL_VERSION: 'INVALID_PROTOCOL_VERSION',
  INVALID_CREATED_FORMAT: 'INVALID_CREATED_FORMAT',
  INVALID_SESSION_ID_FORMAT: 'INVALID_SESSION_ID_FORMAT',

  // Title errors
  MISSING_TITLE: 'MISSING_TITLE',
  EMPTY_TITLE: 'EMPTY_TITLE',

  // Rules errors
  MISSING_RULES_SECTION: 'MISSING_RULES_SECTION',
  MISSING_REQUIRED_RULE: 'MISSING_REQUIRED_RULE',
  INVALID_RULE_VALUE: 'INVALID_RULE_VALUE',
  DUPLICATE_AGENT_NAME: 'DUPLICATE_AGENT_NAME',
  EMPTY_AGENTS_LIST: 'EMPTY_AGENTS_LIST',

  // Context errors
  MISSING_CONTEXT_SECTION: 'MISSING_CONTEXT_SECTION',

  // Dialogue errors
  MISSING_DIALOGUE_SECTION: 'MISSING_DIALOGUE_SECTION',

  // Entry errors
  MISSING_ENTRY_ID: 'MISSING_ENTRY_ID',
  DUPLICATE_ENTRY_ID: 'DUPLICATE_ENTRY_ID',
  MISSING_TURN_ROUND: 'MISSING_TURN_ROUND',
  MISSING_STATUS_LINE: 'MISSING_STATUS_LINE',
  INVALID_ENTRY_STATUS: 'INVALID_ENTRY_STATUS',
  INVALID_STANCE: 'INVALID_STANCE',
  INVALID_CONFIDENCE: 'INVALID_CONFIDENCE',
  CONFIDENCE_OUT_OF_RANGE: 'CONFIDENCE_OUT_OF_RANGE',
  MISSING_YIELD_MARKER: 'MISSING_YIELD_MARKER',
  UNKNOWN_AGENT: 'UNKNOWN_AGENT',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  ROUND_NOT_MONOTONIC: 'ROUND_NOT_MONOTONIC',
  OUT_OF_ORDER_TURN: 'OUT_OF_ORDER_TURN',
} as const;

export type ValidationCode = (typeof ValidationCodes)[keyof typeof ValidationCodes];
