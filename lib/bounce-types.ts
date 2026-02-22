/**
 * Bounce/Debate Types for Agent Conductor
 *
 * Enables multi-LLM debate until consensus is reached.
 * Inspired by SENTINEL's AgenticRagOrchestrator pattern.
 */

// ============================================================================
// Core Bounce Configuration
// ============================================================================

export type BounceMode = 'sequential' | 'parallel';
export type BounceConsensusMode = 'majority' | 'weighted' | 'unanimous';

export interface BounceConfig {
    /** Models participating in the debate */
    participants: ParticipantConfig[];

    /** Sequential (round-robin) or parallel (all at once) */
    mode: BounceMode;

    /** Maximum rounds before forcing conclusion */
    maxRounds: number;

    /** Consensus threshold (0.0-1.0) to auto-stop */
    consensusThreshold: number;

    /** Deterministic vote mode used for consensus detection */
    consensusMode: BounceConsensusMode;

    /** Minimum consecutive rounds meeting consensus criteria before auto-stop */
    minimumStableRounds: number;

    /** Minimum support ratio for the leading resolution proposal (0.0-1.0) */
    resolutionQuorum: number;

    /** Milliseconds between responses (for user reading) */
    pauseBetweenResponses: number;

    /** Allow user to inject messages between rounds */
    allowUserInterjection: boolean;

    /** Model that makes final synthesis/decision */
    judgeModelId: string;

    /** Auto-stop when consensus reached */
    autoStopOnConsensus: boolean;

    /** Prune aligned participants between rounds to reduce API costs */
    enablePruning: boolean;

    /** Similarity threshold above which a participant is pruned (0.0-1.0) */
    pruningThreshold: number;

    /** Approximate token budget for debate context passed to each model */
    maxContextTokens: number;

    /** Retry budget for each participant turn after transient provider failures */
    maxResponseRetries: number;

    /** Base delay before retrying a failed participant turn (milliseconds) */
    retryBackoffMs: number;
}

export interface ParticipantConfig {
    sessionId: string;
    modelId: string;
    title: string;
    systemPrompt?: string;
    /** User-defined trust prior (1-5). Higher means stronger decision influence. */
    userWeight?: number;
    /** Reliability prior derived from historical outcomes (0.5-1.5 typical). */
    reliabilityWeight?: number;
}

export const DEFAULT_BOUNCE_CONFIG: BounceConfig = {
    participants: [],
    mode: 'sequential',
    maxRounds: 3,
    consensusThreshold: 0.7,
    consensusMode: 'weighted',
    minimumStableRounds: 2,
    resolutionQuorum: 0.75,
    pauseBetweenResponses: 500,
    allowUserInterjection: true,
    judgeModelId: 'claude-opus-4.6',
    autoStopOnConsensus: true,
    enablePruning: false,
    pruningThreshold: 0.85,
    maxContextTokens: 8000,
    maxResponseRetries: 1,
    retryBackoffMs: 800,
};

// ============================================================================
// Bounce State Machine
// ============================================================================

export type BounceStatus =
    | 'idle'
    | 'configuring'      // User selecting participants
    | 'running'          // Debate in progress
    | 'paused'           // User paused
    | 'waiting_user'     // Waiting for user interjection
    | 'consensus'        // Consensus reached
    | 'max_rounds'       // Hit max rounds
    | 'judging'          // Judge model synthesizing
    | 'complete'         // Final answer delivered
    | 'error';

export interface BounceState {
    status: BounceStatus;
    config: BounceConfig;

    /** The original topic/question being debated */
    originalTopic: string;

    /** Session that initiated the bounce */
    sourceSessionId: string;

    /** Current round number (1-indexed) */
    currentRound: number;

    /** Current participant index within round */
    currentParticipantIndex: number;

    /** All rounds of debate */
    rounds: BounceRound[];

    /** Latest consensus analysis */
    consensus: ConsensusAnalysis | null;

    /** Final synthesized answer (after judging) */
    finalAnswer: string | null;

    /** Participants removed by pruning (still tracked for display) */
    prunedParticipants: Array<{ sessionId: string; modelTitle: string; prunedAtRound: number }>;

    /** Error message if status is 'error' */
    error: string | null;

    /** Timestamps for metrics */
    startedAt: number | null;
    completedAt: number | null;
}

export const INITIAL_BOUNCE_STATE: BounceState = {
    status: 'idle',
    config: DEFAULT_BOUNCE_CONFIG,
    originalTopic: '',
    sourceSessionId: '',
    currentRound: 0,
    currentParticipantIndex: 0,
    rounds: [],
    consensus: null,
    prunedParticipants: [],
    finalAnswer: null,
    error: null,
    startedAt: null,
    completedAt: null,
};

