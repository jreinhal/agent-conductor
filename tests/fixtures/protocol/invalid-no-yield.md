<!-- bounce-protocol: 0.1 -->
<!-- created: 2026-02-18T10:00:00Z -->
<!-- session-id: abcdefab-1234-5678-9abc-def012345678 -->

# Bounce Session: Missing Yield Marker

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

This session has an entry without a yield marker.

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
