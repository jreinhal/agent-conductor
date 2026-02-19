<!-- bounce-protocol: 0.1 -->
<!-- created: 2026-02-18T00:00:00Z -->
<!-- session-id: 00000000-0000-0000-0000-000000000000 -->

# Bounce Protocol v0.1 Specification

**Version**: 0.1
**Status**: Draft
**Date**: 2026-02-18
**Authors**: Agent Conductor Team

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Terminology](#2-terminology)
3. [File Format](#3-file-format)
4. [Entry Format](#4-entry-format)
5. [Protocol Rules Schema](#5-protocol-rules-schema)
6. [Normative Rules](#6-normative-rules)
7. [Consensus Detection](#7-consensus-detection)
8. [Valid Examples](#8-valid-examples)
9. [Invalid Examples](#9-invalid-examples)
10. [Appendix: Relationship to Existing Implementation](#appendix-relationship-to-existing-implementation)

---

## 1. Introduction

The Bounce Protocol defines a file-based interchange format for structured multi-agent dialogue sessions. It enables multiple AI agents (or humans) to participate in turn-based or free-form debates, converge toward consensus, and produce auditable records of the deliberation process.

The protocol is designed around a single markdown file per session. Agents append entries to this file following strict formatting rules. The file is simultaneously human-readable (rendered markdown) and machine-parseable (via HTML comment metadata and structured header fields). This dual nature allows sessions to be reviewed in any markdown viewer while also being consumed by orchestration tooling.

### 1.1 Design Goals

- **Simplicity**: A single markdown file contains the entire session state. No database, no binary format, no separate metadata files.
- **Append-only**: Entries are only ever appended. Existing content is never modified. This guarantees auditability and prevents race conditions in concurrent access scenarios.
- **Human-readable**: The file renders cleanly in any markdown viewer. Metadata lives in HTML comments, which standard renderers hide.
- **Machine-parseable**: Structured fields in entries and YAML-like configuration in the rules section allow tooling to extract state without natural language processing.
- **Versionable**: The protocol version in the header enables parsers to handle future format evolution gracefully.
- **Agent-agnostic**: The format does not prescribe which AI models, frameworks, or orchestrators participate. Any agent that can read and append to a markdown file can join a session.

### 1.2 Scope

This specification covers:

- The structure of a Bounce session file
- The format of individual dialogue entries
- The rules governing turn-taking, consensus, and escalation
- Normative requirements for conforming implementations

This specification does NOT cover:

- The transport mechanism for file access (filesystem, API, etc.)
- The internal architecture of participating agents
- The algorithm for consensus scoring (implementations may vary)
- User interface requirements

---

## 2. Terminology

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in RFC 2119.

| Term | Definition |
|---|---|
| **Session** | A single Bounce Protocol file representing one complete dialogue. |
| **Agent** | Any participant in the session: an AI model, a human, or an automated tool. |
| **Entry** | A single contribution to the dialogue, authored by one agent. |
| **Round** | A complete cycle in which each agent listed in the turn order has had one opportunity to contribute. |
| **Turn** | A single agent's opportunity to contribute within a round. |
| **Yield** | The act of an agent signaling that its entry is complete and the file is safe to read. |
| **Stance** | The agent's declared position on the topic under discussion. |
| **Confidence** | A numeric self-assessment (0.0 to 1.0) of the agent's certainty in its position. |
| **Consensus** | A state in which agent stances and confidence values meet the configured threshold. |
| **Escalation** | The action taken when the session cannot progress (timeout, deadlock, etc.). |

---

## 3. File Format

A Bounce session file is a UTF-8 encoded markdown document with the extension `.md`. The file MUST contain the following sections in order:

1. Header (HTML comment metadata)
2. Title
3. Protocol Rules
4. Context
5. Dialogue

### 3.1 Header

The file MUST begin with exactly three HTML comment lines containing machine-readable metadata. These comments MUST appear before any other content, including blank lines.

```
<!-- bounce-protocol: 0.1 -->
<!-- created: [ISO-8601 datetime] -->
<!-- session-id: [UUID v4] -->
```

**Fields:**

| Field | Format | Required | Description |
|---|---|---|---|
| `bounce-protocol` | Semantic version (`MAJOR.MINOR`) | REQUIRED | Protocol version this file conforms to. Parsers MUST reject files with unrecognized major versions. |
| `created` | ISO-8601 datetime with timezone | REQUIRED | Timestamp of session creation. Example: `2026-02-18T14:30:00Z` |
| `session-id` | UUID v4 (lowercase, hyphenated) | REQUIRED | Globally unique identifier for this session. Used for deduplication and cross-referencing. |

The header comments MUST use exactly the format shown: `<!-- key: value -->` with a single space after `<!--`, a single space before `-->`, and a single space after the colon.

### 3.2 Title

Immediately following the header, the file MUST contain a level-1 heading with the session name:

```markdown
# Bounce Session: [session-name]
```

The session name is free-form text chosen by the session creator. It SHOULD be descriptive of the topic under discussion. It MUST NOT be empty.

### 3.3 Protocol Rules Section

The file MUST contain a level-2 heading `## Protocol Rules` followed by a fenced code block containing YAML-like key-value configuration. Every key listed below is REQUIRED unless marked optional.

```markdown
## Protocol Rules

```yaml
agents:
  - agent-name-1
  - agent-name-2
turn-order: round-robin
max-turns-per-round: 1
turn-timeout: 300
consensus-threshold: 0.7
consensus-mode: majority
escalation: human
max-rounds: 5
output-format: structured
```
```

**Rule Definitions:**

| Key | Type | Required | Description |
|---|---|---|---|
| `agents` | List of strings | REQUIRED | Ordered list of agent names participating in the session. Names MUST be unique within the session. Names SHOULD use lowercase with hyphens (e.g., `claude-sonnet`, `gpt-4o`, `human-reviewer`). |
| `turn-order` | Enum | REQUIRED | How turns are assigned. See below. |
| `max-turns-per-round` | Positive integer | REQUIRED | Maximum number of entries any single agent may contribute per round. Typically `1` for debates. |
| `turn-timeout` | Positive integer | REQUIRED | Maximum seconds an agent has to yield its turn before the timeout escalation policy applies. |
| `consensus-threshold` | Float (0.0 to 1.0) | REQUIRED | The minimum consensus score at which the session MAY be considered resolved. A value of `0.0` disables automatic consensus detection. A value of `1.0` requires unanimous agreement. |
| `consensus-mode` | Enum | REQUIRED | Algorithm for computing consensus. See below. |
| `escalation` | Enum | REQUIRED | Action to take when a turn times out or the session cannot progress. See below. |
| `max-rounds` | Positive integer | REQUIRED | Hard limit on the number of rounds. The session MUST stop after this many rounds regardless of consensus state. |
| `output-format` | Enum | REQUIRED | Whether agents MUST use the structured entry fields or MAY use free-text only. See below. |

**Enum Values:**

`turn-order`:
- `round-robin` -- Agents take turns in the order listed in the `agents` field. Each agent gets exactly `max-turns-per-round` entries per round before the next agent begins.
- `free-form` -- Any agent may contribute at any time. There is no enforced ordering. Rounds are delimited by a supervisor or when all agents have contributed at least once.
- `supervised` -- A designated supervisor (the first agent in the list) controls who speaks next by including an `action_requested` field naming the next agent.

`consensus-mode`:
- `majority` -- Consensus is reached when more than half of agents have a stance of `approve` and their average confidence exceeds the `consensus-threshold`.
- `weighted` -- Each agent's vote is weighted by its confidence value. Consensus is reached when the weighted average of approval stances exceeds the `consensus-threshold`.
- `unanimous` -- All agents MUST have a stance of `approve` and every agent's confidence MUST meet or exceed the `consensus-threshold`.

`escalation`:
- `human` -- A human operator is notified and must intervene. The session enters a waiting state.
- `default-action` -- The orchestrator applies a predefined default (implementation-defined). The session continues.
- `timeout-skip` -- The timed-out agent's turn is skipped. The session continues with the next agent.

`output-format`:
- `structured` -- Agents MUST populate all structured fields (`stance`, `confidence`, `summary`, `action_requested`, `evidence`) in their entries. Parsers MAY rely on these fields for automated processing.
- `free-text` -- Agents MAY omit structured fields. The free-form markdown body is the primary content. Parsers MUST NOT assume structured fields are present.

### 3.4 Context Section

The file MUST contain a level-2 heading `## Context` followed by free-form markdown content. This section provides the initial prompt, background information, and any constraints for the dialogue.

```markdown
## Context

[Free-form markdown content]
```

The context section is written by the session creator before agents begin contributing. Agents MUST NOT modify this section. Additional context MAY be added by appending new subsections (e.g., `### Additional Context Added Round 3`) but original content MUST NOT be altered.

### 3.5 Dialogue Section

The file MUST contain a level-2 heading `## Dialogue` followed by zero or more entries in the format described in Section 4. New entries are appended to the end of this section.

```markdown
## Dialogue

[entries appended here]
```

---

## 4. Entry Format

Each dialogue entry represents a single agent contribution. Entries are appended sequentially to the Dialogue section and MUST NOT be reordered or modified after being written.

### 4.1 Entry Structure

An entry consists of three parts: entry metadata (HTML comments), structured fields, and a free-form body. The entry is terminated by a yield marker.

```
<!-- entry: [UUID v4] -->
<!-- turn: [N] round: [M] -->
[ISO-8601 datetime] [author: agent-name] [status: open|in_progress|closed|yield]
stance: [approve|reject|neutral|defer]
confidence: [0.0-1.0]
summary: [one to two line summary]
action_requested: [specific next step or n/a]
evidence: [file paths, URLs, or n/a]

[Free-form markdown body -- the agent's actual response]

<!-- yield -->
```

### 4.2 Entry Metadata

The first two lines of every entry are HTML comments containing machine-readable identifiers.

**Line 1: Entry ID**
```
<!-- entry: [UUID v4] -->
```
A globally unique identifier for this entry. Parsers use this to detect duplicates and track references between entries.

**Line 2: Position**
```
<!-- turn: [N] round: [M] -->
```
- `N` is the 1-indexed turn number within the round.
- `M` is the 1-indexed round number within the session.

### 4.3 Status Line

The third line contains the timestamp, author, and status, formatted as bracketed fields:

```
[ISO-8601 datetime] [author: agent-name] [status: value]
```

**Status values:**

| Value | Meaning |
|---|---|
| `open` | The entry has been started but is not yet complete. Other agents SHOULD wait. |
| `in_progress` | The agent is actively writing. Used for long-running entries. |
| `closed` | The entry is complete. Equivalent to yielded. |
| `yield` | The entry is complete and the agent explicitly yields its turn. |

In practice, `closed` and `yield` are functionally equivalent. The distinction exists for clarity: `yield` indicates the agent is actively passing control, while `closed` indicates the agent has finished without explicit handoff intent. Parsers MUST treat both as "entry complete."

### 4.4 Structured Fields

The following lines contain key-value pairs. When `output-format` is `structured`, all fields are REQUIRED. When `output-format` is `free-text`, all fields are OPTIONAL.

| Field | Type | Description |
|---|---|---|
| `stance` | Enum: `approve`, `reject`, `neutral`, `defer` | The agent's declared position. `approve` indicates agreement with the emerging consensus or proposal. `reject` indicates disagreement. `neutral` indicates no strong position. `defer` indicates the agent is deferring judgment to others or requesting more information. |
| `confidence` | Float: `0.0` to `1.0` inclusive | The agent's self-assessed certainty. `0.0` means no confidence, `1.0` means absolute certainty. Values outside this range are invalid. |
| `summary` | Free text (1-2 lines) | A brief summary of the entry's key point. Used for quick scanning and consensus dashboards. |
| `action_requested` | Free text or `n/a` | A specific next step the agent is requesting. In `supervised` turn-order, this MAY name the next agent to speak. |
| `evidence` | Comma-separated list or `n/a` | File paths, URLs, or other references supporting the agent's position. |

### 4.5 Free-Form Body

After the structured fields, a blank line separates the metadata from the body. The body is free-form markdown and constitutes the agent's substantive contribution. Agents MAY use any markdown formatting including headings (level 3 or below), lists, code blocks, tables, and emphasis.

Agents MUST NOT use level-1 or level-2 headings in the body, as these are reserved for the session structure.

### 4.6 Yield Marker

Every entry MUST end with a yield marker on its own line:

```
<!-- yield -->
```

This marker signals to other agents and tooling that:
1. The entry is complete and will not be further modified.
2. The file is in a consistent state and safe to read.
3. The next agent may begin its turn.

An entry without a yield marker is considered incomplete. Other agents MUST NOT begin their turn until the previous entry contains a yield marker. Orchestrators SHOULD implement a timeout (per the `turn-timeout` rule) after which an incomplete entry is treated according to the `escalation` policy.

---

## 5. Protocol Rules Schema

This section provides the formal schema for the Protocol Rules YAML block. Implementations SHOULD validate session files against this schema.

```yaml
# Bounce Protocol v0.1 Rules Schema
type: object
required:
  - agents
  - turn-order
  - max-turns-per-round
  - turn-timeout
  - consensus-threshold
  - consensus-mode
  - escalation
  - max-rounds
  - output-format
properties:
  agents:
    type: array
    minItems: 1
    items:
      type: string
      pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$"
    uniqueItems: true
  turn-order:
    type: string
    enum: [round-robin, free-form, supervised]
  max-turns-per-round:
    type: integer
    minimum: 1
    maximum: 10
  turn-timeout:
    type: integer
    minimum: 1
    maximum: 86400
  consensus-threshold:
    type: number
    minimum: 0.0
    maximum: 1.0
  consensus-mode:
    type: string
    enum: [majority, weighted, unanimous]
  escalation:
    type: string
    enum: [human, default-action, timeout-skip]
  max-rounds:
    type: integer
    minimum: 1
    maximum: 100
  output-format:
    type: string
    enum: [structured, free-text]
```

---

## 6. Normative Rules

The following rules are normative. Conforming implementations MUST enforce them.

### 6.1 Append-Only Semantics

**RULE 1**: Existing entries MUST NEVER be modified or deleted. Once an entry's yield marker has been written, the entry is immutable. This applies to all parts of the entry: metadata, structured fields, and body.

**RULE 2**: New entries MUST be appended after the last yield marker in the Dialogue section. Inserting entries between existing entries is forbidden.

**RULE 3**: The Protocol Rules section MUST NOT be modified after the first entry has been written to the Dialogue section. Rule changes require creating a new session.

### 6.2 Yield Discipline

**RULE 4**: The `<!-- yield -->` marker signals turn completion. A file is only in a consistent, readable state when the last entry ends with a yield marker. Agents reading the file SHOULD verify the presence of a trailing yield marker before processing.

**RULE 5**: An agent MUST write its entire entry (metadata, fields, body, and yield marker) as a single atomic append operation where possible. If the underlying system does not support atomic appends, the agent MUST write the yield marker last.

**RULE 6**: No agent may write to the file while another agent's entry is open (lacking a yield marker), except in `free-form` turn-order mode where concurrent writes are permitted provided each agent writes only its own entry.

### 6.3 Entry Identification

**RULE 7**: Every entry MUST have a unique UUID v4 in its `<!-- entry: [uuid] -->` comment. Parsers MUST use this UUID to deduplicate entries. If two entries share the same UUID, the second occurrence MUST be ignored.

**RULE 8**: Turn and round numbers MUST be monotonically non-decreasing within the Dialogue section. An entry with `round: 3` MUST NOT appear before an entry with `round: 4`.

### 6.4 Protocol Versioning

**RULE 9**: The `<!-- bounce-protocol: 0.1 -->` header enables forward compatibility. Parsers MUST check this value before processing. A parser for version `0.1` MUST reject files with a major version other than `0`. Minor version differences within the same major version SHOULD be handled gracefully (unknown fields ignored, missing optional fields defaulted).

### 6.5 Structured Field Integrity

**RULE 10**: When `output-format` is `structured`, the `stance` field MUST be one of the four enumerated values: `approve`, `reject`, `neutral`, `defer`. Any other value is a parse error.

**RULE 11**: When `output-format` is `structured`, the `confidence` field MUST be a decimal number in the range `[0.0, 1.0]`. Values outside this range are invalid. Parsers MUST reject entries with out-of-range confidence values.

**RULE 12**: The `author` field in the status line MUST match one of the names in the `agents` list from Protocol Rules. An entry from an unlisted agent is invalid.

### 6.6 Turn-Order Enforcement

**RULE 13**: In `round-robin` mode, agents MUST contribute in the order listed in the `agents` field. If agent B contributes before agent A in a round where A precedes B in the list, the entry is out of order and SHOULD be flagged by validators (but MUST NOT be deleted per Rule 1).

**RULE 14**: In `supervised` mode, only the agent named in the most recent `action_requested` field (or the first agent, at session start) may contribute next. Other agents MUST wait.

**RULE 15**: In `free-form` mode, any listed agent may contribute at any time. There are no ordering constraints.

### 6.7 Session Lifecycle

**RULE 16**: A session begins when the file is created with a valid header, title, Protocol Rules, and Context section. The Dialogue section may initially be empty.

**RULE 17**: A session ends when any of the following conditions are met:
- The `max-rounds` limit is reached.
- Consensus is detected according to the `consensus-mode` and `consensus-threshold`.
- A human operator explicitly closes the session (by appending a closing entry with status `closed` and a body indicating session end).
- All agents have a stance of `defer` in the most recent round (deadlock).

**RULE 18**: After a session ends, no further entries SHOULD be appended. Implementations MAY append a final summary entry authored by a `judge` or `system` agent, but this entry MUST also follow the standard entry format.

### 6.8 HTML Comment Conventions

**RULE 19**: All machine-readable metadata MUST be encoded in HTML comments (`<!-- ... -->`). This ensures metadata is invisible in standard markdown renderers while remaining trivially parseable.

**RULE 20**: HTML comments used by this protocol follow the pattern `<!-- key: value -->`. Implementations MUST NOT use nested comments or multi-line comment blocks for protocol metadata.

---

## 7. Consensus Detection

This section describes how consensus is computed from entry data. Implementations MAY use more sophisticated algorithms, but MUST respect the `consensus-mode` and `consensus-threshold` values from Protocol Rules.

### 7.1 Majority Consensus

Under `majority` mode, consensus is reached when:

1. More than half of the agents in the most recent round have `stance: approve`.
2. The average `confidence` of approving agents meets or exceeds the `consensus-threshold`.

Formally:

```
let approvers = entries in latest round where stance == "approve"
let total = number of agents
let avg_confidence = mean(approvers.map(e => e.confidence))

consensus_reached = (approvers.count > total / 2) AND (avg_confidence >= threshold)
```

### 7.2 Weighted Consensus

Under `weighted` mode, each agent's vote is weighted by confidence:

```
let score = sum(entries.map(e =>
    e.stance == "approve" ? e.confidence :
    e.stance == "reject"  ? -e.confidence :
    0.0
)) / number_of_agents

consensus_reached = score >= threshold
```

The score ranges from -1.0 (all reject with full confidence) to 1.0 (all approve with full confidence). The threshold applies to this normalized score.

### 7.3 Unanimous Consensus

Under `unanimous` mode, consensus requires:

1. Every agent in the most recent round has `stance: approve`.
2. Every agent's `confidence` meets or exceeds the `consensus-threshold`.

```
consensus_reached = all(entries.map(e =>
    e.stance == "approve" AND e.confidence >= threshold
))
```

### 7.4 Agents with `defer` Stance

An agent with `stance: defer` is excluded from consensus calculation. If all agents defer, the session is in deadlock and the `escalation` policy applies.

---

## 8. Valid Examples

The following examples demonstrate correct Bounce Protocol v0.1 session files.

### Example 1: Single-Agent Session

A session with one agent producing a structured analysis. This is the simplest valid session.

```markdown
<!-- bounce-protocol: 0.1 -->
<!-- created: 2026-02-18T10:00:00Z -->
<!-- session-id: a1b2c3d4-e5f6-7890-abcd-ef1234567890 -->

# Bounce Session: Security Audit of Authentication Module

## Protocol Rules

```yaml
agents:
  - security-auditor
turn-order: round-robin
max-turns-per-round: 1
turn-timeout: 600
consensus-threshold: 0.0
consensus-mode: majority
escalation: human
max-rounds: 1
output-format: structured
```

## Context

Review the authentication module in `lib/auth.ts` for security vulnerabilities.
Focus on token handling, session management, and input validation.

## Dialogue

<!-- entry: f47ac10b-58cc-4372-a567-0e02b2c3d479 -->
<!-- turn: 1 round: 1 -->
2026-02-18T10:01:30Z [author: security-auditor] [status: yield]
stance: reject
confidence: 0.85
summary: Three critical vulnerabilities found in token handling and session management.
action_requested: Developer should address findings before deployment.
evidence: lib/auth.ts, OWASP Top 10 2025

The authentication module has several security concerns:

### Token Handling

The JWT tokens are stored in localStorage, which is vulnerable to XSS attacks.
Recommend migrating to httpOnly cookies with SameSite=Strict.

### Session Management

Sessions lack server-side invalidation. A compromised token remains valid
until expiry. Implement a token revocation list or reduce token TTL to 15 minutes.

### Input Validation

The email field in the login form is validated client-side only. Add server-side
validation with strict regex patterns and rate limiting on failed attempts.

<!-- yield -->
```

### Example 2: Two-Agent Round-Robin Debate

Two agents debate a technical decision over two rounds, reaching consensus.

```markdown
<!-- bounce-protocol: 0.1 -->
<!-- created: 2026-02-18T11:00:00Z -->
<!-- session-id: b2c3d4e5-f6a7-8901-bcde-f12345678901 -->

# Bounce Session: Database Selection for User Analytics

## Protocol Rules

```yaml
agents:
  - backend-architect
  - data-engineer
turn-order: round-robin
max-turns-per-round: 1
turn-timeout: 300
consensus-threshold: 0.7
consensus-mode: majority
escalation: human
max-rounds: 5
output-format: structured
```

## Context

We need to select a database for storing and querying user analytics events.
Expected volume: 50M events/day. Query patterns include time-series aggregations,
funnel analysis, and real-time dashboards. Budget: moderate (managed service preferred).

## Dialogue

<!-- entry: c3d4e5f6-a7b8-9012-cdef-123456789012 -->
<!-- turn: 1 round: 1 -->
2026-02-18T11:01:00Z [author: backend-architect] [status: yield]
stance: approve
confidence: 0.7
summary: Recommends ClickHouse for its column-oriented design and strong time-series performance.
action_requested: data-engineer to evaluate operational complexity.
evidence: https://clickhouse.com/docs/en/introduction/performance, benchmarks/analytics-db-comparison.md

I recommend **ClickHouse** for this use case. Its column-oriented storage is
purpose-built for analytical queries on event data. At 50M events/day, ClickHouse
handles this volume comfortably on modest hardware.

Key advantages:
- Sub-second aggregation queries on billions of rows
- Native time-series functions
- Efficient compression (10:1 typical for event data)
- SQL-compatible interface reduces onboarding friction

The main concern is operational complexity compared to managed alternatives.

<!-- yield -->

<!-- entry: d4e5f6a7-b8c9-0123-def0-234567890123 -->
<!-- turn: 2 round: 1 -->
2026-02-18T11:03:00Z [author: data-engineer] [status: yield]
stance: neutral
confidence: 0.5
summary: ClickHouse is strong technically but raises operational concerns. Suggests evaluating ClickHouse Cloud.
action_requested: backend-architect to consider managed ClickHouse offering.
evidence: https://clickhouse.com/cloud, internal/ops-capacity-report.md

The technical merits of ClickHouse are solid. However, our ops team is at capacity,
and self-hosted ClickHouse requires non-trivial cluster management.

Counterpoints to consider:
- Cluster upgrades require careful coordination
- Replication setup adds complexity
- Monitoring and alerting need custom configuration

I would shift to **approve** if we use ClickHouse Cloud (managed offering) instead
of self-hosting. This preserves the query performance while eliminating the
operational burden.

<!-- yield -->

<!-- entry: e5f6a7b8-c9d0-1234-ef01-345678901234 -->
<!-- turn: 1 round: 2 -->
2026-02-18T11:05:00Z [author: backend-architect] [status: yield]
stance: approve
confidence: 0.85
summary: Agrees to ClickHouse Cloud. Managed service addresses operational concerns.
action_requested: n/a
evidence: https://clickhouse.com/cloud/pricing

I agree with the operational concern. ClickHouse Cloud is the right path forward.
It provides the same query engine with managed infrastructure. Pricing at our
expected volume falls within budget.

Revised recommendation: **ClickHouse Cloud** on the Business tier.

<!-- yield -->

<!-- entry: f6a7b8c9-d0e1-2345-f012-456789012345 -->
<!-- turn: 2 round: 2 -->
2026-02-18T11:06:30Z [author: data-engineer] [status: yield]
stance: approve
confidence: 0.8
summary: Approves ClickHouse Cloud. Operational concerns are resolved by managed service.
action_requested: n/a
evidence: n/a

With the managed offering, my operational concerns are addressed. I approve
ClickHouse Cloud for the analytics database.

This gives us the best of both worlds: ClickHouse's analytical performance with
the operational simplicity of a managed service.

<!-- yield -->
```

### Example 3: Free-Form Multi-Agent Session

Three agents contribute in free-form order to brainstorm an API design.

```markdown
<!-- bounce-protocol: 0.1 -->
<!-- created: 2026-02-18T14:00:00Z -->
<!-- session-id: 11111111-2222-3333-4444-555555666666 -->

# Bounce Session: REST API Design for Notification Service

## Protocol Rules

```yaml
agents:
  - api-designer
  - frontend-dev
  - platform-eng
turn-order: free-form
max-turns-per-round: 2
turn-timeout: 600
consensus-threshold: 0.6
consensus-mode: weighted
escalation: default-action
max-rounds: 3
output-format: structured
```

## Context

Design the REST API for a notification service that supports email, SMS, and
push notifications. Must support batching, scheduling, and template rendering.
The API will be consumed by internal microservices and a React admin dashboard.

## Dialogue

<!-- entry: aaaa1111-bbbb-2222-cccc-dddd3333eeee -->
<!-- turn: 1 round: 1 -->
2026-02-18T14:02:00Z [author: api-designer] [status: yield]
stance: approve
confidence: 0.6
summary: Proposes resource-oriented design with /notifications, /templates, and /channels endpoints.
action_requested: frontend-dev to evaluate developer experience.
evidence: n/a

Proposed endpoint structure:

- `POST /notifications` -- send or schedule a notification
- `GET /notifications/:id` -- retrieve status
- `POST /notifications/batch` -- send multiple notifications
- `GET /templates` -- list available templates
- `POST /templates` -- create a template
- `GET /channels` -- list configured channels (email, SMS, push)

All endpoints return JSON. Batch endpoint accepts arrays of up to 1000 items.

<!-- yield -->

<!-- entry: bbbb2222-cccc-3333-dddd-eeee4444ffff -->
<!-- turn: 2 round: 1 -->
2026-02-18T14:04:00Z [author: platform-eng] [status: yield]
stance: approve
confidence: 0.55
summary: Agrees with structure but adds rate limiting and idempotency key requirements.
action_requested: api-designer to add idempotency specification.
evidence: https://stripe.com/docs/api/idempotent_requests

The resource structure is sound. Two additions needed for production readiness:

1. **Idempotency**: `POST /notifications` MUST accept an `Idempotency-Key` header
   to prevent duplicate sends on retries.
2. **Rate Limiting**: Return `429 Too Many Requests` with `Retry-After` header.
   Suggest 100 req/s per service, 10 req/s for batch.

<!-- yield -->

<!-- entry: cccc3333-dddd-4444-eeee-ffff55556666 -->
<!-- turn: 3 round: 1 -->
2026-02-18T14:06:00Z [author: frontend-dev] [status: yield]
stance: approve
confidence: 0.65
summary: Approves API structure. Requests webhook support for delivery status callbacks.
action_requested: api-designer to add webhook subscription endpoint.
evidence: n/a

The API is clean and easy to integrate with from the dashboard. One addition from
the frontend perspective: we need a webhook subscription endpoint so the dashboard
can receive real-time delivery status updates without polling.

Proposed addition:
- `POST /webhooks` -- register a callback URL
- `DELETE /webhooks/:id` -- unregister

<!-- yield -->
```

### Example 4: Session with Consensus Reached

A two-agent session that reaches the consensus threshold and terminates with a judge synthesis.

```markdown
<!-- bounce-protocol: 0.1 -->
<!-- created: 2026-02-18T09:00:00Z -->
<!-- session-id: 77777777-8888-9999-aaaa-bbbbccccdddd -->

# Bounce Session: Error Handling Strategy for API Gateway

## Protocol Rules

```yaml
agents:
  - reliability-eng
  - api-developer
turn-order: round-robin
max-turns-per-round: 1
turn-timeout: 300
consensus-threshold: 0.75
consensus-mode: majority
escalation: timeout-skip
max-rounds: 4
output-format: structured
```

## Context

Define the error handling strategy for the API gateway. Key questions:
1. Should we use RFC 7807 Problem Details format?
2. How should we handle upstream service timeouts?
3. What retry policy should the gateway implement?

## Dialogue

<!-- entry: 11112222-3333-4444-5555-666677778888 -->
<!-- turn: 1 round: 1 -->
2026-02-18T09:01:00Z [author: reliability-eng] [status: yield]
stance: approve
confidence: 0.8
summary: Strongly recommends RFC 7807 with circuit breaker pattern and exponential backoff.
action_requested: api-developer to evaluate implementation complexity.
evidence: https://www.rfc-editor.org/rfc/rfc7807, https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker

Recommendations:

1. **RFC 7807**: Yes. It provides a standard structure that clients can parse
   programmatically. Include `type`, `title`, `status`, `detail`, and `instance` fields.

2. **Upstream Timeouts**: Implement the circuit breaker pattern. After 5 consecutive
   failures, open the circuit for 30 seconds. Return `503 Service Unavailable` with
   `Retry-After` header during open state.

3. **Retry Policy**: Exponential backoff starting at 100ms, max 3 retries, with
   jitter. Only retry on 502, 503, and 504 status codes. Never retry on 4xx.

<!-- yield -->

<!-- entry: 22223333-4444-5555-6666-777788889999 -->
<!-- turn: 2 round: 1 -->
2026-02-18T09:03:00Z [author: api-developer] [status: yield]
stance: approve
confidence: 0.78
summary: Approves RFC 7807 and circuit breaker. Suggests reducing max retries to 2 for latency sensitivity.
action_requested: n/a
evidence: n/a

I agree with all three recommendations. One minor refinement: reduce max retries
from 3 to 2. At 100ms base with exponential backoff, 3 retries can add up to
700ms+ worst case. For our latency-sensitive endpoints, 2 retries (max ~300ms)
is more appropriate.

Everything else -- RFC 7807, circuit breaker with 5-failure threshold, jitter --
is spot on.

<!-- yield -->

<!-- entry: 33334444-5555-6666-7777-888899990000 -->
<!-- turn: 1 round: 2 -->
2026-02-18T09:04:30Z [author: reliability-eng] [status: yield]
stance: approve
confidence: 0.9
summary: Accepts 2-retry refinement. Full agreement on error handling strategy.
action_requested: n/a
evidence: n/a

The 2-retry adjustment is a good call for latency-sensitive paths. Accepted.

We have full alignment:
- RFC 7807 Problem Details for error responses
- Circuit breaker: 5 failures, 30s open state
- Retry: exponential backoff, 100ms base, max 2 retries, jitter, 5xx only

<!-- yield -->

<!-- entry: 44445555-6666-7777-8888-999900001111 -->
<!-- turn: 2 round: 2 -->
2026-02-18T09:05:00Z [author: api-developer] [status: yield]
stance: approve
confidence: 0.9
summary: Confirmed. Consensus reached on all three error handling questions.
action_requested: n/a
evidence: n/a

Confirmed. No further objections. The strategy is clear and actionable.

<!-- yield -->
```

### Example 5: Session with Timeout and Escalation

A session where an agent times out and the escalation policy is applied.

```markdown
<!-- bounce-protocol: 0.1 -->
<!-- created: 2026-02-18T16:00:00Z -->
<!-- session-id: eeeeeeee-ffff-0000-1111-222233334444 -->

# Bounce Session: Migration Strategy for Legacy Database

## Protocol Rules

```yaml
agents:
  - dba-specialist
  - app-developer
  - project-manager
turn-order: round-robin
max-turns-per-round: 1
turn-timeout: 120
consensus-threshold: 0.65
consensus-mode: weighted
escalation: timeout-skip
max-rounds: 3
output-format: structured
```

## Context

Plan the migration from PostgreSQL 12 to PostgreSQL 16. The database serves
production traffic 24/7 with 99.9% uptime SLA. Schema includes 200+ tables
with complex foreign key relationships and 50+ stored procedures.

## Dialogue

<!-- entry: aaa11111-bbb2-ccc3-ddd4-eee555fff666 -->
<!-- turn: 1 round: 1 -->
2026-02-18T16:01:00Z [author: dba-specialist] [status: yield]
stance: approve
confidence: 0.7
summary: Recommends pg_upgrade with logical replication for zero-downtime migration.
action_requested: app-developer to assess application compatibility.
evidence: https://www.postgresql.org/docs/16/pgupgrade.html

Recommended approach: use `pg_upgrade --link` for the schema migration, with
logical replication to a PostgreSQL 16 replica for zero-downtime cutover.

Steps:
1. Set up PG16 replica with logical replication from PG12
2. Run application test suite against PG16 replica
3. Validate stored procedure compatibility
4. Schedule cutover during lowest traffic window
5. Switch application connection strings with <1 minute downtime

<!-- yield -->

<!-- entry: bbb22222-ccc3-ddd4-eee5-fff666aaa777 -->
<!-- turn: 2 round: 1 -->
2026-02-18T16:04:30Z [author: app-developer] [status: yield]
stance: neutral
confidence: 0.5
summary: Concerned about stored procedure compatibility. Needs testing time.
action_requested: dba-specialist to provide list of deprecated PG12 features used in stored procedures.
evidence: n/a

The migration approach is sound in principle, but I need to flag a risk: we use
several PG12-era patterns in stored procedures that may have changed behavior in
PG16. Specifically, I am concerned about implicit casting changes and the removal
of certain legacy operators.

Before I can approve, I need a compatibility audit of the 50+ stored procedures.

<!-- yield -->

<!-- entry: ccc33333-ddd4-eee5-fff6-aaa777bbb888 -->
<!-- turn: 3 round: 1 -->
2026-02-18T16:06:01Z [author: project-manager] [status: yield]
stance: defer
confidence: 0.3
summary: Timed out waiting for full analysis. Deferring to technical leads.
action_requested: dba-specialist and app-developer to complete compatibility audit before next round.
evidence: n/a

I do not have sufficient technical context to take a position on the migration
approach. I defer to the technical leads on this.

From a project perspective, I need a timeline estimate once the compatibility
audit is complete.

<!-- yield -->

<!-- entry: ddd44444-eee5-fff6-aaa7-bbb888ccc999 -->
<!-- turn: 1 round: 2 -->
2026-02-18T16:08:00Z [author: dba-specialist] [status: yield]
stance: approve
confidence: 0.8
summary: Completed compatibility audit. 3 stored procedures need updates. Low risk.
action_requested: app-developer to review the 3 flagged procedures.
evidence: audit/pg12-to-pg16-compat-report.csv

Compatibility audit complete. Of 52 stored procedures:
- 49 are fully compatible with PG16
- 3 require minor syntax updates (implicit casting changes)
- 0 use removed features

The three flagged procedures are low-complexity utility functions. Estimated
update effort: 2 hours.

<!-- yield -->

<!-- entry: eee55555-fff6-aaa7-bbb8-ccc999ddd000 -->
<!-- turn: 2 round: 2 -->
2026-02-18T16:10:00Z [author: app-developer] [status: yield]
stance: approve
confidence: 0.75
summary: Satisfied with compatibility audit results. Approves migration approach.
action_requested: project-manager to schedule migration window.
evidence: n/a

The compatibility results are reassuring. Three minor procedure updates is well
within acceptable risk. I approve the `pg_upgrade` with logical replication approach.

<!-- yield -->

<!-- entry: fff66666-aaa7-bbb8-ccc9-ddd000eee111 -->
<!-- turn: 3 round: 2 -->
2026-02-18T16:12:02Z [author: project-manager] [status: closed]
stance: defer
confidence: 0.3
summary: Turn timed out. Escalation policy applied: turn skipped per timeout-skip rule.
action_requested: n/a
evidence: n/a

*[This entry was generated by the orchestrator after a timeout. The project-manager
agent did not respond within the 120-second turn-timeout. Per the `timeout-skip`
escalation policy, this turn was skipped and the session continues.]*

<!-- yield -->
```

### Example 6: Supervised Turn-Order Session

A session where a lead agent controls who speaks next.

```markdown
<!-- bounce-protocol: 0.1 -->
<!-- created: 2026-02-18T13:00:00Z -->
<!-- session-id: 55550000-aaaa-bbbb-cccc-dddd1111eeee -->

# Bounce Session: Incident Post-Mortem Review

## Protocol Rules

```yaml
agents:
  - incident-lead
  - on-call-eng
  - platform-eng
turn-order: supervised
max-turns-per-round: 1
turn-timeout: 300
consensus-threshold: 0.7
consensus-mode: unanimous
escalation: human
max-rounds: 4
output-format: structured
```

## Context

Post-mortem review for the 2026-02-17 outage affecting the payment service.
Duration: 47 minutes. Impact: 12% of transactions failed. Root cause to be
determined through this structured review.

## Dialogue

<!-- entry: 99990000-1111-2222-3333-444455556666 -->
<!-- turn: 1 round: 1 -->
2026-02-18T13:01:00Z [author: incident-lead] [status: yield]
stance: neutral
confidence: 0.4
summary: Opening the post-mortem. Requesting timeline from on-call engineer.
action_requested: on-call-eng to provide incident timeline.
evidence: monitoring/alerts-2026-02-17.log

I am opening this post-mortem review. Before we discuss root cause, I need a
clear timeline of events.

On-call engineer: please provide the timeline from first alert to resolution.

<!-- yield -->

<!-- entry: aaaa0000-bbbb-1111-cccc-2222dddd3333 -->
<!-- turn: 2 round: 1 -->
2026-02-18T13:03:00Z [author: on-call-eng] [status: yield]
stance: neutral
confidence: 0.6
summary: Provides incident timeline. Root cause identified as connection pool exhaustion.
action_requested: incident-lead to direct next steps.
evidence: monitoring/payment-service-metrics-2026-02-17.json, logs/payment-svc-error.log

Timeline:
- 14:23 UTC: Alert fired -- payment service error rate exceeded 5% threshold
- 14:25 UTC: I acknowledged the alert and began investigation
- 14:31 UTC: Identified connection pool exhaustion on payment-db-primary
- 14:38 UTC: Attempted connection pool restart -- partial recovery
- 14:45 UTC: Identified root cause -- a long-running analytics query was holding connections
- 14:47 UTC: Terminated the offending query
- 15:10 UTC: Full recovery confirmed, error rate back to baseline

The root cause appears to be a long-running analytics query that was executed
against the primary database instead of the read replica.

<!-- yield -->

<!-- entry: bbbb0000-cccc-1111-dddd-2222eeee3333 -->
<!-- turn: 3 round: 1 -->
2026-02-18T13:05:00Z [author: incident-lead] [status: yield]
stance: neutral
confidence: 0.5
summary: Directing platform-eng to assess why query routing failed.
action_requested: platform-eng to explain why the analytics query hit the primary database.
evidence: n/a

Thank you for the timeline. The critical question is: why did the analytics query
reach the primary database? Our architecture is supposed to route read-heavy
analytics queries to the replica.

Platform engineer: please investigate the query routing failure.

<!-- yield -->
```

---

## 9. Invalid Examples

The following examples demonstrate files that violate the Bounce Protocol v0.1 specification. Each example identifies the specific rule violation.

### Invalid Example 1: Missing Required Header Fields

**Violation**: The `session-id` header comment is missing, violating Section 3.1 (all three header lines are REQUIRED).

```markdown
<!-- bounce-protocol: 0.1 -->
<!-- created: 2026-02-18T10:00:00Z -->

# Bounce Session: Code Review

## Protocol Rules

```yaml
agents:
  - reviewer
turn-order: round-robin
max-turns-per-round: 1
turn-timeout: 300
consensus-threshold: 0.7
consensus-mode: majority
escalation: human
max-rounds: 3
output-format: structured
```

## Context

Review the pull request for memory leak fixes.

## Dialogue
```

**Why this is invalid**: The file has only two header comments. The `<!-- session-id: [uuid] -->` line is missing. A conforming parser MUST reject this file because the session cannot be uniquely identified or deduplicated without a session ID.

---

### Invalid Example 2: Malformed Entry (Missing Yield Marker)

**Violation**: The entry does not end with a `<!-- yield -->` marker, violating Rule 4 and Section 4.6.

```markdown
<!-- bounce-protocol: 0.1 -->
<!-- created: 2026-02-18T10:00:00Z -->
<!-- session-id: abcdefab-1234-5678-9abc-def012345678 -->

# Bounce Session: API Review

## Protocol Rules

```yaml
agents:
  - api-reviewer
turn-order: round-robin
max-turns-per-round: 1
turn-timeout: 300
consensus-threshold: 0.7
consensus-mode: majority
escalation: human
max-rounds: 3
output-format: structured
```

## Context

Review the new API endpoints.

## Dialogue

<!-- entry: 12345678-abcd-ef01-2345-6789abcdef01 -->
<!-- turn: 1 round: 1 -->
2026-02-18T10:01:00Z [author: api-reviewer] [status: yield]
stance: approve
confidence: 0.8
summary: API endpoints look good.
action_requested: n/a
evidence: n/a

The endpoints follow RESTful conventions and have proper error handling.
```

**Why this is invalid**: The entry declares `status: yield` in the status line but does not have the `<!-- yield -->` comment at the end. The yield marker is the authoritative signal that the entry is complete and the file is safe to read. Without it, other agents and parsers MUST treat the entry as incomplete, regardless of the status field value. The status field indicates intent; the yield marker indicates reality.

---

### Invalid Example 3: Invalid Stance Value

**Violation**: The stance value `strongly-agree` is not one of the four permitted values (`approve`, `reject`, `neutral`, `defer`), violating Rule 10.

```markdown
<!-- bounce-protocol: 0.1 -->
<!-- created: 2026-02-18T10:00:00Z -->
<!-- session-id: 98765432-abcd-ef01-2345-6789abcdef01 -->

# Bounce Session: Framework Selection

## Protocol Rules

```yaml
agents:
  - tech-lead
turn-order: round-robin
max-turns-per-round: 1
turn-timeout: 300
consensus-threshold: 0.7
consensus-mode: majority
escalation: human
max-rounds: 3
output-format: structured
```

## Context

Select a frontend framework for the new project.

## Dialogue

<!-- entry: aabbccdd-1122-3344-5566-778899001122 -->
<!-- turn: 1 round: 1 -->
2026-02-18T10:01:00Z [author: tech-lead] [status: yield]
stance: strongly-agree
confidence: 0.9
summary: Recommends React for the frontend.
action_requested: n/a
evidence: n/a

React is the best choice for this project due to ecosystem maturity.

<!-- yield -->
```

**Why this is invalid**: The `stance` field uses the value `strongly-agree`, which is not a valid protocol stance. The Bounce Protocol v0.1 defines exactly four stance values: `approve`, `reject`, `neutral`, and `defer`. While the existing runtime implementation (`bounce-types.ts`) uses a richer stance vocabulary (e.g., `strongly_agree`, `disagree`, `refine`, `synthesize`), the protocol file format intentionally uses a simplified set to enable reliable automated consensus detection. The correct value here would be `approve`.

---

### Invalid Example 4: Confidence Out of Range

**Violation**: The confidence value `1.5` exceeds the permitted range of `[0.0, 1.0]`, violating Rule 11.

```markdown
<!-- bounce-protocol: 0.1 -->
<!-- created: 2026-02-18T10:00:00Z -->
<!-- session-id: 11223344-5566-7788-99aa-bbccddeeff00 -->

# Bounce Session: Performance Optimization

## Protocol Rules

```yaml
agents:
  - perf-analyst
turn-order: round-robin
max-turns-per-round: 1
turn-timeout: 300
consensus-threshold: 0.7
consensus-mode: majority
escalation: human
max-rounds: 3
output-format: structured
```

## Context

Identify performance bottlenecks in the checkout flow.

## Dialogue

<!-- entry: ffeeddcc-bbaa-9988-7766-554433221100 -->
<!-- turn: 1 round: 1 -->
2026-02-18T10:01:00Z [author: perf-analyst] [status: yield]
stance: approve
confidence: 1.5
summary: Database queries in checkout are the primary bottleneck.
action_requested: n/a
evidence: perf/checkout-profile-2026-02-17.json

The checkout flow spends 80% of its time in database queries. Adding an index
on `orders.user_id` would reduce query time by an estimated 60%.

<!-- yield -->
```

**Why this is invalid**: Confidence values MUST be in the range `[0.0, 1.0]`. The value `1.5` exceeds this range. Parsers MUST reject this entry. A confidence of `1.0` already represents absolute certainty; values above this are semantically meaningless and likely indicate a formatting error.

---

### Invalid Example 5: Missing Session ID (Empty Value)

**Violation**: The session-id header is present but has an empty value, violating Section 3.1 which requires a UUID v4.

```markdown
<!-- bounce-protocol: 0.1 -->
<!-- created: 2026-02-18T10:00:00Z -->
<!-- session-id: -->

# Bounce Session: Deployment Pipeline Review

## Protocol Rules

```yaml
agents:
  - devops-eng
turn-order: round-robin
max-turns-per-round: 1
turn-timeout: 300
consensus-threshold: 0.7
consensus-mode: majority
escalation: human
max-rounds: 3
output-format: structured
```

## Context

Review the CI/CD pipeline configuration for the new microservice.

## Dialogue
```

**Why this is invalid**: While the `session-id` comment line is present, its value is empty. The specification requires a UUID v4 value. An empty session ID cannot serve its purpose of uniquely identifying the session for deduplication and cross-referencing. Parsers MUST reject files where the session-id is missing, empty, or not a valid UUID v4.

---

### Invalid Example 6: Author Not in Agents List

**Violation**: The entry author `security-reviewer` does not appear in the `agents` list, violating Rule 12.

```markdown
<!-- bounce-protocol: 0.1 -->
<!-- created: 2026-02-18T10:00:00Z -->
<!-- session-id: aabb1122-ccdd-3344-eeff-556677889900 -->

# Bounce Session: Dependency Audit

## Protocol Rules

```yaml
agents:
  - dependency-checker
  - tech-lead
turn-order: round-robin
max-turns-per-round: 1
turn-timeout: 300
consensus-threshold: 0.7
consensus-mode: majority
escalation: human
max-rounds: 3
output-format: structured
```

## Context

Audit third-party dependencies for known vulnerabilities.

## Dialogue

<!-- entry: 00112233-4455-6677-8899-aabbccddeeff -->
<!-- turn: 1 round: 1 -->
2026-02-18T10:01:00Z [author: security-reviewer] [status: yield]
stance: reject
confidence: 0.9
summary: Found 3 critical CVEs in current dependencies.
action_requested: tech-lead to prioritize remediation.
evidence: audit/npm-audit-2026-02-18.json

Three dependencies have critical vulnerabilities that need immediate attention.

<!-- yield -->
```

**Why this is invalid**: The entry is authored by `security-reviewer`, but the agents list only contains `dependency-checker` and `tech-lead`. Rule 12 requires that the `author` field match one of the names in the `agents` list. This prevents unauthorized agents from contributing to a session and ensures all participants are tracked in the Protocol Rules.

---

### Invalid Example 7: Round Numbers Not Monotonically Increasing

**Violation**: An entry with `round: 1` appears after an entry with `round: 2`, violating Rule 8.

```markdown
<!-- bounce-protocol: 0.1 -->
<!-- created: 2026-02-18T10:00:00Z -->
<!-- session-id: 11aa22bb-33cc-44dd-55ee-66ff77008899 -->

# Bounce Session: Architecture Review

## Protocol Rules

```yaml
agents:
  - architect-a
  - architect-b
turn-order: round-robin
max-turns-per-round: 1
turn-timeout: 300
consensus-threshold: 0.7
consensus-mode: majority
escalation: human
max-rounds: 5
output-format: structured
```

## Context

Review the proposed microservices architecture.

## Dialogue

<!-- entry: a0a0a0a0-b1b1-c2c2-d3d3-e4e4e4e4e4e4 -->
<!-- turn: 1 round: 2 -->
2026-02-18T10:01:00Z [author: architect-a] [status: yield]
stance: approve
confidence: 0.7
summary: Approves the decomposition strategy.
action_requested: n/a
evidence: n/a

The service boundaries are well-defined.

<!-- yield -->

<!-- entry: b1b1b1b1-c2c2-d3d3-e4e4-f5f5f5f5f5f5 -->
<!-- turn: 1 round: 1 -->
2026-02-18T10:03:00Z [author: architect-b] [status: yield]
stance: neutral
confidence: 0.5
summary: Needs more information about inter-service communication.
action_requested: n/a
evidence: n/a

I need to understand the communication patterns before taking a position.

<!-- yield -->
```

**Why this is invalid**: The second entry has `round: 1` but appears after an entry with `round: 2`. Rule 8 requires that turn and round numbers be monotonically non-decreasing within the Dialogue section. This ordering violation suggests either a corrupted file or a concurrency error, and parsers SHOULD flag it.

---

## Appendix: Relationship to Existing Implementation

This protocol specification is designed to complement the existing Agent Conductor bounce system implemented in TypeScript (`lib/bounce-types.ts`, `lib/bounce-orchestrator.ts`, `lib/consensus-analyzer.ts`). The key mappings between the existing runtime types and the protocol file format are:

| Runtime Type (bounce-types.ts) | Protocol Equivalent |
|---|---|
| `BounceMode: 'sequential'` | `turn-order: round-robin` |
| `BounceMode: 'parallel'` | `turn-order: free-form` |
| `BounceConfig.maxRounds` | `max-rounds` |
| `BounceConfig.consensusThreshold` | `consensus-threshold` |
| `ResponseStance` (7 values) | `stance` (4 values: approve, reject, neutral, defer) |
| `BounceResponse.confidence` | `confidence` |
| `ConsensusAnalysis.score` | Computed from entry stance + confidence per consensus-mode |
| `BounceStatus` | Derived from entry statuses and session state |

### Stance Mapping

The runtime implementation uses a richer stance vocabulary than the protocol format. When serializing runtime state to a protocol file, the following mapping applies:

| Runtime Stance | Protocol Stance |
|---|---|
| `strongly_agree` | `approve` |
| `agree` | `approve` |
| `refine` | `approve` (with lower confidence) |
| `synthesize` | `neutral` |
| `neutral` | `neutral` |
| `disagree` | `reject` |
| `strongly_disagree` | `reject` |

The `defer` protocol stance has no direct runtime equivalent. It is used in the file format to represent agents that abstain from the current round, which in the runtime is handled by the orchestrator skipping a participant or by a `BOUNCE_PAUSED` event.

### Future Evolution

Protocol version `0.1` is intentionally minimal. Future versions may add:

- **Attachments**: References to files, images, or code snippets within entries.
- **Threading**: Entries that reply to specific previous entries rather than the session as a whole.
- **Signatures**: Cryptographic signatures for entry authenticity verification.
- **Streaming yield**: A mechanism for agents to signal partial completion for real-time UI updates.
- **Extended stances**: Additional stance values for richer consensus modeling.
- **Schema embedding**: Inline JSON Schema for validating structured fields.

Version bumps follow semantic versioning: minor versions add backward-compatible features; major versions indicate breaking changes. Parsers for version `0.X` SHOULD attempt to parse any `0.Y` file where `Y >= X`, ignoring unknown fields.
