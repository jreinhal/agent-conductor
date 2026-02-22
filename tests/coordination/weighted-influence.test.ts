import { describe, expect, it } from 'vitest';
import type { BounceResponse, ResponseStance } from '@/lib/bounce-types';
import { analyzeConsensus } from '@/lib/consensus-analyzer';

function makeResponse(
    sessionId: string,
    stance: ResponseStance,
    confidence: number,
    proposal: string,
    userWeight: number,
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
            'RISK: split ownership',
            'MITIGATION: deterministic claim',
        ].join('\n'),
        keyPoints: [proposal],
        agreements: [],
        disagreements: [],
        confidence,
        userWeight,
        reliabilityWeight: 1,
        durationMs: 1000,
        timestamp: Date.now(),
    };
}

describe('weighted influence consensus', () => {
    it('increases contribution share for higher user-weight participants', () => {
        const responses: BounceResponse[] = [
            makeResponse('gpt-5.3-codex', 'agree', 0.8, 'Use monotonic lease handoff with ACK.', 5),
            makeResponse('gpt-5.2', 'agree', 0.8, 'Use monotonic lease handoff with ACK.', 3),
            makeResponse('claude-opus-4.6', 'disagree', 0.8, 'Use manual handoff checkpoints.', 1),
        ];

        const consensus = analyzeConsensus(responses, {
            consensusMode: 'majority',
            consensusThreshold: 0.7,
            resolutionQuorum: 0.66,
        });

        const breakdown = consensus.influence.modelBreakdown;
        const high = breakdown.find((entry) => entry.sessionId === 'gpt-5.3-codex');
        const low = breakdown.find((entry) => entry.sessionId === 'claude-opus-4.6');

        expect(high).toBeDefined();
        expect(low).toBeDefined();
        expect((high?.effectiveShare || 0)).toBeGreaterThan(low?.effectiveShare || 0);
    });

    it('can flip weighted gate outcome when dissent carries higher trust weight', () => {
        const baseResponses: BounceResponse[] = [
            makeResponse('gpt-5.3-codex', 'strongly_agree', 0.82, 'Adopt lease handoff.', 3),
            makeResponse('gpt-5.2', 'strongly_agree', 0.8, 'Adopt lease handoff.', 3),
            makeResponse('claude-opus-4.6', 'disagree', 0.85, 'Reject lease handoff.', 3),
        ];

        const weightedForAgreement = analyzeConsensus(baseResponses, {
            consensusMode: 'majority',
            consensusThreshold: 0.7,
            resolutionQuorum: 0.66,
        });

        const weightedForDissent = analyzeConsensus([
            { ...baseResponses[0], userWeight: 2 },
            { ...baseResponses[1], userWeight: 2 },
            { ...baseResponses[2], userWeight: 5 },
        ], {
            consensusMode: 'majority',
            consensusThreshold: 0.7,
            resolutionQuorum: 0.66,
        });

        expect(weightedForAgreement.influence.weightedSupportRatio).toBeGreaterThan(
            weightedForDissent.influence.weightedSupportRatio
        );
        expect(weightedForAgreement.influence.weightedGatePassed).toBe(true);
        expect(weightedForDissent.influence.weightedGatePassed).toBe(false);
    });
});
