# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Start Next.js dev server (http://localhost:3000)
- `npm run build` — Production build (standalone output for Electron)
- `npm run lint` — ESLint
- `npm run electron:dev` — Run as desktop app (concurrent Next.js + Electron)
- `npm run dist` — Build desktop installer via electron-builder

### Testing

- `npm test` — Run all unit tests (Vitest)
- `npx vitest run tests/path/to/file.test.ts` — Run a single test file
- `npx vitest run -t "test name"` — Run tests matching a name pattern
- `npm run test:watch` — Vitest in watch mode
- `npm run test:coverage` — Unit tests with v8 coverage (reports on `lib/**/*.ts`)
- `npm run test:stress` — Stress tests only (`tests/stress/`)
- `npm run test:stress:live:soak:smoke` — Serial Playwright soak (3 repeats, smoke scenarios)
- `npm run test:stress:live:soak:full` — Serial Playwright soak (2 repeats, all scenarios)

Unit tests: Vitest (globals enabled, node environment), config in `vitest.config.ts`, tests in `tests/**/*.test.ts`.
E2E tests: Playwright (12-min timeout per test, serial execution), config in `playwright.config.ts`, tests in `tests/e2e/`. Playwright auto-starts the dev server. Live CLI E2E tests require `LIVE_CLI_E2E=1` env var.

## Architecture

Multi-LLM orchestration platform. Users run prompts against multiple AI models in parallel, compare responses side-by-side, and run structured debates between models with consensus scoring.

**Stack**: Next.js 16 (App Router, standalone output), React 19, TypeScript (strict), Tailwind CSS 4, Zustand 5, Vercel AI SDK, Electron 40.

### Data Flow

User input → Zustand store → `ChatPanel` (uses `useChat` from `@ai-sdk/react`) → `POST /api/chat` → Vercel AI SDK `streamText()` → provider API (OpenAI, Anthropic, Google, xAI, Ollama) → streamed back to UI.

Debate flow: `BounceController` → `BounceOrchestrator` (event-driven state machine with states: idle → running → paused/complete/error/stopped) → `POST /api/bounce` per participant per round → consensus analysis via similarity scoring → judge synthesis.

Auto-routing: When `@auto-router` is selected, `decision-router.ts` scores the prompt for coding intent, deep reasoning, speed preference, and factual precision, then picks the best model deterministically.

### Key Directories

- **`app/`** — Single-page app at `/`. API routes: `/api/chat` (streaming chat), `/api/bounce` (debate rounds), `/api/provider-status` (health check), `/api/decision-trace` (auto-routing details), `/api/model-dialogue`, `/api/protocol-board` (protocol session interface), `/api/session-insights`.
- **`components/`** — `SmartInput` (command input with `@model`, `$persona`, `#workflow`, `/command` prefixes + PII detection), `ChatPanel` (per-model streaming chat), `BounceController`/`BouncePanel` (debate orchestration UI), `Canvas` (freeform draggable layout with physics), `ResizablePanels` (grid layout).
- **`lib/`** — Core logic. `store.ts` (Zustand), `ai.ts` (provider init), `models.ts` (10 static models across 4 providers + `auto-router`), `model-registry.ts` (dynamic fetcher with 5-min TTL cache for OpenAI/Anthropic/Google/xAI/Ollama), `personas.ts` (8 personas including repo-trained variants), `workflows.ts` (5 persona chains), `bounce-orchestrator.ts` (debate state machine with observer pattern), `consensus-analyzer.ts` (Jaccard + bigram similarity + stance alignment), `guardrails.ts` (PII detection/redaction), `db.ts` (localStorage in browser, SQLite in Electron), `decision-router.ts` (deterministic auto-routing by prompt scoring), `simple-circuit-breaker.ts` (closed/open/half_open with configurable failure threshold and cooldown).
- **`lib/coordination/`** — `consensus.ts` (consensus detection: majority/weighted/unanimous modes, defer-stance exclusion) and `turn-coordinator.ts` (EventEmitter-based turn state machine supporting round-robin, free-form, and supervised turn ordering with timeout escalation).
- **`lib/protocol/`** — Bounce Protocol v0.1 implementation: `parser.ts` (regex-based markdown parser, never throws), `validator.ts` (structural/semantic validation), `serializer.ts` (append-only markdown output with file locking), `lock.ts` (`proper-lockfile` wrapper for cross-process file locking), `watcher.ts` (chokidar-based file watcher with SHA-256 dedup and debounce), `types.ts` (protocol enums and interfaces).
- **`lib/adapters/`** — `registry.ts` (adapter registry with `register`/`get`/`list`/`discoverAvailable`), `claude-code-adapter.ts` (detects and shells out to `claude` CLI), `mock-adapter.ts` (for testing). `createDefaultRegistry()` factory pre-loads Claude Code.
- **`electron/`** — `main.js` spawns standalone Next.js server on a dynamic port, creates BrowserWindow, system tray, auto-updates.
- **`scripts/`** — `build-desktop.js` (Next.js build + asset copy + electron-builder), `codex-claude-dialogue.mjs` / `dual-research-consensus.mjs` / `consensus-submit-question.mjs` (CLI consensus broker tools).
- **`tests/`** — Unit tests (`*.test.ts`), E2E (`e2e/`), stress tests (`stress/`), plus `adapters/`, `coordination/`, `protocol/`, `services/`, `hooks/` subdirs.

