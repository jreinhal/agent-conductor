import { describe, expect, it } from 'vitest';
import { BounceOrchestrator } from '@/lib/bounce-orchestrator';
import type { BounceEvent, ParticipantConfig } from '@/lib/bounce-types';

const JUDGE_MODEL_ID = 'claude-opus-4.6-judge';

const FOUR_TERMINAL_PARTICIPANTS: ParticipantConfig[] = [
    { sessionId: 'term-codex', modelId: 'gpt-5.3-codex', title: 'GPT-5.3 Codex' },
    { sessionId: 'term-gpt', modelId: 'gpt-5.2', title: 'GPT-5.2' },
    { sessionId: 'term-claude', modelId: 'claude-opus-4.6', title: 'Claude Opus 4.6' },
    { sessionId: 'term-gemini', modelId: 'gemini-3-pro', title: 'Gemini 3 Pro' },
];

const ROUND_ONE_RESPONSES: Record<string, string> = {
    'gpt-5.3-codex': [
        'I agree with using deterministic validation and shared acceptance checks.',
        '1. **Shared acceptance rubric** keeps all terminals aligned.',
        '2. **Structured disagreement tags** make conflicts traceable.',
        '3. **Automated arbitration** should run once evidence is comparable.',
        'Confidence: 70%',
    ].join('\n'),
    'gpt-5.2': [
        'I strongly disagree with automatic arbitration this early because unresolved conflicts can slip through.',
        '1. **Evidence threshold** must be explicit before synthesis.',
        '2. **Retry budget** should be enforced per terminal.',
        '3. **Manual stop gate** is required when conflict remains high.',
        'Confidence: 62%',
    ].join('\n'),
    'claude-opus-4.6': [
        'I agree with keeping a deterministic protocol and explicit evidence fields.',
        '1. **Shared acceptance rubric** should be mandatory.',
        '2. **Conflict tags** should mark unresolved claims.',
        '3. **Judge pass** can synthesize once disputes narrow.',
        'Confidence: 68%',
    ].join('\n'),
    'gemini-3-pro': [
        'I strongly disagree with a mandatory manual gate on every run because it slows resolution.',
        '1. **Retry budget** should be bounded to avoid stalls.',
        '2. **Automated judge pass** is acceptable after convergence.',
        '3. **Time-boxing** is necessary for throughput.',
        'Confidence: 64%',
    ].join('\n'),
};

const ROUND_TWO_RESPONSES: Record<string, string> = {
    'gpt-5.3-codex': [
        'I agree with the converged protocol for four-terminal resolution.',
        '1. **Shared acceptance rubric** for all terminals.',
        '2. **Evidence threshold plus retry budget** before synthesis.',
        '3. **Judge synthesis** after convergence or max rounds.',
        'Confidence: 93%',
    ].join('\n'),
    'gpt-5.2': [
        'I agree with the converged protocol for four-terminal resolution.',
        '1. **Shared acceptance rubric** for all terminals.',
        '2. **Evidence threshold plus retry budget** before synthesis.',
        '3. **Judge synthesis** after convergence or max rounds.',
        'Confidence: 91%',
    ].join('\n'),
    'claude-opus-4.6': [
        'I agree with the converged protocol for four-terminal resolution.',
        '1. **Shared acceptance rubric** for all terminals.',
        '2. **Evidence threshold plus retry budget** before synthesis.',
        '3. **Judge synthesis** after convergence or max rounds.',
        'Confidence: 92%',
    ].join('\n'),
    'gemini-3-pro': [
        'I agree with the converged protocol for four-terminal resolution.',
        '1. **Shared acceptance rubric** for all terminals.',
        '2. **Evidence threshold plus retry budget** before synthesis.',
        '3. **Judge synthesis** after convergence or max rounds.',
        'Confidence: 90%',
    ].join('\n'),
};

