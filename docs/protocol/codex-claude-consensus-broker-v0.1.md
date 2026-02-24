# Codex-Claude Consensus Broker Protocol v0.1

Date: 2026-02-23  
Status: Active (external CLI workflow)

## Purpose

This protocol lets one coordinator script drive a two-CLI debate loop (Codex CLI + Claude CLI) without manual copy/paste between terminals.

It is designed for:

- user asks one question
- both CLIs research independently
- both compare and revise
- coordinator produces consensus output
- artifacts are persisted for audit

## Scope and Relation to Agent Conductor

- Agent Conductor app protocol (`docs/protocol/bounce-v0.1.md`) is the richer app-native dialogue protocol.
- This broker protocol is a simpler external transport for CLI-to-CLI operation.
- Semantics are similar (rounded debate and convergence), but transport is different:
  - Agent Conductor: markdown-centric session protocol
  - Broker here: JSONL queue/events + markdown transcript output

## Transport

File-based bus in a protocol directory (default: `.data/consensus-bus`).

Files:

- `questions.jsonl`: append-only input queue (user/system submits questions)
- `events.jsonl`: append-only runtime events from broker
- `state.json`: processed question ids (dedupe and resume)
- `transcript.md`: human-readable transcript and final consensus blocks

## Runtime Visibility

- Claude steps emit live terminal activity (spinner, pulsing bar, elapsed seconds).
- This applies to `/init` and each Claude response stage.
- In non-interactive terminals (no TTY), logs fall back to start/done activity lines.

## Event and Queue Shapes

Question line (`questions.jsonl`):

```json
{"id":"q_20260223_001","question":"What pricing should we launch with?","ts":"2026-02-23T20:10:00.000Z"}
```

Broker events (`events.jsonl`):

```json
{"type":"BROKER_STARTED","ts":"2026-02-23T20:11:00.000Z","protocolDir":".data/consensus-bus","pollMs":1000}
{"type":"QUESTION_STARTED","ts":"2026-02-23T20:11:05.000Z","questionId":"q_20260223_001"}
{"type":"QUESTION_COMPLETED","ts":"2026-02-23T20:12:14.000Z","questionId":"q_20260223_001","outputPath":".data/consensus-bus/transcript.md"}
{"type":"BROKER_STOPPED","ts":"2026-02-23T21:00:00.000Z"}
```

Failure event:

```json
{"type":"QUESTION_FAILED","ts":"2026-02-23T20:12:14.000Z","questionId":"q_20260223_001","error":"..."}
```

## Runtime Contract

Per question, the broker executes a fixed sequence:

1. Codex independent response.
2. Claude independent response.
3. Codex compare/revise pass.
4. Claude compare/revise pass.
5. Codex consensus draft.
6. Claude approval/revision.
7. Codex final merge.
8. Persist transcript and completion event.

Before any of the above, the broker executes:

0. Claude initialization in the current working directory via `/init` (default behavior).

## Reasoning Trace Policy

- Hidden internal chain-of-thought is not requested or exposed.
- The broker enforces public reasoning traces in each model output.
- Each turn is expected to include explicit sections such as:
  - answer/revised answer
  - agreements/disagreements (where applicable)
  - rationale summary
  - evidence
  - assumptions and remaining uncertainty
  - confidence

This gives high transparency for decision quality without relying on private reasoning text.

## Team Delegation Policy

- Both models are explicitly allowed to spawn internal specialist teams at any point.
- Delegation is surfaced in output under `Team Delegations` or `Team Delegations Used`.
- Typical role set:
  - Research
  - Product/GTM
  - Engineering/Architecture
  - Risk/Compliance

This keeps the loop flexible without changing the transport protocol.

## Context Compaction Policy

- The broker compacts context automatically to support long-running sessions.
- Triggers:
  - interval trigger: every `--memory-compact-interval` rounds (default `4`)
  - size trigger: when estimated context exceeds `--memory-max-chars` (default `7000`)
- Compaction is co-authored:
  1. Codex drafts compacted memory.
  2. Claude approves/revises.
  3. Codex finalizes if needed.
- Result is persisted in transcript under `Compacted Context Memory`.

## Quick Start

From `D:\Projects\Agent Conductor`:

1. Verify prerequisites:
```powershell
npm run dialogue:consensus -- --verify-only
```

2. Ensure both CLIs are authenticated once:
```powershell
codex login
claude login
```

3. Start broker (Terminal A):
```powershell
npm run dialogue:consensus:broker
```

Notes:
- Broker runs Claude `/init` first in the current directory by default.
- Use `-- --no-claude-init` only if you intentionally want to skip it.

4. Submit a question (Terminal B):
```powershell
npm run dialogue:consensus:ask -- --question "What is the best go-to-market plan for Agent Conductor?"
```

5. Watch runtime events (Terminal C, optional):
```powershell
Get-Content .data\consensus-bus\events.jsonl -Wait
```

6. Read final output:
- `.data/consensus-bus/transcript.md`

## Optional Direct Run (No Broker Queue)

```powershell
npm run dialogue:consensus -- --question "Your question here"
```

## Operational Notes

- Poll interval defaults to `1000ms` (`--poll-ms` to change).
- Broker dedupes questions by `id` via `state.json`.
- Keep `questions.jsonl` append-only.
- Current known warning in this build:
  - Node `[DEP0190]` warning due to `shell: true` child process invocation on Windows.

## Retrospective Hooks

When iterating this protocol, capture:

- median question latency (start to completion)
- failure modes (`QUESTION_FAILED` reasons)
- consensus revision frequency (how often draft is rejected/edited)
- transcript quality drift over long sessions

These directly map to Agent Conductor product improvements for traceability, convergence UX, and orchestration reliability.
