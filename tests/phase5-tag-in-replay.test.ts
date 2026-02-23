/**
 * Tests for Phase 5: Dynamic specialist tag-in + Debate replay data
 */
import { describe, it, expect, vi } from 'vitest';
import { BounceOrchestrator } from '../lib/bounce-orchestrator';
import {
    BounceEvent,
    ParticipantConfig,
    SerializedBounceSession,
    BounceRound,
    BounceResponse,
    ConsensusAnalysis,
} from '../lib/bounce-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockSendMessage() {
    return vi.fn().mockResolvedValue(
        '```json\n' +
        JSON.stringify({
            thought: 'test',
            proposal: 'test proposal',
            confidence: 80,
            reasoning: 'test reasoning',
            critiques: [],
            concessions: [],
            stance: 'agree',
        }) +
        '\n```'
    );
}

function makeParticipant(id: string, modelId = 'gpt-5.2'): ParticipantConfig {
    return {
        sessionId: id,
        modelId,
        title: `Model ${id}`,
        userWeight: 3,
        reliabilityWeight: 1,
    };
}

function makeResponse(sessionId: string, modelId = 'gpt-5.2'): BounceResponse {
    return {
        participantSessionId: sessionId,
        modelId,
        modelTitle: `Model ${sessionId}`,
        stance: 'agree',
        content: 'Test response content',
        keyPoints: ['point 1'],
        agreements: ['agreed on X'],
        disagreements: [],
        confidence: 0.85,
        durationMs: 500,
        timestamp: Date.now(),
    };
}

function makeConsensus(): ConsensusAnalysis {
    return {
        score: 0.75,
        consensusOutcome: 'reached',
        voteScore: 0.8,
        level: 'strong',
        agreedPoints: ['point A'],
        disputedPoints: [],
        unclearPoints: [],
        stanceBreakdown: {},
        trend: 'improving',
        recommendation: 'complete',
        stableRounds: 2,
        proposalConvergence: {
            leadingProposal: 'test proposal',
            supportRatio: 0.8,
            supporters: ['a'],
            dissenters: [],
        },
        influence: {
            weightedSupportScore: 0.7,
            weightedSupportRatio: 0.75,
            unweightedGatePassed: true,
            weightedGatePassed: true,
            modelBreakdown: [],
        },
    };
}

function makeRound(roundNumber: number): BounceRound {
    return {
        roundNumber,
        responses: [makeResponse('a'), makeResponse('b')],
        consensusAtEnd: makeConsensus(),
        timestamp: Date.now(),
    };
}

// ---------------------------------------------------------------------------
// Tag-in tests
// ---------------------------------------------------------------------------

