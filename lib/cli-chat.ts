import { spawn } from 'child_process';

const CLI_TIMEOUT_MS = 120_000;
const CLI_TOOL_QUEUES = new Map<CliTool, Promise<void>>();
const STARTUP_COMPACTION_RULE = [
    'Startup rule (mandatory): strategically compact context at regular intervals so the discussion can continue indefinitely.',
    'When context grows, emit a concise rolling summary that preserves decisions, constraints, open tasks, and next actions.',
    'Do not drop unresolved requirements, ownership decisions, or acceptance criteria during compaction.',
].join('\n');

type CliTool = 'codex' | 'claude' | 'gemini';

interface IncomingMessage {
    role?: string;
    content?: string;
    parts?: Array<{ type?: string; text?: string }>;
}

interface CliSelection {
    tool: CliTool;
    model: string;
}

interface CliInvocation {
    args: string[];
    stdinInput?: string;
}

interface ProcessResult {
    stdout: string;
    stderr: string;
    code: number | null;
    signal: NodeJS.Signals | null;
}

function queueByCliTool<T>(tool: CliTool, task: () => Promise<T>): Promise<T> {
    const previous = CLI_TOOL_QUEUES.get(tool) || Promise.resolve();
    const run = previous.then(task, task);

    CLI_TOOL_QUEUES.set(
        tool,
        run.then(
            () => undefined,
            () => undefined
        )
    );

    return run;
}

function extractMessageText(message: IncomingMessage): string {
    if (typeof message.content === 'string') return message.content;

    if (Array.isArray(message.parts)) {
        return message.parts
            .filter((part) => part?.type === 'text' && typeof part.text === 'string')
            .map((part) => part.text as string)
            .join('');
    }

    return '';
}

function getRecentMessages(messages: IncomingMessage[]): Array<{ role: string; text: string }> {
    return messages
        .map((message) => ({
            role: (message.role || 'user').toUpperCase(),
            text: extractMessageText(message).trim(),
        }))
        .filter((message) => message.text.length > 0)
        .slice(-20);
}

function getLatestUserMessage(messages: IncomingMessage[]): string {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i];
        if ((message.role || 'user') !== 'user') continue;
        const text = extractMessageText(message).trim();
        if (text) return text;
    }
    return '';
}

function buildPrompt(system: string | undefined, messages: IncomingMessage[]): string {
    const recent = getRecentMessages(messages);
    const latestUserMessage = getLatestUserMessage(messages);

    const sections: string[] = [];

    sections.push(`Meta policy (apply silently, do not answer this section):\n${STARTUP_COMPACTION_RULE}`);

    if (system?.trim()) {
        sections.push(`System context (apply silently, do not answer this section):\n${system.trim()}`);
    }

    if (recent.length > 0) {
        sections.push(
            `Conversation history (context only):\n${recent
                .map((message) => `[${message.role}] ${message.text}`)
                .join('\n\n')}`
        );
    }

    sections.push(`FINAL_USER_MESSAGE (answer this):\n${latestUserMessage || '(none provided)'}`);
    sections.push(
        [
            'Response rules:',
            '- Answer FINAL_USER_MESSAGE directly.',
            '- Prioritize FINAL_USER_MESSAGE over older turns.',
            '- Ignore all section labels; they are metadata.',
            '- Ask a clarifying question only if FINAL_USER_MESSAGE is truly ambiguous.',
        ].join('\n')
    );

    return sections.join('\n\n');
}

function buildCorrectionPrompt(
    system: string | undefined,
    messages: IncomingMessage[],
    latestUserMessage: string,
    previousOutput: string
): string {
    const clippedPreviousOutput = previousOutput.trim().slice(0, 900);
    const recent = getRecentMessages(messages)
        .map((message) => `[${message.role}] ${message.text}`)
        .join('\n\n');

    return [
        `Meta policy (apply silently, do not answer this section):\n${STARTUP_COMPACTION_RULE}`,
        system?.trim()
            ? `System context (apply silently, do not answer this section):\n${system.trim()}`
            : '',
        recent ? `Conversation history (context only):\n${recent}` : '',
        `FINAL_USER_MESSAGE (answer this):\n${latestUserMessage}`,
        'Quality correction:',
        'The previous draft did not comply with FINAL_USER_MESSAGE.',
        `Previous draft:\n${clippedPreviousOutput}`,
        [
            'Respond again now with strict compliance:',
            '- Directly answer FINAL_USER_MESSAGE.',
            '- Do not ask a clarifying question unless FINAL_USER_MESSAGE is truly ambiguous.',
            '- If FINAL_USER_MESSAGE requests a constrained format (for example "only", "one word"), follow it exactly.',
        ].join('\n'),
    ].filter(Boolean).join('\n\n');
}

