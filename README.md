# Agent Conductor

A multi-agent orchestration platform for coordinating multiple AI models on complex tasks. Built as a desktop application with Electron and Next.js.

## Overview

Agent Conductor allows you to:

- **Run multiple AI models in parallel** - Compare responses from GPT-4, Claude, Gemini, and local models side-by-side
- **Use specialized personas** - Security auditors, architects, strategists, and QA engineers with pre-configured system prompts
- **Orchestrate workflows** - Chain personas together for multi-step analysis (e.g., Architecture Review → Security Audit)
- **Bounce between agents** - Pass context from one model to a specialist for deeper analysis
- **Synthesize decisions** - Use a "Judge" agent to reconcile conflicting perspectives and make final calls

## Features

### Multi-Provider Support

| Provider | Models |
|----------|--------|
| OpenAI | GPT-4o, GPT-4o Mini, o1 Preview, o1 Mini |
| Anthropic | Claude 3.5 Sonnet, Claude 3.5 Haiku, Claude 3 Opus |
| Google | Gemini 1.5 Pro, Gemini 1.5 Flash |
| xAI | Grok Beta |
| Local (Ollama) | Llama 3.1, DeepSeek R1 |

### Built-in Personas

- **Cipher** (Security Auditor) - Finds vulnerabilities, STIG compliance, OWASP Top 10
- **Architect** (Software Architect) - Reviews design patterns, SOLID principles, scalability
- **Strategist** (Product Strategist) - Evaluates UX, market fit, feature completeness
- **Quality** (QA Engineer) - Discovers edge cases, boundary testing, error handling

### Pre-built Workflows

- **Full Security Audit**: Architect → Security Auditor
- **Product Launch Prep**: Strategist → QA Engineer
- **Custom Workflows**: Build your own persona chains

### Safety Features

- **PII Detection** - Scans input for emails, phone numbers, SSNs, API keys, credit cards
- **Audit Logging** - Tracks security-relevant events for compliance
- **Guardrail Alerts** - Warns before sending sensitive data to AI models

## Installation

### Prerequisites

- Node.js 18+
- npm or yarn
- API keys for desired providers (OpenAI, Anthropic, Google, xAI)
- Ollama installed locally (optional, for local models)

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/your-org/agent-conductor.git
   cd agent-conductor
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create environment file:
   ```bash
   cp .env.local.example .env.local
   ```

4. Add your API keys to `.env.local`:
   ```env
   OPENAI_API_KEY=sk-...
   ANTHROPIC_API_KEY=sk-ant-...
   GOOGLE_GENERATIVE_AI_API_KEY=...
   XAI_API_KEY=...
   ```

5. Run the development server:
   ```bash
   npm run dev
   ```

