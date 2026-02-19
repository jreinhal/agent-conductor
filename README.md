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

## License

MIT

## Author

Antigravity
