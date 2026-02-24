# Repo-Trained Agent Profile

This document records the training signals imported from `D:\Projects\reference-repos` and how they were mapped into Agent Conductor personas/workflows.

## Source Signals

- `agents/_system/standards.md`
  - Team-style persona protocol: analyze -> plan -> implement -> verify.
  - Domain-specialized team naming (`Core Dev Team`, `Security Team`, `Ops Team`, `Data Team`, `K8s Team`).
- `agents/std-agent/template.md`
  - Structured prompt format for role, objective, context, capabilities, tools, and operational protocol.
- `agents/agent-skills/AGENTS.md`
  - Skill manifest conventions and context-efficiency guardrails.
- `skills/_clawhub/frontend-design-ultimate/SKILL.md`
  - Design-thinking flow, visual direction rules, and pre-implementation checklist for market-ready UI.
- `skills/antigravity-awesome-skills/skills/ui-ux-pro-max/SKILL.md`
  - Pre-delivery gates for accessibility, interaction quality, responsiveness, and visual polish.
- `benchmarks/*` and `tools/*`
  - Quality-gate mindset: explicit pass/fail thresholds, artifact-backed validation, and release go/no-go.

## Imported Personas

- `core-dev-team`
  - Repo-trained implementation strategy persona.
- `market-polish-lead`
  - Repo-trained UI/UX market-readiness persona.
- `revenue-ops-strategist`
  - Repo-trained pricing/packaging persona.
- `benchmark-gatekeeper`
  - Repo-trained release validation persona.

## Imported Workflows

- `market-readiness-sprint`
  - Revenue strategy -> UI polish -> implementation -> benchmark gate.
- `repo-trained-ui-polish`
  - Design polish -> implementation -> QA gate.
- `launch-go-no-go`
  - Security audit -> benchmark gate verdict.

## Operating Expectation

Use these workflows as the default chain for market-facing releases:

1. Define monetization and positioning.
2. Generate polished, differentiated UI direction.
3. Implement with low-regression engineering strategy.
4. Gate release with measurable pass/fail checks.
