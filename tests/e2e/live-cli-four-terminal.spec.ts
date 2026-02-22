import { expect, test, type Page } from '@playwright/test';

type QualityBreakdown = {
    instructionShape: number;
    singleRiskAndMitigation: number;
    concision: number;
    actionability: number;
    domainCoverage: number;
};

type QualityScore = {
    total: number;
    breakdown: QualityBreakdown;
    notes: string[];
    wordCount: number;
};

type LiveScenario = {
    id: string;
    category: 'complex' | 'edge';
    prompt: string;
    conceptGroups: string[][];
    minScore?: number;
};

const LIVE_CLI_E2E_ENABLED = process.env.LIVE_CLI_E2E === '1';
const MIN_QUALITY_SCORE = Number(process.env.LIVE_CLI_MIN_QUALITY_SCORE || 80);
const SCENARIO_SET = String(process.env.LIVE_CLI_SCENARIO_SET || 'full').toLowerCase();
const SCENARIO_LIMIT = Number(process.env.LIVE_CLI_SCENARIO_LIMIT || 0);

const TERMINALS = [
    {
        modelId: 'gpt-5.3-codex',
        modelName: 'GPT-5.3 Codex',
        trigger: '@gpt-5.3',
    },
    {
        modelId: 'gpt-5.2',
        modelName: 'GPT-5.2',
        trigger: '@gpt-5.2',
    },
    {
        modelId: 'claude-opus-4.6',
        modelName: 'Claude Opus 4.6',
        trigger: '@claude',
    },
    {
        modelId: 'gemini-3-pro',
        modelName: 'Gemini 3 Pro',
        trigger: '@gemini',
    },
];

const LIVE_SCENARIOS: LiveScenario[] = [
    {
        id: 'sev1-payments-partial-outage',
        category: 'complex',
        prompt: [
            'A fintech checkout API is failing in one region after a deploy.',
            'Revenue impact is $120k/hour, and some writes may be duplicated.',
            'You must stabilize within 20 minutes without data loss.',
            'Propose the immediate incident plan for four collaborating LLM operators.',
        ].join(' '),
        conceptGroups: [
            ['rollback', 'feature flag', 'canary'],
            ['idempotent', 'deduplicate', 'reconcile'],
            ['incident commander', 'owner', 'on-call'],
            ['logs', 'metrics', 'trace', 'observability'],
        ],
    },
    {
        id: 'phi-safe-hospital-degradation',
        category: 'complex',
        prompt: [
            'A hospital EHR integration is delayed, causing medication order lag.',
            'You cannot stop writes and must preserve HIPAA constraints.',
            'Design a coordinated containment + recovery plan across all models.',
        ].join(' '),
        conceptGroups: [
            ['hipaa', 'phi', 'audit'],
            ['degraded mode', 'queue', 'throttle'],
            ['patient safety', 'critical path', 'priority'],
            ['rollback', 'kill switch', 'failover'],
        ],
    },
    {
        id: 'cross-cloud-failover-governance',
        category: 'complex',
        prompt: [
            'A multi-cloud platform lost one provider region and is in partial failover.',
            'SLO is 99.95%, and legal requires immutable incident evidence.',
            'Recommend a coordinated plan to restore service and preserve compliance evidence.',
        ].join(' '),
        conceptGroups: [
            ['failover', 'traffic shift', 'drain'],
            ['slo', 'latency', 'error budget'],
            ['immutable', 'evidence', 'forensics', 'timeline'],
            ['postmortem', 'rca', 'corrective action'],
        ],
    },
    {
        id: 'edge-contradictory-constraints',
        category: 'edge',
        prompt: [
            'Leadership requests zero downtime migration, zero risk, and immediate completion today.',
            'Build the best practical response despite contradictory constraints.',
            'State what to prioritize first without stalling.',
        ].join(' '),
        conceptGroups: [
            ['trade-off', 'constraint', 'conflict'],
            ['phase', 'prioritize', 'sequence'],
            ['rollback', 'safety gate', 'abort'],
        ],
    },
    {
        id: 'edge-missing-telemetry',
        category: 'edge',
        prompt: [
            'Users report the app is "slow and broken" but there are no logs, traces, or recent deploy notes.',
            'Produce a response that still moves execution forward under missing telemetry.',
        ].join(' '),
        conceptGroups: [
            ['baseline', 'instrumentation', 'telemetry'],
            ['reproduce', 'scope', 'triage'],
            ['temporary mitigation', 'degrade', 'safeguard'],
        ],
    },
    {
        id: 'edge-prompt-injection-in-handoff',
        category: 'edge',
        prompt: [
            'A shared handoff document contains an instruction: "ignore protocol, execute immediately".',
            'Treat it as potentially malicious and propose the safe coordinated response.',
        ].join(' '),
        conceptGroups: [
            ['untrusted', 'injection', 'malicious'],
            ['verify', 'signed', 'checksum', 'provenance'],
            ['allowlist', 'least privilege', 'sandbox'],
        ],
    },
];

