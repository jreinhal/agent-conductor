<!-- bounce-protocol: 0.1 -->
<!-- created: 2026-02-18T10:00:00Z -->
<!-- session-id: a1b2c3d4-e5f6-7890-abcd-ef1234567890 -->

# Bounce Session: Single Entry Test

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

Test session with a single entry.

## Dialogue

<!-- entry: f47ac10b-58cc-4372-a567-0e02b2c3d479 -->
<!-- turn: 1 round: 1 -->
2026-02-18T10:01:30Z [author: reviewer] [status: yield]
stance: approve
confidence: 0.85
summary: Everything looks good.
action_requested: n/a
evidence: n/a

The code is well-structured and follows best practices.

<!-- yield -->
