import { describe, expect, it } from 'vitest';
import type { BounceResponse, BounceRound, ResponseStance } from '@/lib/bounce-types';
import { analyzeConsensus, updateConsensusWithTrend } from '@/lib/consensus-analyzer';

function makeResponse(
    sessionId: string,
    stance: ResponseStance,
    confidence: number,
    proposal: string,
): BounceResponse {
    return {
        participantSessionId: sessionId,
        modelId: sessionId,
        modelTitle: sessionId,
        stance,
        content: [
            `STANCE: ${stance}`,
            `CONFIDENCE: ${Math.round(confidence * 100)}%`,
            `PROPOSED_RESOLUTION: ${proposal}`,
            'AGREEMENTS:',
            '- shared protocol',
            'DISAGREEMENTS:',
            '- none',
            'RISK: timeout drift',
            'MITIGATION: bounded retries',
            'RATIONALE: deterministic convergence',
        ].join('\n'),
        keyPoints: [proposal],
        agreements: ['shared protocol'],
        disagreements: [],
        confidence,
        durationMs: 1000,
        timestamp: Date.now(),
    };
}

describe('collective agreement analyzer', () => {
    it('reaches deterministic consensus when vote and proposal quorum align', () => {
        const responses: BounceResponse[] = [
            makeResponse('gpt-5.3-codex', 'agree', 0.92, 'Use lease-based handoff with receiver ACK before ownership transfer.'),
            makeResponse('gpt-5.2', 'agree', 0.9, 'Use lease-based handoff with receiver ACK before ownership transfer.'),
            makeResponse('claude-opus-4.6', 'refine', 0.89, 'Use lease-based handoff with receiver ACK before ownership transfer.'),
            makeResponse('gemini-3-pro', 'disagree', 0.6, 'Use manual handoff checkpoints only.'),
        ];

        const consensus = analyzeConsensus(responses, {
            consensusMode: 'majority',
            consensusThreshold: 0.7,
            resolutionQuorum: 0.75,
        });

        expect(consensus.consensusOutcome).toBe('reached');
        expect(consensus.proposalConvergence.supportRatio).toBeGreaterThanOrEqual(0.75);
        expect(consensus.voteScore).toBeGreaterThan(0.5);
        expect(consensus.recommendation === 'complete' || consensus.recommendation === 'call_judge').toBe(true);
    });

    it('avoids judge escalation when consensus and convergence remain weak', () => {
        const responses: BounceResponse[] = [
            makeResponse('gpt-5.3-codex', 'disagree', 0.8, 'Reject proposal A and require full rewrite.'),
            makeResponse('gpt-5.2', 'disagree', 0.78, 'Reject proposal B and stop debate.'),
            makeResponse('claude-opus-4.6', 'strongly_disagree', 0.82, 'Reject all proposals due to missing evidence.'),
            makeResponse('gemini-3-pro', 'neutral', 0.45, 'Need more information before approving.'),
        ];

        const consensus = analyzeConsensus(responses, {
            consensusMode: 'weighted',
            consensusThreshold: 0.7,
            resolutionQuorum: 0.75,
        });

        expect(consensus.consensusOutcome).toBe('not-reached');
        expect(consensus.score).toBeLessThan(0.5);
        expect(consensus.recommendation === 'complete' || consensus.recommendation === 'call_judge').toBe(false);
    });

    it('requires consecutive stable rounds before final completion', () => {
        const priorResponses: BounceResponse[] = [
            makeResponse('gpt-5.3-codex', 'agree', 0.9, 'Adopt deterministic lease handoff with ack.'),
            makeResponse('gpt-5.2', 'agree', 0.9, 'Adopt deterministic lease handoff with ACK.'),
            makeResponse('claude-opus-4.6', 'agree', 0.9, 'Adopt deterministic lease handoff with required ack.'),
            makeResponse('gemini-3-pro', 'agree', 0.88, 'Adopt deterministic lease handoff with ack.'),
        ];

        const priorConsensus = analyzeConsensus(priorResponses, {
            consensusMode: 'weighted',
            consensusThreshold: 0.7,
            resolutionQuorum: 0.75,
        });

        const priorRound: BounceRound = {
            roundNumber: 1,
            responses: priorResponses,
            consensusAtEnd: priorConsensus,
            timestamp: Date.now() - 1000,
        };

        const currentConsensus = analyzeConsensus(priorResponses, {
            consensusMode: 'weighted',
            consensusThreshold: 0.7,
            resolutionQuorum: 0.75,
        });

        const updated = updateConsensusWithTrend(
            currentConsensus,
            [priorRound],
            {
                consensusMode: 'weighted',
                consensusThreshold: 0.7,
                resolutionQuorum: 0.75,
                minimumStableRounds: 2,
            }
        );

        expect(updated.stableRounds).toBe(2);
        expect(updated.recommendation).toBe('complete');
    });
});
