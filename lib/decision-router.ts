interface UIMessageLike {
    role?: string;
    content?: string;
    parts?: Array<{ type?: string; text?: string }>;
}

interface RoutingInput {
    requestedModel?: string;
    messages: UIMessageLike[];
    system?: string;
}

interface RoutingScores {
    codingIntent: number;
    deepReasoning: number;
    speedPreference: number;
    factualPrecision: number;
}

export interface RouteDecision {
    isAuto: boolean;
    selectedModel: string;
    fallbackModels: string[];
    reason: string;
    scores: RoutingScores;
}

const AUTO_MODEL_IDS = new Set(['auto-router', 'auto', 'router']);

const CODE_KEYWORDS = [
    'bug', 'fix', 'refactor', 'function', 'class', 'typescript', 'javascript', 'python',
    'stack trace', 'compile', 'build', 'test', 'lint', 'api', 'sql', 'regex', 'cli',
    'terminal', 'npm', 'yarn', 'pnpm',
];

const DEEP_REASONING_KEYWORDS = [
    'architecture', 'tradeoff', 'compare', 'pros and cons', 'evaluate', 'plan',
    'strategy', 'root cause', 'analyze', 'migration', 'design',
];

const SPEED_KEYWORDS = [
    'quick', 'brief', 'one sentence', 'tldr', 'short answer', 'fast',
];

const FACTUAL_PRECISION_KEYWORDS = [
    'today',
    'latest',
    'current',
    'as of',
    'date',
    'time',
    'timezone',
    'price',
    'law',
    'policy',
    'regulation',
    'official',
    'verify',
    'accurate',
    'source',
    'capital',
    'multiply',
    'times',
    'weekday',
    'day of the week',
];

function extractMessageText(message: UIMessageLike): string {
    if (typeof message.content === 'string') return message.content;
    if (!Array.isArray(message.parts)) return '';
    return message.parts
        .filter((part) => part?.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text as string)
        .join('');
}

function countKeywordHits(text: string, keywords: string[]): number {
    return keywords.reduce((count, keyword) => {
        return count + (text.includes(keyword) ? 1 : 0);
    }, 0);
}

function getLatestUserMessage(messages: UIMessageLike[]): string {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i];
        if ((message.role || 'user') === 'user') {
            return extractMessageText(message).trim();
        }
    }
    return '';
}

function scoreMessage(textRaw: string, messageCount: number): RoutingScores {
    const text = textRaw.toLowerCase();
    const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
    const hasCodeBlock = text.includes('```');
    const codeHits = countKeywordHits(text, CODE_KEYWORDS);
    const deepHits = countKeywordHits(text, DEEP_REASONING_KEYWORDS);
    const speedHits = countKeywordHits(text, SPEED_KEYWORDS);
    const factualHits = countKeywordHits(text, FACTUAL_PRECISION_KEYWORDS);

    let codingIntent = codeHits;
    if (hasCodeBlock) codingIntent += 3;
    if (text.includes('error:') || text.includes('exception')) codingIntent += 2;

    let deepReasoning = deepHits;
    if (wordCount > 120) deepReasoning += 2;
    if (wordCount > 220) deepReasoning += 2;
    if (messageCount > 8) deepReasoning += 1;

    let speedPreference = speedHits;
    if (wordCount > 0 && wordCount <= 20) speedPreference += 2;
    if (/\b(what|when|where|who)\b/.test(text) && wordCount <= 30) speedPreference += 1;

    let factualPrecision = factualHits;
    if (/\b(today|latest|current|right now|as of)\b/.test(text)) factualPrecision += 2;
    if (/\b(what day|what date|what time|timezone)\b/.test(text)) factualPrecision += 1;
    if (/\b(verify|accuracy|accurate|source)\b/.test(text)) factualPrecision += 1;
    if (/\b(capital of|day of the week|what is \d+[\s*]+\d+)\b/.test(text)) factualPrecision += 2;

    return {
        codingIntent,
        deepReasoning,
        speedPreference,
        factualPrecision,
    };
}

function dedupe(models: string[]): string[] {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const model of models) {
        if (!seen.has(model)) {
            seen.add(model);
            ordered.push(model);
        }
    }
    return ordered;
}

export function decideModelRoute(input: RoutingInput): RouteDecision {
    const requestedModel = input.requestedModel || 'gpt-5.3-codex';
    const isAuto = AUTO_MODEL_IDS.has(requestedModel);

    if (!isAuto) {
        return {
            isAuto: false,
            selectedModel: requestedModel,
            fallbackModels: [],
            reason: 'Explicit model selected.',
            scores: {
                codingIntent: 0,
                deepReasoning: 0,
                speedPreference: 0,
                factualPrecision: 0,
            },
        };
    }

    const latestUserMessage = getLatestUserMessage(input.messages);
    const scores = scoreMessage(latestUserMessage, input.messages.length);

    let selectedModel = 'gpt-5.2';
    let fallbackModels = ['claude-sonnet-4.5', 'gemini-3-pro'];
    let reason = 'Default balanced route.';

    if (scores.codingIntent >= 3) {
        selectedModel = 'gpt-5.3-codex';
        fallbackModels = ['claude-opus-4.6', 'gpt-5.2'];
        reason = 'Detected coding-heavy intent.';
    } else if (scores.deepReasoning >= 4) {
        selectedModel = 'claude-opus-4.6';
        fallbackModels = ['gpt-5.2', 'claude-sonnet-4.5'];
        reason = 'Detected deep reasoning/analysis request.';
    } else if (scores.factualPrecision >= 3) {
        selectedModel = 'gpt-5.2';
        fallbackModels = ['claude-opus-4.6', 'gemini-3-pro'];
        reason = 'Detected factual/time-sensitive accuracy request.';
    } else if (scores.speedPreference >= 3) {
        selectedModel = 'gemini-3-flash';
        fallbackModels = ['gpt-5.2', 'claude-haiku-4.5'];
        reason = 'Detected short/fast-response preference.';
    }

    return {
        isAuto: true,
        selectedModel,
        fallbackModels: dedupe(fallbackModels).filter((model) => model !== selectedModel),
        reason,
        scores,
    };
}