function createMockDebateTransport() {
    const callCounts = new Map<string, number>();

    const getRoundResponse = (modelId: string, round: 1 | 2): string => {
        const response = round === 1 ? ROUND_ONE_RESPONSES[modelId] : ROUND_TWO_RESPONSES[modelId];
        if (!response) {
            throw new Error(`No mock response for model "${modelId}" in round ${round}.`);
        }
        return response;
    };

    const sendMessage = async (modelId: string): Promise<string> => {
        const currentCount = (callCounts.get(modelId) ?? 0) + 1;
        callCounts.set(modelId, currentCount);

        if (modelId === JUDGE_MODEL_ID) {
            return [
                'Executive Summary: The four terminals converged on the same operating protocol.',
                'Consensus Points: shared acceptance rubric, evidence threshold, retry budget, and judge synthesis.',
                'Resolution of Disputes: manual-only gating was narrowed to exception handling, not default flow.',
                'Final Recommendation: run two debate rounds, then trigger judge synthesis when consensus is strong.',
                'Confidence Level: high.',
                'Caveats: escalate to manual review only when conflicts remain unresolved after retries.',
            ].join('\n');
        }

        if (currentCount === 1) {
            return getRoundResponse(modelId, 1);
        }

        return getRoundResponse(modelId, 2);
    };

    return { sendMessage, callCounts };
}

async function runFourTerminalCycle(topic: string) {
    const { sendMessage, callCounts } = createMockDebateTransport();
    const events: BounceEvent[] = [];
    const orchestrator = new BounceOrchestrator(sendMessage);

    const unsubscribe = orchestrator.subscribe((event) => {
        events.push(event);
    });

    try {
        await orchestrator.dispatch({
            type: 'START',
            topic,
            participants: FOUR_TERMINAL_PARTICIPANTS.map((participant) => ({ ...participant })),
            config: {
                mode: 'sequential',
                maxRounds: 4,
                pauseBetweenResponses: 0,
                allowUserInterjection: false,
                autoStopOnConsensus: false,
                enablePruning: false,
                consensusThreshold: 0.78,
                judgeModelId: JUDGE_MODEL_ID,
            },
        });
    } finally {
        unsubscribe();
    }

    return {
        events,
        callCounts,
        state: orchestrator.getState(),
    };
}

describe('four-terminal stress cycle', () => {
    it('completes query-to-resolution flow across four model terminals', async () => {
        const result = await runFourTerminalCycle(
            'Design a deterministic protocol for four model terminals to converge on one final recommendation.'
        );

        expect(result.state.status).toBe('complete');
        expect(result.state.finalAnswer).toContain('Final Recommendation');
        expect(result.state.rounds.length).toBeGreaterThanOrEqual(2);
        expect(result.state.rounds[0]?.responses).toHaveLength(4);
        expect(result.state.rounds[1]?.responses).toHaveLength(4);
        expect(result.state.consensus?.score ?? 0).toBeGreaterThanOrEqual(0.78);

        expect(result.events.some((event) => event.type === 'JUDGING_STARTED')).toBe(true);
        expect(result.events.some((event) => event.type === 'BOUNCE_COMPLETE')).toBe(true);

        for (const participant of FOUR_TERMINAL_PARTICIPANTS) {
            expect(result.callCounts.get(participant.modelId)).toBeGreaterThanOrEqual(2);
        }
        expect(result.callCounts.get(JUDGE_MODEL_ID)).toBe(1);
    });

    it('holds up across repeated four-terminal runs (stress)', async () => {
        const runs = await Promise.all(
            Array.from({ length: 12 }, (_, index) =>
                runFourTerminalCycle(`Stress run ${index + 1}: reach one merged answer from four terminals.`)
            )
        );

        for (const run of runs) {
            expect(run.state.status).toBe('complete');
            expect((run.state.finalAnswer || '').length).toBeGreaterThan(120);
            expect(run.events.some((event) => event.type === 'BOUNCE_COMPLETE')).toBe(true);
            expect(run.state.rounds.length).toBeGreaterThanOrEqual(1);
            expect(run.callCounts.get(JUDGE_MODEL_ID)).toBe(1);
        }
    });
});
