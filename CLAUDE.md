# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Start Next.js dev server (http://localhost:3000)
- `npm run build` — Production build (standalone output for Electron)
- `npm run lint` — ESLint
- `npm run electron:dev` — Run as desktop app (concurrent Next.js + Electron)
- `npm run dist` — Build desktop installer via electron-builder

No test framework is configured.

## Architecture

Multi-LLM orchestration platform. Users run prompts against multiple AI models in parallel, compare responses side-by-side, and run structured debates between models with consensus scoring.

**Stack**: Next.js 16 (App Router, standalone output), React 19, TypeScript (strict), Tailwind CSS 4, Zustand 5, Vercel AI SDK, Electron 40.

### Data Flow

User input → Zustand store → `ChatPanel` (uses `useChat` from `@ai-sdk/react`) → `POST /api/chat` → Vercel AI SDK `streamText()` → provider API (OpenAI, Anthropic, Google, xAI, Ollama) → streamed back to UI.

Debate flow: `BounceController` → `BounceOrchestrator` (event-driven state machine) → `POST /api/bounce` per participant per round → consensus analysis via similarity scoring → judge synthesis.

### Key Directories

- **`app/`** — Pages and API routes. Single-page app at `/`. API routes: `/api/chat` (streaming chat), `/api/bounce` (debate rounds), `/api/provider-status`.
- **`components/`** — React components. Key ones: `SmartInput` (command input with `@model`, `$persona`, `#workflow`, `/command` prefixes + PII detection), `ChatPanel` (per-model streaming chat), `BounceController`/`BouncePanel` (debate orchestration UI), `Canvas` (freeform draggable layout with physics), `ResizablePanels` (grid layout).
- **`lib/`** — Core logic. `store.ts` (Zustand with localStorage persist), `ai.ts` (provider initialization), `models.ts` (model registry — 24 models across 5 providers), `personas.ts` (4 built-in personas with system prompts), `workflows.ts` (persona chains), `bounce-orchestrator.ts` (debate state machine with observer pattern), `consensus-analyzer.ts` (Jaccard + bigram similarity), `guardrails.ts` (PII detection/redaction), `db.ts` (localStorage in browser, SQLite in Electron).
- **`electron/`** — `main.js` spawns standalone Next.js server on a dynamic port, creates BrowserWindow, system tray, auto-updates.
- **`scripts/`** — `build-desktop.js` orchestrates Next.js build + asset copy + electron-builder packaging.

### State Management

Zustand store in `lib/store.ts`. Persists custom workflows and shared context to localStorage. Sessions (chat history per model), UI state, and bounce/debate state are in-memory only. Electron uses SQLite via `lib/db.ts` as an alternative backend.

### AI Providers

Configured in `lib/ai.ts` via Vercel AI SDK. xAI uses OpenAI-compatible endpoint. Ollama for local models. API keys come from `.env.local` (see `.env.local.example`).

### Patterns

- **Streaming**: All AI responses use Vercel AI SDK `streamText()` → `DataStreamResponse`.
- **Styling**: Tailwind utility classes inline. Lucide React for icons. Dark mode via CSS media queries.
- **Path alias**: `@/*` maps to project root.
- **Error classification**: API errors typed as `RATE_LIMIT`, `INVALID_API_KEY`, `NETWORK_ERROR`, `CONTEXT_TOO_LONG`, etc. in `lib/types.ts`.
- **Security**: `lib/guardrails.ts` scans for PII before sending to models. `lib/audit-log.ts` logs security events.
- **next.config.ts**: `output: 'standalone'` and `typescript.ignoreBuildErrors: true`.