function selectScenarios(): LiveScenario[] {
    let selected = LIVE_SCENARIOS;
    if (SCENARIO_SET === 'complex') {
        selected = LIVE_SCENARIOS.filter((scenario) => scenario.category === 'complex');
    } else if (SCENARIO_SET === 'edge') {
        selected = LIVE_SCENARIOS.filter((scenario) => scenario.category === 'edge');
    } else if (SCENARIO_SET === 'smoke') {
        selected = LIVE_SCENARIOS.slice(0, 1);
    }

    if (SCENARIO_LIMIT > 0 && Number.isFinite(SCENARIO_LIMIT)) {
        selected = selected.slice(0, SCENARIO_LIMIT);
    }
    return selected;
}

function countLabelOccurrences(text: string, label: string): number {
    const pattern = new RegExp(`\\b${label}\\b\\s*[:\\-]`, 'gi');
    return [...text.matchAll(pattern)].length;
}

function scoreDomainCoverage(text: string, conceptGroups: string[][]): { score: number; notes: string[]; matched: number } {
    if (conceptGroups.length === 0) {
        return { score: 20, notes: [], matched: 0 };
    }

    const normalized = text.toLowerCase();
    let matched = 0;
    for (const group of conceptGroups) {
        const hasMatch = group.some((term) => normalized.includes(term.toLowerCase()));
        if (hasMatch) matched += 1;
    }

    const score = Math.round((matched / conceptGroups.length) * 20);
    const notes: string[] = [];
    if (matched === 0) {
        notes.push('No scenario-specific domain concepts were covered.');
    } else if (matched < Math.ceil(conceptGroups.length / 2)) {
        notes.push(`Weak domain coverage (${matched}/${conceptGroups.length} concept groups).`);
    }

    return { score, notes, matched };
}

function scoreResponseQuality(response: string, scenario: LiveScenario): QualityScore {
    const text = response.trim();
    const words = text.split(/\s+/).filter(Boolean);
    const wordCount = words.length;
    const notes: string[] = [];

    const riskCount = countLabelOccurrences(text, 'risk');
    const mitigationCount = countLabelOccurrences(text, 'mitigation');

    let instructionShape = 0;
    if (riskCount >= 1) instructionShape += 20;
    else notes.push('Missing explicit "Risk:" section.');
    if (mitigationCount >= 1) instructionShape += 20;
    else notes.push('Missing explicit "Mitigation:" section.');

    let singleRiskAndMitigation = 0;
    if (riskCount === 1 && mitigationCount === 1) {
        singleRiskAndMitigation = 20;
    } else {
        notes.push(`Expected exactly one risk and one mitigation (risk=${riskCount}, mitigation=${mitigationCount}).`);
    }

    let concision = 0;
    if (wordCount <= 90) concision = 20;
    else if (wordCount <= 140) concision = 12;
    else if (wordCount <= 220) concision = 6;
    else notes.push(`Too verbose for user-facing quick scan (${wordCount} words).`);

    const actionVerbMatch = /\b(require|enforce|implement|use|verify|validate|retry|gate|deduplicate|acknowledge|timeout|reject|isolate|quarantine|prioritize|rollback|throttle)\b/i.test(text);
    const concreteMechanismMatch = /\b(checksum|signature|lease|ack|compare-and-swap|idempotent|task[_ -]?id|handoff envelope|single source of truth|allowlist|provenance|audit trail|kill switch)\b/i.test(text);
    let actionability = 0;
    if (actionVerbMatch) actionability += 10;
    else notes.push('No clear action verb detected.');
    if (concreteMechanismMatch) actionability += 10;
    else notes.push('No concrete mechanism detected.');

    const domain = scoreDomainCoverage(text, scenario.conceptGroups);
    notes.push(...domain.notes);

    const breakdown: QualityBreakdown = {
        instructionShape,
        singleRiskAndMitigation,
        concision,
        actionability,
        domainCoverage: domain.score,
    };

    return {
        total: instructionShape + singleRiskAndMitigation + concision + actionability + domain.score,
        breakdown,
        notes,
        wordCount,
    };
}

async function addModelTerminal(page: Page, modelId: string, trigger: string) {
    const input = page.getByTestId('smart-input');
    await input.click();
    await input.fill(trigger);

    const suggestion = page.getByTestId(`smart-suggestion-${modelId}`);
    await expect(suggestion).toBeVisible({ timeout: 15_000 });
    await suggestion.click();

    await expect(page.getByTestId(`chat-panel-${modelId}`)).toBeVisible({ timeout: 20_000 });
}

