# Agent Conductor — Developer Testing Guide

A practical, end-to-end testing playbook covering automated tests, manual UI verification, API checks, and Electron desktop validation.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Automated Tests](#2-automated-tests)
3. [Manual UI Testing — Core Layout](#3-manual-ui-testing--core-layout)
4. [Manual UI Testing — SmartInput](#4-manual-ui-testing--smartinput)
5. [Manual UI Testing — Chat & Streaming](#5-manual-ui-testing--chat--streaming)
6. [Manual UI Testing — Bounce / Debate](#6-manual-ui-testing--bounce--debate)
7. [Manual UI Testing — Consensus & Scoring](#7-manual-ui-testing--consensus--scoring)
8. [Manual UI Testing — Debate Replay](#8-manual-ui-testing--debate-replay)
9. [Manual UI Testing — Settings Modal](#9-manual-ui-testing--settings-modal)
10. [Manual UI Testing — Session History & Export](#10-manual-ui-testing--session-history--export)
11. [Manual UI Testing — First-Run Wizard](#11-manual-ui-testing--first-run-wizard)
12. [Manual UI Testing — Decision Trace (Auto-Router)](#12-manual-ui-testing--decision-trace-auto-router)
13. [Manual UI Testing — Protocol Board](#13-manual-ui-testing--protocol-board)
14. [Manual UI Testing — PII Guardrails](#14-manual-ui-testing--pii-guardrails)
15. [Manual UI Testing — Keyboard Shortcuts](#15-manual-ui-testing--keyboard-shortcuts)
16. [Electron Desktop Testing](#16-electron-desktop-testing)
17. [API Route Smoke Tests](#17-api-route-smoke-tests)
18. [Regression Checklist](#18-regression-checklist)
19. [Known Issues / Hotfix Queue](#19-known-issues--hotfix-queue)

---

## 1. Prerequisites

### Environment

- Node.js 20+
- API keys in `.env.local`: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` (at least one required; all recommended for full coverage)
- Optional: `XAI_API_KEY`, `OLLAMA_BASE_URL` (for xAI / Ollama models)

### Start Dev Server

```bash
npm run dev
```

Open http://localhost:3000 in Chrome/Edge (Chromium recommended for DevTools).

---

## 2. Automated Tests

Run these before any manual testing to confirm the codebase is healthy.

Latest verified baseline (local run on 2026-02-23):
- `22` test files
- `326` tests
- all passing

### 2a. Unit Tests (Vitest)

| Command | What it runs |
|---|---|
| `npm test` | All 22 test files (~326 tests) |
| `npm run test:watch` | Watch mode (re-runs on file change) |
| `npm run test:coverage` | Coverage report (v8, `lib/**/*.ts`) |
| `npx vitest run tests/bounce-structured-response.test.ts` | Single file |
| `npx vitest run -t "cosine similarity"` | Tests matching a name pattern |

**Expected**: All tests pass with 0 failures.

### Test file inventory

| Area | File | Tests |
|---|---|---|
| Structured bounce responses | `tests/bounce-structured-response.test.ts` | 13 |
| TF-IDF cosine similarity | `tests/consensus-tfidf.test.ts` | 10 |
| Export utilities | `tests/export-utils.test.ts` | 5 |
| Phase 5 tag-in + replay | `tests/phase5-tag-in-replay.test.ts` | 8 |
| Decision router | `tests/decision-router.test.ts` | — |
| Circuit breaker | `tests/simple-circuit-breaker.test.ts` | — |
| CLI chat | `tests/cli-chat.test.ts` | — |
| Adapters | `tests/adapters/*.test.ts` | — |
| Coordination (consensus, turns, influence) | `tests/coordination/*.test.ts` | — |
| Protocol (parser, validator, serializer, lock, watcher) | `tests/protocol/*.test.ts` | — |
| Services (agent manager) | `tests/services/agent-manager.test.ts` | — |
| Stress | `tests/stress/four-terminal-resolution.test.ts` | — |

### 2b. E2E Tests (Playwright)

```bash
# Requires LIVE_CLI_E2E=1 and running API keys
npm run test:stress:live:soak:smoke   # 3 repeats, smoke scenarios
npm run test:stress:live:soak:full    # 2 repeats, all scenarios
```

These auto-start the dev server and run browser-based tests with 12-min timeout.

### 2c. Lint + Build

```bash
npm run lint       # ESLint — expect 0 errors
npm run build      # Next.js production build — expect clean exit
```

---

## 3. Manual UI Testing — Core Layout

### 3a. Header Bar

| # | Step | Expected |
|---|---|---|
| 1 | Load page | Header shows "Agent Conductor" title, layout toggle, settings gear, history clock icon |
| 2 | Click layout toggle (`grid`, `resizable`, `freeform`) | Layout switches correctly across all 3 modes |
| 3 | Verify responsive | Shrink browser to 768px width — panels stack vertically, input stays at bottom |

### 3b. Layout Modes

| # | Step | Expected |
|---|---|---|
| 1 | Use header toggle to select `grid` | Panels render in grid layout |
| 2 | Use header toggle to select `resizable` | Panels render in resizable split layout |
| 3 | Use header toggle to select `freeform` | Panels render on draggable canvas |
| 4 | In freeform mode, drag a model panel | Panel moves freely on canvas |
| 5 | Switch back to grid | Panels snap back to grid positions |

Note: SmartInput currently suggests `/grid` and `/freeform`, but those command actions are not wired to layout state.

### 3c. Empty State

| # | Step | Expected |
|---|---|---|
| 1 | No models selected | Main area shows placeholder/empty state |
| 2 | Select a model via `@model` | ChatPanel appears for that model |

---

## 4. Manual UI Testing — SmartInput

SmartInput is the command bar at the bottom of the screen. It supports prefix-triggered autocomplete.

### 4a. Model Selection

| # | Step | Expected |
|---|---|---|
| 1 | Type `@` | Autocomplete dropdown shows all available models |
| 2 | Type `@gpt` | Filters to GPT models |
| 3 | Select `@gpt-5.2` | Model added to active sessions, ChatPanel appears |
| 4 | Select a second model (e.g. `@claude-opus-4.6`) | Second ChatPanel appears side-by-side |
| 5 | Select `@auto-router` | Auto-router pseudo-model added |

### 4b. Persona Selection

| # | Step | Expected |
|---|---|---|
| 1 | Type `$` | Autocomplete shows 8 personas |
| 2 | Select `$security-auditor` | Persona applied (system prompt changes) |
| 3 | Send a message | Response reflects persona tone/expertise |

### 4c. Workflow Selection

| # | Step | Expected |
|---|---|---|
| 1 | Type `#` | Autocomplete shows 5 workflows |
| 2 | Select `#security-audit-chain` | Workflow starts, persona chain auto-progresses |

### 4d. Slash Commands

| # | Step | Expected |
|---|---|---|
| 1 | Type `/synthesize` | Judge synthesis triggers across all active model responses |
| 2 | Type `/clear` | All active models removed, panels cleared |
| 3 | Type `/grid` or `/freeform` | Suggestion appears, but no layout change (known current behavior) |

### 4e. PII Warning

| # | Step | Expected |
|---|---|---|
| 1 | Type a message containing `my SSN is 123-45-6789` | PII warning appears before send |
| 2 | Confirm send | Message goes through (redacted or with user consent) |
| 3 | Cancel | Message not sent |

---

## 5. Manual UI Testing — Chat & Streaming

### 5a. Single Model Chat

| # | Step | Expected |
|---|---|---|
| 1 | Select `@gpt-5.2`, type "Hello", Enter | Response streams token-by-token in ChatPanel |
| 2 | While streaming | Loading indicator visible, input disabled |
| 3 | After stream completes | Full response visible, input re-enabled |
| 4 | Send follow-up message | Conversation context maintained |

### 5b. Multi-Model Parallel

| # | Step | Expected |
|---|---|---|
| 1 | Select 2+ models | Multiple ChatPanels visible |
| 2 | Type message, Enter | Message sent to ALL active models simultaneously |
| 3 | Responses stream independently | Each panel shows its own streaming response |
| 4 | Compare responses side-by-side | Both visible in grid layout |

### 5c. Error Handling

| # | Step | Expected |
|---|---|---|
| 1 | Remove API key from `.env.local`, restart, send message | Error message shown in ChatPanel (not a crash) |
| 2 | Restore key, send again | Recovery — response streams normally |

---

## 6. Manual UI Testing — Bounce / Debate

This is the core differentiating feature. Test thoroughly.

### 6a. Starting a Debate

| # | Step | Expected |
|---|---|---|
| 1 | Select 2+ models | BounceController shows "Start Debate" as primary CTA |
| 2 | Enter a topic in the bounce topic field | Topic text visible |
| 3 | With <2 models selected | Start button disabled, tooltip: "Select at least 2 models and enter a topic" |
| 4 | Click "Start Debate" with valid setup | Debate begins, status badge shows "Running" |

### 6b. Debate in Progress

| # | Step | Expected |
|---|---|---|
| 1 | Observe status badge | Shows current state (running, paused, etc.) |
| 2 | Observe heartbeat indicator | Green dot (<10s), amber (10-30s), red (>30s) next to activity text |
| 3 | Observe gate-reason line | Text explains current state (e.g., "Models are responding") |
| 4 | Round counter increments | "Round 1/N" updates as rounds complete |
| 5 | Each participant responds | Response cards appear with model name, stance badge, confidence % |

### 6c. Debate Controls

| # | Step | Expected |
|---|---|---|
| 1 | Click "Pause" during running debate | Status changes to "Paused", gate-reason: "Debate paused by user" |
| 2 | Click "Resume" | Debate continues from where it paused |
| 3 | Click "Judge Now" | Immediately triggers judge synthesis (skips remaining rounds) |
| 4 | Click "Stop" | Debate ends without judge synthesis |

### 6d. Auto-Bounce

| # | Step | Expected |
|---|---|---|
| 1 | Enable auto-bounce in Settings > Appearance | Toggle shown and persisted |
| 2 | Have 2+ models active, type a question in SmartInput | Bounce triggers automatically instead of individual chats |
| 3 | Debate runs to completion | BouncePanel slides in with results |

### 6e. Specialist Tag-In

| # | Step | Expected |
|---|---|---|
| 1 | During a running debate, click the tag-in button (UserPlus icon) | Specialist picker appears |
| 2 | Picker shows available models/personas NOT already in debate | Already-participating models filtered out |
| 3 | Select a specialist | `PARTICIPANT_TAGGED_IN` event fires, new participant appears in config |
| 4 | Try adding same specialist again | Duplicate prevented (no second add) |
| 5 | While sequential round is active, tag in specialist | Verify whether specialist joins current round vs next round; log actual behavior and trace |

### 6f. Convergence Exit

| # | Step | Expected |
|---|---|---|
| 1 | Start debate where models quickly agree | Debate exits early (before maxRounds) when consensus stabilizes |
| 2 | Check Decision Trace | Convergence delta shown, exit reason logged |

### 6g. Structured Responses

| # | Step | Expected |
|---|---|---|
| 1 | Run a debate | Responses show clean confidence values (not regex-extracted) |
| 2 | Check response cards | Each shows: stance, confidence %, key points, critiques/concessions |
| 3 | Open Decision Trace | Structured JSON response visible for each participant |

---

## 7. Manual UI Testing — Consensus & Scoring

### 7a. Consensus Display

| # | Step | Expected |
|---|---|---|
| 1 | After debate completes | BouncePanel shows consensus score (0-100%) |
| 2 | Score color coding | Green (>70%), amber (40-70%), red (<40%) |
| 3 | Consensus outcome label | "Consensus Reached" / "Partial Agreement" / "No Consensus" |

### 7b. "Why This Score?" Card

| # | Step | Expected |
|---|---|---|
| 1 | Click "Why this score?" in BouncePanel | Expandable card opens |
| 2 | Shows breakdown | Vote score, similarity score, stability, weighted influence |
| 3 | Contribution waterfall | Bars showing each model's contribution with stance labels |

### 7c. Near-Tie Presentation

| # | Step | Expected |
|---|---|---|
| 1 | Run a debate where proposals are close in support | Near-tie threshold triggers |
| 2 | Dual-option UI appears | Shows both leading proposals with support ratios |
| 3 | Runner-up is labeled | Clear indication of lead vs. runner-up |

### 7d. Influence Waterfall

| # | Step | Expected |
|---|---|---|
| 1 | In BouncePanel after debate | Contribution waterfall visible |
| 2 | Each model shown with bar | Split bars showing weighted + unweighted contribution |
| 3 | Stance labels on bars | "agree", "disagree", "neutral", etc. |

---

## 8. Manual UI Testing — Debate Replay

### 8a. Starting Replay

| # | Step | Expected |
|---|---|---|
| 1 | Open Session History (clock icon) | Past debates listed under "Past Debates" |
| 2 | Hover over a past debate | Play button appears (desktop pointer interaction) |
| 3 | Click Play | DebateReplay slide-over opens from right |

### 8b. Replay Playback

| # | Step | Expected |
|---|---|---|
| 1 | Click Play button in controls | Responses appear one-by-one with fade animation |
| 2 | Progress bar advances | Shows "Round X/Y" and fills proportionally |
| 3 | Click Pause | Playback stops |
| 4 | Click Skip Forward | Jumps to next round |
| 5 | Click Skip Back | Returns to previous round start |
| 6 | Change speed (0.5x, 1x, 2x, 4x) | Playback speed changes accordingly |
| 7 | At end of replay | Final synthesis card appears, playback auto-stops |
| 8 | Click Play at end | Replay restarts from beginning |

### 8c. Replay Content

| # | Step | Expected |
|---|---|---|
| 1 | Each response card shows | Model name, stance badge (colored), confidence %, duration, round number |
| 2 | Key points shown | Up to 3 key point chips per response |
| 3 | Consensus trend footer | Mini bar chart showing score trend across rounds |
| 4 | Close button (X) | Panel closes cleanly |

### 8d. Replay State & Accessibility

| # | Step | Expected |
|---|---|---|
| 1 | Open replay A, advance to later round, close, reopen same replay | Playback state should reset to start |
| 2 | Open replay A, then replay B | Replay should initialize from B (no stale position from A) |
| 3 | Press `Escape` while replay is open | Replay closes (verify keyboard path explicitly) |
| 4 | Keyboard-only navigate Session History | Replay action should remain discoverable and actionable |

---

## 9. Manual UI Testing — Settings Modal

### 9a. Opening Settings

| # | Step | Expected |
|---|---|---|
| 1 | Click gear icon in header | Settings modal opens |
| 2 | Tabs visible | Providers, Appearance, Data, Shortcuts |

### 9b. Appearance Tab

| # | Step | Expected |
|---|---|---|
| 1 | Auto-bounce toggle | Toggle on/off, persists across reload |
| 2 | Min models for auto-bounce | Number input, persists |

### 9c. Data Tab

| # | Step | Expected |
|---|---|---|
| 1 | Storage stats shown | Session count, message count, debate count |
| 2 | "Export JSON" button | Downloads `.json` file with sessions + debates |
| 3 | "Export Markdown" button | Downloads `.md` file with formatted history |

### 9d. Providers Tab

| # | Step | Expected |
|---|---|---|
| 1 | Open Providers tab | Provider cards render for OpenAI/Anthropic/Google/xAI/Ollama |
| 2 | Live status loaded | `API key set` / `No API key` appears per provider |
| 3 | Verify Access / Connect controls | External links open and pending/connected states update |

---

## 10. Manual UI Testing — Session History & Export

### 10a. Session History Panel

| # | Step | Expected |
|---|---|---|
| 1 | Click clock icon in header | Session History slides in from left |
| 2 | Summary bar | Shows count of sessions, messages, debates |
| 3 | "Active Sessions" section | Lists current sessions with message count + preview |
| 4 | "Past Debates" section | Lists completed debates with round count + consensus % |
| 5 | Click X on a session | Session removed from list |
| 6 | Click backdrop or X button | Panel closes |

### 10b. Export

| # | Step | Expected |
|---|---|---|
| 1 | Click "Export JSON" in history panel | Browser downloads `agent-conductor-export-{date}.json` |
| 2 | Click "Export Markdown" | Browser downloads `agent-conductor-export-{date}.md` |
| 3 | Open downloaded JSON | Contains `sessions` and `bounceHistory` arrays |
| 4 | Open downloaded Markdown | Readable formatted export |

### 10c. Clear History

| # | Step | Expected |
|---|---|---|
| 1 | Click trash icon | "Confirm / Cancel" appears |
| 2 | Click "Confirm" | All sessions and debates cleared |
| 3 | Click "Cancel" | Nothing cleared |

---

## 11. Manual UI Testing — First-Run Wizard

| # | Step | Expected |
|---|---|---|
| 1 | Clear localStorage (`localStorage.removeItem('agent-conductor-initialized')`) | — |
| 2 | Reload page | First-run wizard modal appears |
| 3 | Wizard shows provider status | Green check for configured providers, red X for missing |
| 4 | Each provider shows | Name, env var name, link to docs |
| 5 | Complete/dismiss wizard | `agent-conductor-initialized` set in localStorage |
| 6 | Reload page again | Wizard does NOT appear |

---

## 12. Manual UI Testing — Decision Trace (Auto-Router)

| # | Step | Expected |
|---|---|---|
| 1 | Select `@auto-router` model | Auto-router session created |
| 2 | Send a message | Message routed to best model automatically |
| 3 | Open Decision Trace panel | Shows routing decision details |
| 4 | Trace shows scoring | Coding intent, reasoning depth, speed preference, factual precision scores |
| 5 | Selected model shown | Which model was chosen and why |

---

## 13. Manual UI Testing — Protocol Board

| # | Step | Expected |
|---|---|---|
| 1 | Open Protocol Board panel | Panel opens |
| 2 | Protocol board data visible | Governance items render from `/api/protocol-board` store |
| 3 | Save/update action (if available in UI) | Persists via `PUT /api/protocol-board` |

---

## 14. Manual UI Testing — PII Guardrails

| # | Step | Expected |
|---|---|---|
| 1 | Type message with email: `send to john@example.com` | PII warning shown (email detected) |
| 2 | Type message with phone: `call me at 555-123-4567` | PII warning shown |
| 3 | Type message with SSN pattern: `SSN 123-45-6789` | PII warning shown |
| 4 | Type normal message: `explain recursion` | No PII warning |

---

## 15. Manual UI Testing — Keyboard Shortcuts

| # | Step | Expected |
|---|---|---|
| 1 | `Ctrl+K` / `Cmd+K` | Command palette opens |
| 2 | `Ctrl+\`` / `Cmd+\`` | Terminal dock toggles |
| 3 | `Enter` in SmartInput | Sends message |
| 4 | `Shift+Enter` in SmartInput | Newline (does not send) |
| 5 | `Tab` in SmartInput suggestions | Selects highlighted suggestion |
| 6 | `Escape` in SmartInput suggestions | Dismisses suggestions |
| 7 | `Escape` in Command Palette | Closes Command Palette |

---

## 16. Electron Desktop Testing

### Prerequisites

```bash
npm run electron:dev    # Dev mode (concurrent Next.js + Electron)
# OR
npm run dist            # Build installer
```

### 16a. App Launch

| # | Step | Expected |
|---|---|---|
| 1 | Run `npm run electron:dev` | Electron window opens, Next.js server starts on dynamic port |
| 2 | App loads in BrowserWindow | Full UI visible, no blank screen |
| 3 | Check DevTools (Ctrl+Shift+I) | No console errors on startup |

### 16b. System Tray

| # | Step | Expected |
|---|---|---|
| 1 | Close window (X button) | App minimizes to system tray (does not quit) |
| 2 | Click tray icon | Window restores |
| 3 | Right-click tray icon | Context menu with Quit option |

### 16c. Stdio Error Resilience

| # | Step | Expected |
|---|---|---|
| 1 | Run a debate in Electron | No crash from stdio pipe errors |
| 2 | Check Electron logs | `log.error` used for pipe errors, no unhandled exceptions |

### 16d. Persistence (Electron)

| # | Step | Expected |
|---|---|---|
| 1 | Create a session, close Electron | — |
| 2 | Reopen Electron | Session data persisted (via SQLite/localStorage) |

---

## 17. API Route Smoke Tests

These can be tested via browser DevTools Network tab, curl, or Postman.

### Routes

| Route | Method | Test |
|---|---|---|
| `/api/chat` | POST | Send `{ model, messages }` — expect streaming response |
| `/api/bounce` | POST | Send bounce round payload — expect model response |
| `/api/provider-status` | GET | Expect JSON: `{ openai: bool, anthropic: bool, google: bool, xai: bool, ollama: bool }` |
| `/api/decision-trace` | GET | Query trace entries (`?requestId=` / `?sessionId=` / `?limit=`) |
| `/api/decision-trace` | DELETE | Clear decision trace store |
| `/api/embed` | POST | Send `{ texts: ["hello"] }` — expect embeddings or 503 fallback |
| `/api/session-insights` | GET | Retrieve stored insight entries |
| `/api/session-insights` | POST | Send `{ note, metrics? }` — expect persisted insight entry |
| `/api/session-insights` | DELETE | Clear insight entries |
| `/api/protocol-board` | GET | Retrieve governance board items |
| `/api/protocol-board` | PUT | Persist `{ items: [...] }` payload |
| `/api/model-dialogue` | POST | Send dialogue payload — expect response |

### Quick curl for provider-status

```bash
curl http://localhost:3000/api/provider-status
```

Expected: `{"openai":true,"anthropic":true,"google":true,"xai":false,"ollama":false}` (varies by configured keys).

---

## 18. Regression Checklist

Run through this checklist after any significant change to confirm nothing broke.

- [ ] `npm test` — all tests pass
- [ ] `npm run lint` — 0 errors
- [ ] `npm run build` — clean build
- [ ] Page loads at http://localhost:3000 with no console errors
- [ ] First-run wizard appears on fresh localStorage
- [ ] Select 2+ models and send a message — both respond
- [ ] Start a debate with 2+ models — runs to completion
- [ ] Consensus score displayed after debate
- [ ] "Why this score?" card expands with breakdown
- [ ] Session History shows past debates
- [ ] Export JSON/Markdown downloads file
- [ ] Replay a past debate — playback works
- [ ] Replay state resets when switching sessions and when reopening replay
- [ ] Replay can be closed with keyboard `Escape`
- [ ] Settings modal opens and saves preferences
- [ ] Auto-router routes to correct model
- [ ] PII warning triggers on sensitive input
- [ ] Tag-in specialist during debate works
- [ ] Sequential tag-in behavior is deterministic and matches product expectation
- [ ] `/clear` removes all models
- [ ] Header layout toggle switches `grid` / `resizable` / `freeform`
- [ ] `Ctrl+K` opens command palette
- [ ] No TypeScript errors in build output

---

## 19. Known Issues / Hotfix Queue

Track these explicitly during QA until resolved:

- Replay drawer keyboard dismissal can be unreliable depending on focus path.
- Replay action in Session History is hover-first, which hurts keyboard discoverability.
- Specialist tag-in during sequential rounds can produce ambiguous current-round vs next-round behavior.
- Session persistence currently focuses on session shell/history; verify full transcript persistence separately on each pass.

---

*Last updated: 2026-02-23 (post-Phase-5 review pass)*
