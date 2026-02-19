<!-- bounce-protocol: 0.1 -->
<!-- created: 2026-02-18T10:00:00Z -->
<!-- session-id: 11223344-5566-7788-99aa-bbccddeeff00 -->

# Bounce Session: Confidence Out of Range

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

This session has an entry with confidence exceeding 1.0.

## Dialogue

<!-- entry: ffeeddcc-bbaa-9988-7766-554433221100 -->
<!-- turn: 1 round: 1 -->
2026-02-18T10:01:00Z [author: perf-analyst] [status: yield]
stance: approve
confidence: 1.5
summary: Database queries are the primary bottleneck.
action_requested: n/a
evidence: perf/checkout-profile.json

The checkout flow spends 80% of its time in database queries.

<!-- yield -->