function buildCliInvocation(selection: CliSelection, prompt: string): CliInvocation {
    if (selection.tool === 'codex') {
        return {
            args: [
                'exec',
                '--model',
                selection.model,
                '--sandbox',
                'read-only',
                '--skip-git-repo-check',
                '--json',
                '-',
            ],
            stdinInput: prompt,
        };
    }

    if (selection.tool === 'claude') {
        return {
            args: [
                '--no-session-persistence',
                '-p',
                '--output-format',
                'json',
                '--model',
                selection.model,
            ],
            stdinInput: prompt,
        };
    }

    return {
        // Gemini requires a non-empty -p value; real prompt content is sent on stdin.
        args: ['-m', selection.model, '-p', '_', '-o', 'json'],
        stdinInput: prompt,
    };
}

function resolveCliSelection(modelId: string): CliSelection {
    if (modelId.startsWith('gpt-') || modelId.includes('codex') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4')) {
        return { tool: 'codex', model: modelId };
    }

    if (modelId.startsWith('claude-')) {
        return { tool: 'claude', model: modelId.replace(/\./g, '-') };
    }

    if (modelId.startsWith('gemini-')) {
        if (modelId === 'gemini-3-pro') return { tool: 'gemini', model: 'gemini-3-pro-preview' };
        if (modelId === 'gemini-3-flash') return { tool: 'gemini', model: 'gemini-3-flash-preview' };
        return { tool: 'gemini', model: modelId };
    }

    if (modelId.startsWith('grok-')) {
        throw new Error('No local Grok CLI is installed. Remove Grok from active models or install a compatible CLI adapter.');
    }

    throw new Error(`Model "${modelId}" is not mapped to a local CLI runner.`);
}

function getExecutable(tool: CliTool): string {
    if (tool === 'codex') return process.platform === 'win32' ? 'codex.cmd' : 'codex';
    if (tool === 'gemini') return process.platform === 'win32' ? 'gemini.cmd' : 'gemini';
    return process.platform === 'win32' ? 'claude' : 'claude';
}

function buildCliEnvironment(): NodeJS.ProcessEnv {
    const env = { ...process.env };

    // Force CLI login/subscription auth instead of API-key billing paths.
    delete env.OPENAI_API_KEY;
    delete env.ANTHROPIC_API_KEY;
    delete env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete env.GEMINI_API_KEY;
    delete env.XAI_API_KEY;

    return env;
}

function runProcess(command: string, args: string[], stdinInput?: string): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: process.cwd(),
            env: buildCliEnvironment(),
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
            shell: process.platform === 'win32',
        });

        let stdout = '';
        let stderr = '';
        let timedOut = false;

        const timeout = setTimeout(() => {
            timedOut = true;
            if (process.platform === 'win32' && child.pid) {
                const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
                    windowsHide: true,
                    stdio: 'ignore',
                });
                killer.on('error', () => {
                    child.kill('SIGKILL');
                });
            } else {
                child.kill('SIGTERM');
                setTimeout(() => child.kill('SIGKILL'), 1500);
            }
        }, CLI_TIMEOUT_MS);

        child.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString('utf-8');
        });

        child.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString('utf-8');
        });

        child.on('error', (error) => {
            clearTimeout(timeout);
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                reject(new Error(`CLI executable not found: ${command}`));
                return;
            }
            reject(error);
        });

        child.on('close', (code, signal) => {
            clearTimeout(timeout);

            if (timedOut) {
                reject(new Error(`${command} timed out after ${Math.round(CLI_TIMEOUT_MS / 1000)}s`));
                return;
            }

            resolve({ stdout, stderr, code, signal });
        });

        if (typeof stdinInput === 'string') {
            child.stdin.write(stdinInput);
        }
        child.stdin.end();
    });
}

function parseJsonObject(raw: string): unknown {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    try {
        return JSON.parse(trimmed);
    } catch {
        const firstBrace = trimmed.indexOf('{');
        const lastBrace = trimmed.lastIndexOf('}');
        if (firstBrace >= 0 && lastBrace > firstBrace) {
            try {
                return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
            } catch {
                return null;
            }
        }
        return null;
    }
}

function parseCodexOutput(stdout: string): string {
    let lastMessage = '';

    for (const line of stdout.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
            const payload = JSON.parse(trimmed) as {
                type?: string;
                item?: { type?: string; text?: string };
            };

            if (
                payload.type === 'item.completed' &&
                payload.item?.type === 'agent_message' &&
                typeof payload.item.text === 'string'
            ) {
                lastMessage = payload.item.text.trim();
            }
        } catch {
            // Ignore non-JSON lines.
        }
    }

    return lastMessage || stdout.trim();
}

function parseClaudeOutput(stdout: string): string {
    const parsed = parseJsonObject(stdout) as { result?: unknown } | null;
    if (parsed && typeof parsed.result === 'string') {
        return parsed.result.trim();
    }
    return stdout.trim();
}