### SmartInput Commands

Users type prefixes in the input to trigger features:
- `@model` — Select a model (e.g., `@gpt-5.2`, `@claude-opus-4.6`)
- `$persona` — Select a persona (e.g., `$security-auditor`, `$market-polish-lead`)
- `#workflow` — Start a workflow (e.g., `#security-audit-chain`)
- `/synthesize` — Create judge to synthesize all responses
- `/clear` — Remove all active models
- `/grid` — Switch to grid layout
- `/freeform` — Switch to freeform canvas layout

### State Management

Zustand store in `lib/store.ts`. **Persisted** to localStorage: `sharedContext`, `sharedKnowledge`, `workflow.customWorkflows`. **In-memory only**: sessions, bounce state, bounceHistory, selectedParticipants, bounceConfig, all UI state, activeWorkflow. Electron uses SQLite via `lib/db.ts` as an alternative persistence backend.

### AI Providers

Configured in `lib/ai.ts` via Vercel AI SDK. Static models in `lib/models.ts`: OpenAI (gpt-5.3-codex, gpt-5.2), Anthropic (claude-sonnet-4.5, claude-opus-4.5, claude-opus-4.6, claude-haiku-4.5), Google (gemini-3-pro, gemini-3-flash), plus `auto-router` (local deterministic). Dynamic registry in `lib/model-registry.ts` fetches live model lists from OpenAI, Anthropic, Google, xAI, and Ollama APIs with 5-minute TTL caching. API keys come from `.env.local` (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `XAI_API_KEY`, optional `OLLAMA_BASE_URL`).

### Patterns

- **Streaming**: All AI responses use Vercel AI SDK `streamText()` → `DataStreamResponse`.
- **Styling**: Tailwind utility classes inline. Lucide React for icons. Dark mode via CSS media queries.
- **Path alias**: `@/*` maps to project root.
- **Error classification**: `ErrorCode` enum in `lib/types.ts`: `RATE_LIMIT`, `INVALID_API_KEY`, `NETWORK_ERROR`, `PROVIDER_ERROR`, `TIMEOUT`, `UNKNOWN`. `APIError` includes `retryable` flag.
- **Resilience**: `simple-circuit-breaker.ts` — 3-failure threshold, 45s cooldown, transitions closed → open → half_open → closed.
- **Security**: `lib/guardrails.ts` scans for PII before sending to models. `lib/audit-log.ts` logs security events.
- **next.config.ts**: `output: 'standalone'`, `typescript.ignoreBuildErrors: true`, no-cache headers on all responses.
