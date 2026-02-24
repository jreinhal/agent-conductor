# AGENT CONDUCTOR - Tech Stack

Date: 2026-02-23
Source of truth: current repository state at `D:\Projects\Agent Conductor`

## 1) Product Runtime Targets

- Desktop app: Electron (`electron/main.js`) hosting Next.js standalone output.
- Web app: Next.js App Router (`app/`).
- Local orchestration scripts: Node.js `.mjs` scripts under `scripts/`.

## 2) Core Language and Frameworks

- TypeScript (`typescript`), JavaScript (Node scripts + Electron main process).
- React 19 (`react`, `react-dom`).
- Next.js 16 (`next`), App Router architecture.
- Vercel AI SDK stack:
  - `ai`
  - `@ai-sdk/react`
  - `@ai-sdk/openai`
  - `@ai-sdk/anthropic`
  - `@ai-sdk/google`

## 3) Frontend / UX Stack

- Styling: Tailwind CSS v4 (`tailwindcss`, `@tailwindcss/postcss`) + app CSS.
- Icons: `lucide-react`.
- Fonts: `next/font/google` (Space Grotesk, JetBrains Mono).
- UI architecture: component-driven panels (`components/`), including debate, trace, protocol board, settings, file explorer, and terminal dock.

## 4) State Management and Client Persistence

- Zustand (`zustand`) with persistence middleware.
- Local browser persistence via `localStorage` for selected app state.
- Shared context and shared knowledge maintained in store (`lib/store.ts`).

## 5) AI Model and Routing Layer

- Provider adapters configured in `lib/ai.ts`:
  - OpenAI
  - Anthropic
  - Google
  - xAI via OpenAI-compatible endpoint
- Model catalog in `lib/models.ts`.
- Auto-routing and fallback strategy:
  - deterministic heuristic routing (`lib/decision-router.ts`)
  - trace persistence (`lib/decision-trace-store.ts`)
  - circuit breaker (`lib/simple-circuit-breaker.ts`)

## 6) Debate / Protocol / Orchestration Stack

- In-app multi-model debate orchestration (Bounce state machine and UI).
- Bounce Protocol v0.1 implementation:
  - parser (`lib/protocol/parser.ts`)
  - serializer (`lib/protocol/serializer.ts`)
  - validator (`lib/protocol/validator.ts`)
  - file watcher (`lib/protocol/watcher.ts`, chokidar-based)
  - file lock wrapper (`lib/protocol/lock.ts`, proper-lockfile-based)
- External CLI consensus broker:
  - `scripts/dual-research-consensus.mjs`
  - file bus: `questions.jsonl`, `events.jsonl`, `state.json`, `transcript.md`
  - Codex/Claude CLI orchestration with structured consensus workflow
  - context compaction and delegation-aware prompting

## 7) Desktop and Distribution

- Electron runtime (`electron`).
- Packaging/build: `electron-builder`.
- Auto-update integration: `electron-updater`.
- Local desktop config persistence: `electron-store`.
- Standalone Next build consumed by Electron:
  - `next.config.ts` uses `output: 'standalone'`.

## 8) Data and Storage

- Decision trace store: JSON file under `.data/`.
- Protocol/broker transcripts and event logs: `.data/consensus-bus/`.
- Database abstraction in `lib/db.ts`:
  - localStorage fallback path implemented
  - SQLite path references `better-sqlite3` at runtime in Electron code path
  - note: verify `better-sqlite3` install in deployment environment.

## 9) API / Backend Endpoints

- Chat endpoint: `app/api/chat/route.ts` (`maxDuration = 300`).
- Debate endpoint: `app/api/bounce/route.ts` (`maxDuration = 120`).
- Model dialogue endpoint exists under `app/api/model-dialogue/`.
- Streaming responses and routing traces are integrated in API flow.

## 10) Security and Reliability Controls

- PII scan and redaction utility (`lib/guardrails.ts`).
- Audit logging utility (`lib/audit-log.ts`).
- Circuit breaker and fallback attempts in model execution path.
- Timeout controls and quality-guard checks in routing and CLI orchestration.

## 11) Testing and QA Tooling

- Unit/integration tests: Vitest (`vitest`, `@vitest/coverage-v8`).
- E2E/live stress testing: Playwright (`@playwright/test`), including CLI live scenarios.
- Linting: ESLint (`eslint`, `eslint-config-next`).

## 12) Build and Dev Tooling

- `concurrently`, `wait-on`, `cross-env` for local orchestration.
- Desktop build script: `scripts/build-desktop.js`.
- Additional diagnostics/eval scripts in `scripts/`:
  - handoff freshness
  - quality eval
  - codex-claude dialogue
  - consensus broker and question submitter

## 13) External CLI Integrations (Current)

- Codex CLI
- Claude CLI
- Gemini CLI (adapter path in `lib/cli-chat.ts`)

These are used for local CLI-based orchestration workflows outside the in-app provider API path.