function parseGeminiOutput(stdout: string): string {
    const parsed = parseJsonObject(stdout) as { response?: unknown } | null;
    if (parsed && typeof parsed.response === 'string') {
        return parsed.response.trim();
    }
    return stdout.trim();
}

function parseCliOutput(tool: CliTool, stdout: string): string {
    if (tool === 'codex') return parseCodexOutput(stdout);
    if (tool === 'claude') return parseClaudeOutput(stdout);
    return parseGeminiOutput(stdout);
}

function normalizeText(value: string): string {
    return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function looksLikeClarificationQuestion(response: string): boolean {
    return /could you clarify|can you clarify|what do you mean|are you referring to|something else\?|which one do you mean/i.test(response);
}

function isClearlyActionableUserPrompt(userPrompt: string): boolean {
    const normalized = normalizeText(userPrompt);
    if (normalized.split(' ').length < 4) return false;
    return /reply with|answer with|return|what is|who is|when is|where is|how many|calculate|write|generate|summarize|fix|debug|compare|explain/i.test(normalized);
}

function asksForStrictOutputShape(userPrompt: string): boolean {
    const normalized = normalizeText(userPrompt);
    return /only|exactly|one word|just the|no explanation|reply with|answer with|return only/i.test(normalized);
}

function responseFitsModelNameOnly(userPrompt: string, response: string, modelId: string): boolean {
    const normalizedPrompt = normalizeText(userPrompt);
    if (!/model name/.test(normalizedPrompt)) return true;

    const normalizedResponse = normalizeText(response);
    const wordCount = normalizedResponse ? normalizedResponse.split(' ').length : 0;
    const hasQuestionShape = normalizedResponse.includes('?');

    const hasModelMarker =
        (modelId.includes('claude') && /claude/.test(normalizedResponse)) ||
        ((modelId.includes('gpt') || modelId.includes('codex')) && /(gpt|codex)/.test(normalizedResponse)) ||
        (modelId.includes('gemini') && /gemini/.test(normalizedResponse)) ||
        (modelId.includes('grok') && /grok/.test(normalizedResponse));

    return hasModelMarker && wordCount <= 8 && !hasQuestionShape;
}

function shouldRetryForQuality(latestUserMessage: string, modelResponse: string, modelId: string): boolean {
    const trimmedResponse = modelResponse.trim();
    if (!trimmedResponse) return true;

    if (!responseFitsModelNameOnly(latestUserMessage, trimmedResponse, modelId)) {
        return true;
    }

    if (looksLikeClarificationQuestion(trimmedResponse) && isClearlyActionableUserPrompt(latestUserMessage)) {
        return true;
    }

    if (asksForStrictOutputShape(latestUserMessage)) {
        const isLikelyVerbose = trimmedResponse.split(/\r?\n/).length > 3 || trimmedResponse.length > 260;
        if (isLikelyVerbose) return true;
    }

    return false;
}

export async function runLocalCliChat(
    modelId: string,
    messages: IncomingMessage[],
    system?: string
): Promise<string> {
    const selection = resolveCliSelection(modelId);
    return queueByCliTool(selection.tool, async () => {
        const executable = getExecutable(selection.tool);
        const prompt = buildPrompt(system, messages);
        const invocation = buildCliInvocation(selection, prompt);
        const result = await runProcess(executable, invocation.args, invocation.stdinInput);

        if (result.code !== 0) {
            const details = [result.stderr.trim(), result.stdout.trim()]
                .filter(Boolean)
                .join('\n')
                .trim();
            throw new Error(details || `${selection.tool} exited with code ${result.code ?? 'unknown'}`);
        }

        let parsed = parseCliOutput(selection.tool, result.stdout);

        if (!parsed) {
            const details = [result.stderr.trim(), result.stdout.trim()]
                .filter(Boolean)
                .join('\n')
                .trim();
            throw new Error(details || `${selection.tool} returned empty output`);
        }

        const latestUserMessage = getLatestUserMessage(messages);
        if (latestUserMessage && shouldRetryForQuality(latestUserMessage, parsed, modelId)) {
            const correctionPrompt = buildCorrectionPrompt(system, messages, latestUserMessage, parsed);
            const correctionInvocation = buildCliInvocation(selection, correctionPrompt);

            try {
                const correctionResult = await runProcess(
                    executable,
                    correctionInvocation.args,
                    correctionInvocation.stdinInput
                );
                if (correctionResult.code === 0) {
                    const correctionParsed = parseCliOutput(selection.tool, correctionResult.stdout);
                    if (correctionParsed.trim()) {
                        parsed = correctionParsed;
                    }
                }
            } catch {
                // Keep original parsed response if correction retry fails.
            }
        }

        return parsed;
    });
}
