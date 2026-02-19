<!-- bounce-protocol: 0.1 -->
<!-- created: 2026-02-18T10:00:00Z -->
<!-- session-id: aabb1122-ccdd-3344-eeff-556677889900 -->

# Bounce Session: Duplicate Entry IDs

## Protocol Rules

```yaml
agents:
  - agent-a
  - agent-b
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

This session has two entries with the same UUID.

## Dialogue

<!-- entry: deadbeef-1234-5678-9abc-def012345678 -->
<!-- turn: 1 round: 1 -->
2026-02-18T10:01:00Z [author: agent-a] [status: yield]
stance: approve
confidence: 0.7
summary: First entry.
action_requested: n/a
evidence: n/a

This is the first entry.

<!-- yield -->

<!-- entry: deadbeef-1234-5678-9abc-def012345678 -->
<!-- turn: 2 round: 1 -->
2026-02-18T10:02:00Z [author: agent-b] [status: yield]
stance: reject
confidence: 0.6
summary: Second entry with duplicate ID.
action_requested: n/a
evidence: n/a

This entry has the same UUID as the first one.

<!-- yield -->