6. Open [http://localhost:3000](http://localhost:3000)

## Desktop App

To build the desktop application:

```bash
# Build Next.js standalone
npm run build

# Package with Electron
npm run dist
```

The installer will be in the `dist/` folder.

## Usage

### Basic Multi-Model Comparison

1. Click model buttons in the header to activate them
2. Each active model gets its own chat window
3. Type the same prompt in each window to compare responses

### Using Personas

1. Click "Pass Baton" on any AI response
2. Select a specialist persona from the modal
3. The persona receives the context and applies its expertise

### Running Workflows

1. Select a workflow from the dropdown (e.g., "Full Security Audit")
2. Complete Step 1 with the first persona
3. System automatically advances to Step 2 with context injection

### Final Decision Maker

1. Have multiple agents analyze a problem
2. Click "Synthesize & Decide"
3. Select a judge model (reasoning models recommended)
4. Judge reviews all transcripts and delivers a verdict

### Shared Context

1. Click the brain icon (🧠) to open the context sidebar
2. Add project-wide context (architecture notes, requirements, etc.)
3. All agents receive this context in their system prompts

## Project Structure

```
agent-conductor/
├── app/
│   ├── api/chat/route.ts    # Streaming AI endpoint
│   ├── layout.tsx           # Root layout
│   └── page.tsx             # Main dashboard
├── components/
│   ├── ChatWindow.tsx       # Individual chat interface
│   ├── ModelSelector.tsx    # Model toggle buttons
│   ├── BounceSelector.tsx   # Persona selection modal
│   ├── WorkflowSelector.tsx # Workflow dropdown
│   ├── WorkflowBuilder.tsx  # Custom workflow creator
│   ├── DecisionMaker.tsx    # Judge synthesis button
│   ├── ContextSidebar.tsx   # Shared context editor
│   └── EvaluationDashboard.tsx # Proving Ground mode
├── lib/
│   ├── ai.ts                # Model provider setup
│   ├── models.ts            # Model definitions
│   ├── personas.ts          # Persona definitions
│   ├── workflows.ts         # Workflow definitions
│   ├── types.ts             # TypeScript types
│   ├── guardrails.ts        # PII detection
│   ├── audit-log.ts         # Compliance logging
│   ├── context-provider.tsx # React context
│   └── store.ts             # Zustand state management
├── electron/
│   ├── main.js              # Electron entry point
│   └── preload.js           # Preload script
└── scripts/
    └── build-desktop.js     # Desktop build script
```

## Configuration

### Adding New Models

Edit `lib/models.ts`:

```typescript
{
    id: 'your-model-id',
    name: 'Display Name',
    description: 'Model description',
    providerId: 'openai', // or 'anthropic', 'google', etc.
    tags: ['fast', 'new'] // optional
}
```

### Adding New Personas

Edit `lib/personas.ts`:

```typescript
{
    id: 'your-persona-id',
    name: 'Persona Name',
    role: 'Role Description',
    modelId: 'gpt-4o',
    systemPrompt: `Your persona instructions...`
}
```

### Adding New Workflows

Edit `lib/workflows.ts`:

```typescript
{
    id: 'your-workflow-id',
    name: 'Workflow Name',
    description: 'What this workflow does',
    steps: [
        { personaId: 'security-auditor', instruction: 'Step 1 task' },
        { personaId: 'software-architect', instruction: 'Step 2 task' }
    ]
}
```

## Development

```bash
# Start dev server
npm run dev

# Run linting
npm run lint

# Live browser + CLI soak (serial, polling stability)
npm run test:stress:live:soak:smoke
npm run test:stress:live:soak:full

# Build for production
npm run build

# Build desktop app
npm run dist
```

## Architecture Decisions

- **Vercel AI SDK** - Unified interface for multiple AI providers with streaming
- **Zustand** - Lightweight state management (replacing React Context + useRef)
- **SQLite (better-sqlite3)** - Local persistence for sessions and workflows
- **Electron** - Desktop packaging with auto-updates and system tray

## Rugged Weighted Consensus (Design Reference)

This project is adopting user-configurable model influence while preserving ensemble safety.

- **Status**: Planned design, not fully shipped yet.
- **Goal**: Let users express trust in specific models without allowing a single model to silently dominate outcomes.

### Influence Model

Each model's contribution is computed as:

```text
influence = user_weight * reliability_weight * confidence_modifier * stance_value
```

- `user_weight`: explicit trust set by user (recommended scale `1-5`, default `3`)
- `reliability_weight`: model reliability estimated from historical outcomes
- `confidence_modifier`: bounded function of model confidence (clamped to avoid over-dominance)
- `stance_value`: signed vote signal used in consensus math

### Guardrails

- Use a **dual gate**:
  - unweighted ensemble sanity gate
  - weighted decision gate
- Cap any single model's maximum share of influence (for example `<= 40%`)
- Clamp confidence impact to a narrow range (for example `0.55-0.85`)
- Fall back to neutral confidence when confidence is missing or unparseable
- Show influence breakdown in trace/insights so final outcomes are explainable

### Why This Shape

- User trust should matter.
- Raw model confidence alone is often miscalibrated.
- Multiplicative weighting is a practical composition of established online-learning and aggregation methods.

### Research References

- Littlestone, Warmuth. *The Weighted Majority Algorithm* (1994): https://doi.org/10.1006/inco.1994.1009
- Freund, Schapire. *A Decision-Theoretic Generalization of On-Line Learning and an Application to Boosting* (1997): https://doi.org/10.1006/jcss.1997.1504
- Dawid, Skene. *Maximum Likelihood Estimation of Observer Error-Rates Using the EM Algorithm* (1979): https://doi.org/10.2307/2346806
- Guo et al. *On Calibration of Modern Neural Networks* (ICML 2017): https://proceedings.mlr.press/v70/guo17a.html
- Genest, Zidek. *Combining Probability Distributions: A Critique and an Annotated Bibliography* (1984 technical report): https://stat.uw.edu/research/tech-reports/combining-probability-distributions-critique-and-annotated-bibliography
- Russo et al. *A Tutorial on Thompson Sampling* (2017): https://arxiv.org/abs/1707.02038

## License

MIT

## Author

Antigravity
