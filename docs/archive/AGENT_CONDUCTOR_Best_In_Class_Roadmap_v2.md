# AGENT CONDUCTOR — Best-In-Class Roadmap (v2 Reset)

**Date:** 2026-02-23
**Status:** Reset and rebuilt from current implementation baseline.
**Owner:** Agent Conductor Team

---

## 1. Objective

Define a realistic path from current product state to market-ready best-in-class execution.

## 2. Source of Truth

This roadmap must only claim states that are verifiable in code, tests, and shipped UX.

Primary references:
- `D:\Projects\Agent Conductor\README.md`
- `D:\Projects\Agent Conductor\docs\protocol\bounce-v0.1.md`
- `D:\Projects\Agent Conductor\docs\protocol\codex-claude-consensus-broker-v0.1.md`
- `D:\Projects\Agent Conductor\docs\market-readiness-refinement-log.md`

## 3. Current Baseline (To Validate)

### Already Implemented
- [ ] Multi-provider model support and orchestration
- [ ] Debate/consensus UI and traceability
- [ ] Protocol parser/serializer/validator/watcher stack
- [ ] Desktop packaging pipeline
- [ ] External Codex↔Claude consensus broker

### In Progress
- [ ] UX polish pass: readability, state clarity, transitions, action hierarchy
- [ ] File exploration/context workflow for debating local artifacts
- [ ] Go-to-market packaging and pricing clarity

### Not Started / Needs Confirmation
- [ ] Final onboarding and first-run experience
- [ ] Production observability dashboard and reliability SLAs
- [ ] Billing enforcement and subscription controls

## 4. Prioritized Workstreams

### Workstream A: Product Clarity + UX Reliability
- Make debate state unmistakable: running, waiting, blocked, complete.
- Remove clipping/overflow defects.
- Add deterministic progress feedback for long-running model steps.

### Workstream B: Protocol + Agent Runtime Hardening
- Strengthen timeout/retry strategy.
- Add richer broker event diagnostics.
- Expand regression tests around protocol edge-cases and concurrency.

### Workstream C: Market Readiness
- Lock packaging narrative and in-app plan visibility.
- Finalize launch-ready desktop release checklist.
- Establish evidence-backed competitive differentiation.

## 5. 30-Day Execution Frame

### Week 1
- Re-verify baseline claims and convert to pass/fail checklist.
- Fix critical UI clarity gaps and active-state visibility.

### Week 2
- Harden protocol/broker runtime (timeouts, retries, failure surfacing).
- Expand automated tests for protocol + consensus workflows.

### Week 3
- Finalize monetization UX and launch messaging.
- Complete desktop release readiness pass.

### Week 4
- Dry-run launch operations.
- Resolve final blockers and publish release candidate criteria.

## 6. Metrics

- Debate completion rate
- Median time-to-consensus
- Failure rate by step (init, initial, compare, review, merge)
- UI defect escape rate
- Setup-to-first-success time

## 7. Decision Log

- 2026-02-23: Roadmap reset. Legacy roadmap content superseded due to stale assumptions.

## 8. Update Rules

- Every roadmap claim must map to a file, test, or reproducible run artifact.
- No "implemented" status without verification evidence.
- Weekly timestamped changelog required.