// ============================================================================
// Bounce Rounds and Responses
// ============================================================================

export interface BounceRound {
    roundNumber: number;
    responses: BounceResponse[];
    consensusAtEnd: ConsensusAnalysis;
    timestamp: number;
}

export interface BounceResponse {
    participantSessionId: string;
    modelId: string;
    modelTitle: string;

    /** The stance this model is taking */
    stance: ResponseStance;

    /** The actual response content */
    content: string;

    /** Key points extracted from the response */
    keyPoints: string[];

    /** Points of agreement with previous responses */
    agreements: string[];

    /** Points of disagreement */
    disagreements: string[];

    /** Confidence in their position (if model provides it) */
    confidence: number;

    /** User-defined trust prior used in weighted consensus. */
    userWeight?: number;

    /** Reliability prior used in weighted consensus. */
    reliabilityWeight?: number;

    /** Bounded confidence multiplier derived from `confidence`. */
    confidenceModifier?: number;

    /** Raw influence before normalized share capping. */
    rawInfluence?: number;

    /** Normalized influence share after capping (0.0-1.0). */
    effectiveInfluence?: number;

    /** Time taken to generate */
    durationMs: number;

    timestamp: number;
}

export type ResponseStance =
    | 'strongly_agree'
    | 'agree'
    | 'neutral'
    | 'disagree'
    | 'strongly_disagree'
    | 'refine'        // Agrees but wants to improve
    | 'synthesize';   // Attempting to merge views

// ============================================================================
// Consensus Analysis
// ============================================================================

export interface ConsensusAnalysis {
    /** Overall consensus score (0.0 = total disagreement, 1.0 = full consensus) */
    score: number;

    /** Outcome from deterministic vote logic */
    consensusOutcome: 'reached' | 'not-reached' | 'deadlock';

    /** Raw vote score from deterministic consensus mode */
    voteScore: number;

    /** Consensus level for UI display */
    level: 'none' | 'low' | 'partial' | 'strong' | 'unanimous';

    /** Points all participants agree on */
    agreedPoints: string[];

    /** Points of active disagreement */
    disputedPoints: string[];

    /** Points that need clarification */
    unclearPoints: string[];

    /** Stance breakdown by participant */
    stanceBreakdown: Record<string, ResponseStance>;

    /** Trend: is consensus increasing or decreasing? */
    trend: 'improving' | 'stable' | 'degrading';

    /** Recommendation for next action */
    recommendation: ConsensusRecommendation;

    /** Consecutive rounds that meet configured stop criteria */
    stableRounds: number;

    /** Leading proposal convergence metadata */
    proposalConvergence: {
        leadingProposal: string;
        supportRatio: number;
        supporters: string[];
        dissenters: string[];
    };

    /** User-weighted consensus diagnostics and explainability metadata. */
    influence: {
        /** Weighted support score in [-1, 1] using stance + influence shares. */
        weightedSupportScore: number;
        /** Weighted support ratio in [0, 1] for threshold comparisons. */
        weightedSupportRatio: number;
        /** True when unweighted consensus gate passed. */
        unweightedGatePassed: boolean;
        /** True when weighted consensus gate passed. */
        weightedGatePassed: boolean;
        /** Per-model explainability breakdown. */
        modelBreakdown: Array<{
            sessionId: string;
            modelId: string;
            modelTitle: string;
            userWeight: number;
            reliabilityWeight: number;
            confidenceModifier: number;
            stanceValue: number;
            rawInfluence: number;
            effectiveShare: number;
            signedContribution: number;
        }>;
    };
}

export type ConsensusRecommendation =
    | 'continue'         // Keep debating
    | 'focus_dispute'    // Narrow to disputed points
    | 'request_evidence' // Ask for supporting evidence
    | 'call_judge'       // Ready for judge to synthesize
    | 'deadlock'         // Unlikely to reach consensus
    | 'complete';        // Consensus achieved

// ============================================================================
// Bounce Events (for UI updates)
// ============================================================================

export type BounceEvent =
    | { type: 'BOUNCE_STARTED'; topic: string; participants: ParticipantConfig[] }
    | { type: 'ROUND_STARTED'; roundNumber: number }
    | { type: 'PARTICIPANT_THINKING'; sessionId: string; modelId: string }
    | { type: 'PARTICIPANT_RESPONDED'; response: BounceResponse }
    | { type: 'ROUND_COMPLETE'; round: BounceRound }
    | { type: 'CONSENSUS_UPDATED'; consensus: ConsensusAnalysis }
    | { type: 'USER_INTERJECTION_REQUESTED' }
    | { type: 'USER_INTERJECTED'; message: string }
    | { type: 'JUDGING_STARTED' }
    | { type: 'BOUNCE_PAUSED' }
    | { type: 'BOUNCE_RESUMED' }
    | { type: 'BOUNCE_COMPLETE'; finalAnswer: string; consensus: ConsensusAnalysis }
    | { type: 'BOUNCE_ERROR'; error: string }
    | { type: 'BOUNCE_CANCELLED' }
    | { type: 'PARTICIPANT_PRUNED'; sessionId: string; modelTitle: string; reason: string };