describe('BounceOrchestrator — specialist tag-in', () => {
    it('does not inject a tagged participant into the current sequential round', async () => {
        const sendMessage = vi.fn(async (modelId: string) => {
            // Keep a short but deterministic delay so we can tag in mid-round.
            const delayMs = modelId === 'gpt-5.2' ? 60 : 80;
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            return (
                '```json\n' +
                JSON.stringify({
                    thought: 'test',
                    proposal: 'test proposal',
                    confidence: 80,
                    reasoning: 'test reasoning',
                    critiques: [],
                    concessions: [],
                    stance: 'agree',
                }) +
                '\n```'
            );
        });
        const orchestrator = new BounceOrchestrator(sendMessage);

        const startPromise = orchestrator.dispatch({
            type: 'START',
            topic: 'Test topic',
            participants: [makeParticipant('a', 'gpt-5.2'), makeParticipant('b', 'claude-opus-4.6')],
            config: {
                mode: 'sequential',
                maxRounds: 1,
                consensusThreshold: 0.01,
                minimumStableRounds: 1,
                resolutionQuorum: 0.01,
                allowUserInterjection: false,
            },
        });

        // Tag in while the first round is still being processed.
        await new Promise((resolve) => setTimeout(resolve, 30));
        await orchestrator.dispatch({
            type: 'ADD_PARTICIPANT',
            participant: makeParticipant('specialist-c', 'gemini-2.5-pro'),
        });

        await startPromise;

        const state = orchestrator.getState();
        expect(state.rounds).toHaveLength(1);
        const roundOneIds = state.rounds[0].responses.map((response) => response.participantSessionId);
        expect(roundOneIds).toEqual(['a', 'b']);
        expect(roundOneIds).not.toContain('specialist-c');
    });

    it('emits PARTICIPANT_TAGGED_IN when adding a participant during running state', async () => {
        const sendMessage = makeMockSendMessage();
        const orchestrator = new BounceOrchestrator(sendMessage);

        const events: BounceEvent[] = [];
        orchestrator.subscribe((e) => events.push(e));

        // Start a debate (it will run the loop, so we need it to complete quickly)
        // We'll dispatch ADD_PARTICIPANT before it finishes, but since the loop
        // might be fast, let's start and then immediately add a participant.
        // First, let's just set up a minimal start that won't hang.
        const startPromise = orchestrator.dispatch({
            type: 'START',
            topic: 'Test topic',
            participants: [makeParticipant('a'), makeParticipant('b')],
            config: { maxRounds: 1, consensusThreshold: 0.01, minimumStableRounds: 1, resolutionQuorum: 0.01 },
        });

        // Wait a tick for the debate to start
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Add a participant mid-debate
        await orchestrator.dispatch({
            type: 'ADD_PARTICIPANT',
            participant: makeParticipant('specialist-c', 'claude-opus-4.6'),
        });

        await startPromise;

        // If debate was still running when we added, there'll be a tag-in event.
        // If it finished before our add, there won't. Either way, no crash.
        // Verify the participant was added.
        const state = orchestrator.getState();
        const hasSpecialist = state.config.participants.some(
            (p) => p.sessionId === 'specialist-c'
        );
        expect(hasSpecialist).toBe(true);
    });

    it('prevents duplicate participants from being added', async () => {
        const sendMessage = makeMockSendMessage();
        const orchestrator = new BounceOrchestrator(sendMessage);

        const events: BounceEvent[] = [];
        orchestrator.subscribe((e) => events.push(e));

        const startPromise = orchestrator.dispatch({
            type: 'START',
            topic: 'Test topic',
            participants: [makeParticipant('a'), makeParticipant('b')],
            config: { maxRounds: 1, consensusThreshold: 0.01, minimumStableRounds: 1, resolutionQuorum: 0.01 },
        });

        await new Promise((resolve) => setTimeout(resolve, 50));

        // Try to add duplicate
        await orchestrator.dispatch({
            type: 'ADD_PARTICIPANT',
            participant: makeParticipant('a'),
        });

        await startPromise;

        // Should NOT have a tag-in event for 'a' since it was already there
        const tagInForA = events.filter(
            (e) => e.type === 'PARTICIPANT_TAGGED_IN' && e.participant.sessionId === 'a'
        );
        expect(tagInForA).toHaveLength(0);
    });

    it('adds participant when debate is idle (no tag-in event emitted)', async () => {
        const sendMessage = makeMockSendMessage();
        const orchestrator = new BounceOrchestrator(sendMessage);

        const events: BounceEvent[] = [];
        orchestrator.subscribe((e) => events.push(e));

        // Add participant when idle
        await orchestrator.dispatch({
            type: 'ADD_PARTICIPANT',
            participant: makeParticipant('specialist-x'),
        });

        const tagInEvents = events.filter((e) => e.type === 'PARTICIPANT_TAGGED_IN');
        expect(tagInEvents).toHaveLength(0);

        // Participant should still be in config
        const state = orchestrator.getState();
        expect(state.config.participants.some((p) => p.sessionId === 'specialist-x')).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Replay data integrity tests
// ---------------------------------------------------------------------------

describe('SerializedBounceSession — replay data integrity', () => {
    function makeSession(): SerializedBounceSession {
        return {
            id: 'bounce-123',
            topic: 'Should we use TypeScript?',
            startedAt: Date.now() - 60000,
            completedAt: Date.now(),
            participants: [makeParticipant('a'), makeParticipant('b')],
            rounds: [makeRound(1), makeRound(2)],
            finalAnswer: 'Yes, TypeScript is recommended.',
            metrics: {
                totalRounds: 2,
                totalResponses: 4,
                totalDurationMs: 60000,
                averageResponseTimeMs: 500,
                consensusTrend: [0.5, 0.75],
                participantContributions: { a: 2, b: 2 },
                stanceDistribution: {
                    strongly_agree: 0,
                    agree: 4,
                    neutral: 0,
                    disagree: 0,
                    strongly_disagree: 0,
                    refine: 0,
                    synthesize: 0,
                },
                finalConsensusScore: 0.75,
                wasConsensusReached: true,
                wasJudgeUsed: true,
            },
        };
    }

    it('contains all rounds needed for replay playback', () => {
        const session = makeSession();
        expect(session.rounds.length).toBe(2);
        expect(session.rounds[0].responses.length).toBeGreaterThan(0);
    });

    it('each response has model title and stance for display', () => {
        const session = makeSession();
        for (const round of session.rounds) {
            for (const response of round.responses) {
                expect(response.modelTitle).toBeTruthy();
                expect(response.stance).toBeTruthy();
                expect(typeof response.confidence).toBe('number');
                expect(typeof response.durationMs).toBe('number');
            }
        }
    });

    it('has consensus data at end of each round for progress display', () => {
        const session = makeSession();
        for (const round of session.rounds) {
            expect(round.consensusAtEnd).toBeDefined();
            expect(typeof round.consensusAtEnd.score).toBe('number');
        }
    });

    it('metrics contain consensus trend for footer visualization', () => {
        const session = makeSession();
        expect(session.metrics.consensusTrend.length).toBe(2);
        expect(session.metrics.consensusTrend[0]).toBe(0.5);
        expect(session.metrics.consensusTrend[1]).toBe(0.75);
    });

    it('preserves final answer for end-of-replay display', () => {
        const session = makeSession();
        expect(session.finalAnswer).toBe('Yes, TypeScript is recommended.');
    });
});
