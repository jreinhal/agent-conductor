<!-- bounce-protocol: 0.1 -->
<!-- created: 2026-02-18T10:00:00Z -->
<!-- session-id: 98765432-abcd-ef01-2345-6789abcdef01 -->

# Bounce Session: Invalid Stance Value

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

This session has an entry with an invalid stance value.

## Dialogue

<!-- entry: aabbccdd-1122-3344-5566-778899001122 -->
<!-- turn: 1 round: 1 -->
2026-02-18T10:01:00Z [author: tech-lead] [status: yield]
stance: maybe
confidence: 0.9
summary: Recommends React for the frontend.
action_requested: n/a
evidence: n/a

React is the best choice for this project.

<!-- yield -->