export type BounceEventHandler = (event: BounceEvent) => void;

// ============================================================================
// Bounce Actions (user commands)
// ============================================================================

export type BounceAction =
    | { type: 'START'; topic: string; participants: ParticipantConfig[]; config?: Partial<BounceConfig> }
    | { type: 'PAUSE' }
    | { type: 'RESUME' }
    | { type: 'STOP' }
    | { type: 'INJECT_MESSAGE'; message: string }
    | { type: 'SKIP_TO_JUDGE' }
    | { type: 'ADD_PARTICIPANT'; participant: ParticipantConfig }
    | { type: 'REMOVE_PARTICIPANT'; sessionId: string }
    | { type: 'UPDATE_CONFIG'; config: Partial<BounceConfig> };

// ============================================================================
// Shared Knowledge (extracted from debates)
// ============================================================================

export interface SharedKnowledgeEntry {
    id: string;
    /** The topic of the debate this was extracted from */
    debateTopic: string;
    /** Agreed-upon finding */
    finding: string;
    /** How confident the models were (consensus score at time of extraction) */
    confidence: number;
    /** Which models participated */
    participants: string[];
    /** When this was captured */
    capturedAt: number;
    /** Source debate session ID */
    sourceDebateId: string;
}

export interface DebateFindings {
    /** Points all models agreed on */
    agreements: SharedKnowledgeEntry[];
    /** Points that remained disputed */
    disputes: string[];
    /** The overall consensus score */
    consensusScore: number;
    /** The debate topic */
    topic: string;
    /** Source debate session ID */
    debateId: string;
}

// ============================================================================
// Bounce Metrics (for analytics)
// ============================================================================

export interface BounceMetrics {
    totalRounds: number;
    totalResponses: number;
    totalDurationMs: number;
    averageResponseTimeMs: number;
    consensusTrend: number[];  // Score at end of each round
    participantContributions: Record<string, number>;  // Response count per participant
    stanceDistribution: Record<ResponseStance, number>;
    finalConsensusScore: number;
    wasConsensusReached: boolean;
    wasJudgeUsed: boolean;
}

// ============================================================================
// Serialization helpers
// ============================================================================

export interface SerializedBounceSession {
    id: string;
    topic: string;
    startedAt: number;
    completedAt: number | null;
    participants: ParticipantConfig[];
    rounds: BounceRound[];
    finalAnswer: string | null;
    metrics: BounceMetrics;
}

export function serializeBounceSession(state: BounceState): SerializedBounceSession {
    return {
        id: `bounce-${state.startedAt}`,
        topic: state.originalTopic,
        startedAt: state.startedAt || Date.now(),
        completedAt: state.completedAt,
        participants: state.config.participants,
        rounds: state.rounds,
        finalAnswer: state.finalAnswer,
        metrics: calculateBounceMetrics(state),
    };
}

export function calculateBounceMetrics(state: BounceState): BounceMetrics {
    const allResponses = state.rounds.flatMap(r => r.responses);
    const totalDurationMs = state.completedAt && state.startedAt
        ? state.completedAt - state.startedAt
        : 0;

    const stanceDistribution: Record<ResponseStance, number> = {
        strongly_agree: 0,
        agree: 0,
        neutral: 0,
        disagree: 0,
        strongly_disagree: 0,
        refine: 0,
        synthesize: 0,
    };

    const participantContributions: Record<string, number> = {};

    allResponses.forEach(r => {
        stanceDistribution[r.stance]++;
        participantContributions[r.participantSessionId] =
            (participantContributions[r.participantSessionId] || 0) + 1;
    });

    return {
        totalRounds: state.rounds.length,
        totalResponses: allResponses.length,
        totalDurationMs,
        averageResponseTimeMs: allResponses.length > 0
            ? allResponses.reduce((sum, r) => sum + r.durationMs, 0) / allResponses.length
            : 0,
        consensusTrend: state.rounds.map(r => r.consensusAtEnd.score),
        participantContributions,
        stanceDistribution,
        finalConsensusScore: state.consensus?.score || 0,
        wasConsensusReached: state.status === 'consensus' || state.status === 'complete',
        wasJudgeUsed: state.status === 'judging' || state.finalAnswer !== null,
    };
}
