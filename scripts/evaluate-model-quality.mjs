#!/usr/bin/env node
import { createHash } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

const BASE_URL = process.env.AGENT_CONDUCTOR_BASE_URL || 'http://localhost:3000';
const CHAT_ENDPOINT = `${BASE_URL}/api/chat`;
const MIN_PASS_RATE_DEFAULT = Number(process.env.QUALITY_EVAL_MIN_PASS_RATE || 90);

const CLARIFICATION_PATTERN = /could you clarify|can you clarify|what do you mean|are you referring to|something else\?/i;

const EVAL_CASES = [
    {
        id: 'model_name_only',
        prompt: 'Reply with your model name only.',
        expected: {
            'gpt-5.3-codex': /(gpt|codex)/i,
            'claude-opus-4.6': /claude/i,
        },
    },
    {
        id: 'capital_australia',
        prompt: 'What is the capital of Australia? Return one word only.',
        expected: {
            'gpt-5.3-codex': /canberra/i,
            'claude-opus-4.6': /canberra/i,
            'auto-router': /canberra/i,
        },
    },
    {
        id: 'weekday_check',
        prompt: 'What day of the week is February 21, 2026? Return one word only.',
        expected: {
            'gpt-5.3-codex': /saturday/i,
            'claude-opus-4.6': /saturday/i,
            'auto-router': /saturday/i,
        },
    },
    {
        id: 'math_check',
        prompt: 'What is 17 * 19? Return only the number.',
        expected: {
            'gpt-5.3-codex': /\b323\b/,
            'claude-opus-4.6': /\b323\b/,
            'auto-router': /\b323\b/,
        },
    },
];

function parseArgs(argv) {
    const args = {};
    for (let i = 2; i < argv.length; i += 1) {
        const token = argv[i];
        if (!token.startsWith('--')) continue;
        const key = token.slice(2);
        const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
        args[key] = value;
    }
    return args;
}

function parseSseResponse(raw) {
    const lines = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith('data: '));

    let text = '';
    let errorText = '';
    for (const line of lines) {
        const payload = line.slice(6);
        if (payload === '[DONE]') continue;
        try {
            const event = JSON.parse(payload);
            if (event.type === 'text-delta' && typeof event.delta === 'string') {
                text += event.delta;
            }
            if (event.type === 'error' && typeof event.errorText === 'string') {
                errorText += event.errorText;
            }
        } catch {
            // Ignore malformed SSE payloads.
        }
    }

    return {
        text: text.trim(),
        errorText: errorText.trim(),
    };
}

async function runCase(model, prompt) {
    const body = {
        model,
        messages: [{ role: 'user', content: prompt }],
    };

    const startedAt = Date.now();
    const response = await fetch(CHAT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    const raw = await response.text();
    const parsed = parseSseResponse(raw);
    const durationMs = Date.now() - startedAt;

    return {
        status: response.status,
        durationMs,
        text: parsed.text,
        errorText: parsed.errorText,
        headers: {
            requested: response.headers.get('x-agentconductor-requested-model'),
            routed: response.headers.get('x-agentconductor-routed-model'),
            reason: response.headers.get('x-agentconductor-route-reason'),
        },
    };
}

function evaluateResult(resultText, expectedPattern) {
    if (!resultText) return { pass: false, notes: 'empty response' };
    if (CLARIFICATION_PATTERN.test(resultText)) {
        return { pass: false, notes: 'returned clarification instead of direct answer' };
    }
    if (!expectedPattern.test(resultText)) {
        return { pass: false, notes: `expected pattern ${expectedPattern}` };
    }
    return { pass: true, notes: 'ok' };
}

async function main() {
    const args = parseArgs(process.argv);
    const minPassRate = Number(args.minPassRate ?? MIN_PASS_RATE_DEFAULT);
    const rows = [];
    let total = 0;
    let passed = 0;

    for (const testCase of EVAL_CASES) {
        for (const [model, pattern] of Object.entries(testCase.expected)) {
            total += 1;
            let outcome;
            try {
                const result = await runCase(model, testCase.prompt);
                const verdict = evaluateResult(result.text, pattern);
                if (verdict.pass) passed += 1;
                outcome = {
                    caseId: testCase.id,
                    model,
                    pass: verdict.pass ? 'PASS' : 'FAIL',
                    durationMs: result.durationMs,
                    routedModel: result.headers.routed || '-',
                    notes: verdict.pass ? result.text.slice(0, 80) : verdict.notes,
                };
            } catch (error) {
                outcome = {
                    caseId: testCase.id,
                    model,
                    pass: 'FAIL',
                    durationMs: 0,
                    routedModel: '-',
                    notes: error instanceof Error ? error.message : String(error),
                };
            }
            rows.push(outcome);
        }
    }

    console.table(rows);
    const passPct = total > 0 ? Math.round((passed / total) * 100) : 0;
    console.log(`Quality eval: ${passed}/${total} passing (${passPct}%)`);

    const manifest = {
        runAt: new Date().toISOString(),
        total,
        passed,
        passPct,
        minPassRate,
        pass: passPct >= minPassRate,
        datasetChecksum: createHash('sha256')
            .update(JSON.stringify(EVAL_CASES))
            .digest('hex'),
        resultsChecksum: createHash('sha256')
            .update(JSON.stringify(rows))
            .digest('hex'),
        rows,
    };

    const outDir = path.join(process.cwd(), '.tmp');
    await mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, 'quality-eval-last.json');
    await writeFile(outPath, JSON.stringify(manifest, null, 2), 'utf-8');
    console.log(`Wrote quality manifest: ${outPath}`);

    if (passPct < minPassRate) {
        console.error(`Quality gate failed: pass rate ${passPct}% is below minimum ${minPassRate}%`);
        process.exit(2);
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