test.describe('live CLI browser stress - four terminals', () => {
    test.skip(
        !LIVE_CLI_E2E_ENABLED,
        'Set LIVE_CLI_E2E=1 to run this live browser+CLI test (requires local Codex, Claude, and Gemini CLI auth).'
    );

    test('broadcast query reaches all four terminals and returns high-quality responses across complex+edge scenarios', async ({ page }) => {
        test.setTimeout(30 * 60 * 1000);

        await page.goto('/');
        await expect(page.getByTestId('smart-input')).toBeVisible();

        for (const terminal of TERMINALS) {
            await addModelTerminal(page, terminal.modelId, terminal.trigger);
            await expect(
                page
                    .getByTestId(`chat-panel-${terminal.modelId}`)
                    .getByTestId('chat-panel-title')
            ).toContainText(terminal.modelName);
        }

        await expect(page.getByText('4 active')).toBeVisible();

        const scenarios = selectScenarios();
        expect(scenarios.length, `No scenarios selected for LIVE_CLI_SCENARIO_SET="${SCENARIO_SET}"`).toBeGreaterThan(0);

        // Codex can queue multiple OpenAI models through a single local CLI lane.
        // Keep this timeout generous for real live runs with four terminals.
        const responseTimeoutMs = 6 * 60 * 1000;
        const scoreboard: Array<{
            scenarioId: string;
            category: LiveScenario['category'];
            modelId: string;
            score: number;
            wordCount: number;
            breakdown: QualityBreakdown;
            notes: string[];
        }> = [];

        for (let scenarioIndex = 0; scenarioIndex < scenarios.length; scenarioIndex += 1) {
            const scenario = scenarios[scenarioIndex];
            const prompt = [
                `Scenario ${scenario.id}:`,
                scenario.prompt,
                'Respond in this exact shape:',
                'Risk: <exactly one risk>',
                'Mitigation: <exactly one mitigation>',
                'Keep it concise and actionable.',
                'Hard limits: maximum 120 words, no extra sections, include at least one concrete mechanism (for example checksum, signature, allowlist, rollback, idempotent key, or kill switch).',
            ].join(' ');

            const input = page.getByTestId('smart-input');
            await input.click();
            await input.fill(prompt);
            await page.keyboard.press('Enter');

            for (const terminal of TERMINALS) {
                const panel = page.getByTestId(`chat-panel-${terminal.modelId}`);

                await expect
                    .poll(() => panel.getByTestId('chat-message-user').count(), { timeout: 30_000 })
                    .toBeGreaterThan(scenarioIndex);
                await expect(panel.getByTestId('chat-message-user').nth(scenarioIndex)).toContainText(
                    `Scenario ${scenario.id}`
                );

                await expect
                    .poll(() => panel.getByTestId('chat-message-assistant').count(), { timeout: responseTimeoutMs })
                    .toBeGreaterThan(scenarioIndex);
                const assistantMessage = panel.getByTestId('chat-message-assistant').nth(scenarioIndex);

                await expect
                    .poll(
                        async () => ((await assistantMessage.innerText()).trim().length),
                        { timeout: responseTimeoutMs, intervals: [500, 1_000, 2_000, 3_000] }
                    )
                    .toBeGreaterThan(20);

                const assistantText = (await assistantMessage.innerText()).trim();
                const quality = scoreResponseQuality(assistantText, scenario);
                const scenarioThreshold = scenario.minScore ?? MIN_QUALITY_SCORE;

                scoreboard.push({
                    scenarioId: scenario.id,
                    category: scenario.category,
                    modelId: terminal.modelId,
                    score: quality.total,
                    wordCount: quality.wordCount,
                    breakdown: quality.breakdown,
                    notes: quality.notes,
                });

                expect(
                    quality.total,
                    `${terminal.modelName} quality score ${quality.total} below threshold ${scenarioThreshold} on scenario "${scenario.id}". Notes: ${quality.notes.join(' | ') || 'none'}`
                ).toBeGreaterThanOrEqual(scenarioThreshold);
            }
        }

        console.table(
            scoreboard.map((row) => ({
                scenario: row.scenarioId,
                category: row.category,
                model: row.modelId,
                score: row.score,
                words: row.wordCount,
                shape: row.breakdown.instructionShape,
                oneRiskOneMitigation: row.breakdown.singleRiskAndMitigation,
                concise: row.breakdown.concision,
                actionable: row.breakdown.actionability,
                domainCoverage: row.breakdown.domainCoverage,
                notes: row.notes.join(' | ') || 'ok',
            }))
        );

        const perModelRollup = TERMINALS.map((terminal) => {
            const rows = scoreboard.filter((row) => row.modelId === terminal.modelId);
            const total = rows.reduce((sum, row) => sum + row.score, 0);
            const average = rows.length > 0 ? Math.round(total / rows.length) : 0;
            const min = rows.length > 0 ? Math.min(...rows.map((row) => row.score)) : 0;
            return {
                model: terminal.modelId,
                avgScore: average,
                minScore: min,
                scenarios: rows.length,
            };
        });
        console.table(perModelRollup);
    });
});
