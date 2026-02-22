/**
 * Enhanced Consensus Analyzer for Bounce/Debate
 *
 * Analyzes multiple model responses to determine consensus level,
 * identify agreements/disagreements, and recommend next actions.
 *
 * Inspired by SENTINEL's CRAG grading and confidence scoring patterns.
 */

import {
    BounceResponse,
    ConsensusAnalysis,
    ConsensusRecommendation,
    ResponseStance,
    BounceRound,
    DebateFindings,
    SharedKnowledgeEntry,
    BounceConsensusMode,
} from './bounce-types';
import { detectConsensus } from './coordination/consensus';
import type { ProtocolEntry, ProtocolRules, Stance } from './protocol/types';

// ============================================================================
// Similarity Calculation (Enhanced Jaccard)
// ============================================================================

/**
 * Calculate semantic similarity between two texts using enhanced word overlap
 */
function calculateSimilarity(text1: string, text2: string): number {
    if (!text1 || !text2) return 0;

    // Normalize and tokenize
    const normalize = (text: string) =>
        text
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 3); // Skip short words

    const words1 = new Set(normalize(text1));
    const words2 = new Set(normalize(text2));

    if (words1.size === 0 || words2.size === 0) return 0;

    // Jaccard similarity
    const intersection = [...words1].filter(w => words2.has(w));
    const union = new Set([...words1, ...words2]);

    return intersection.length / union.size;
}

/**
 * Calculate similarity with bigram overlap for better phrase matching
 */
function calculateBigramSimilarity(text1: string, text2: string): number {
    const getBigrams = (text: string): Set<string> => {
        const words = text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/);
        const bigrams = new Set<string>();
        for (let i = 0; i < words.length - 1; i++) {
            bigrams.add(`${words[i]} ${words[i + 1]}`);
        }
        return bigrams;
    };

    const bigrams1 = getBigrams(text1);
    const bigrams2 = getBigrams(text2);

    if (bigrams1.size === 0 || bigrams2.size === 0) return 0;

    const intersection = [...bigrams1].filter(b => bigrams2.has(b));
    const union = new Set([...bigrams1, ...bigrams2]);

    return intersection.length / union.size;
}

// ============================================================================
// Stance Analysis
// ============================================================================

/**
 * Convert stance to numeric value for averaging
 */
function stanceToNumeric(stance: ResponseStance): number {
    switch (stance) {
        case 'strongly_agree': return 1.0;
        case 'agree': return 0.75;
        case 'refine': return 0.6;
        case 'synthesize': return 0.5;
        case 'neutral': return 0.5;
        case 'disagree': return 0.25;
        case 'strongly_disagree': return 0.0;
        default: return 0.5;
    }
}

/**
 * Calculate stance alignment across responses
 */
function calculateStanceAlignment(responses: BounceResponse[]): number {
    if (responses.length < 2) return 1.0;

    const stanceValues = responses.map(r => stanceToNumeric(r.stance));
    const avgStance = stanceValues.reduce((a, b) => a + b, 0) / stanceValues.length;

    // Calculate variance (lower variance = higher alignment)
    const variance = stanceValues.reduce((sum, v) => sum + Math.pow(v - avgStance, 2), 0) / stanceValues.length;

    // Convert variance to alignment score (max variance is 0.25 when half agree, half disagree)
    const maxVariance = 0.25;
    const alignment = 1 - (variance / maxVariance);

    return Math.max(0, Math.min(1, alignment));
}

// ============================================================================
// Key Point Extraction and Matching
// ============================================================================

/**
 * Find common points across responses
 */
function findCommonPoints(responses: BounceResponse[]): string[] {
    if (responses.length < 2) return [];

    const allKeyPoints = responses.flatMap(r => r.keyPoints);
    const pointCounts = new Map<string, number>();

    // Count similar points
    allKeyPoints.forEach(point => {
        const normalizedPoint = point.toLowerCase().trim();
        let found = false;

        // Check if similar point already exists
        for (const [existingPoint, count] of pointCounts.entries()) {
            if (calculateSimilarity(normalizedPoint, existingPoint) > 0.5) {
                pointCounts.set(existingPoint, count + 1);
                found = true;
                break;
            }
        }

        if (!found) {
            pointCounts.set(normalizedPoint, 1);
        }
    });

    // Points mentioned by majority
    const threshold = Math.ceil(responses.length / 2);
    const commonPoints = [...pointCounts.entries()]
        .filter(([, count]) => count >= threshold)
        .map(([point]) => point);

    return commonPoints.slice(0, 5);
}

/**
 * Find disputed points across responses
 */
function findDisputedPoints(responses: BounceResponse[]): string[] {
    const allDisagreements = responses.flatMap(r => r.disagreements);
    const uniqueDisagreements = new Set<string>();

    allDisagreements.forEach(d => {
        const normalized = d.toLowerCase().trim();
        // Check if similar point already captured
        let isDuplicate = false;
        for (const existing of uniqueDisagreements) {
            if (calculateSimilarity(normalized, existing) > 0.5) {
                isDuplicate = true;
                break;
            }
        }
        if (!isDuplicate) {
            uniqueDisagreements.add(normalized);
        }
    });

    return [...uniqueDisagreements].slice(0, 5);
}

export interface ConsensusAnalysisOptions {
    consensusMode?: BounceConsensusMode;
    consensusThreshold?: number;
    resolutionQuorum?: number;
    minimumStableRounds?: number;
}

const DEFAULT_OPTIONS: Required<ConsensusAnalysisOptions> = {
    consensusMode: 'weighted',
    consensusThreshold: 0.7,
    resolutionQuorum: 0.75,
    minimumStableRounds: 2,
};

function toProtocolStance(stance: ResponseStance): Stance {
    switch (stance) {
        case 'strongly_agree':
        case 'agree':
        case 'refine':
        case 'synthesize':
            return 'approve';
        case 'disagree':
        case 'strongly_disagree':
            return 'reject';
        case 'neutral':
        default:
            return 'neutral';
    }
}

function makeProtocolRules(
    responses: BounceResponse[],
    options: Required<ConsensusAnalysisOptions>
): ProtocolRules {
    return {
        agents: responses.map((r) => r.participantSessionId),
        turnOrder: 'round-robin',
        maxTurnsPerRound: 1,
        turnTimeout: 300,
        consensusThreshold: options.consensusThreshold,
        consensusMode: options.consensusMode,
        escalation: 'human',
        maxRounds: 10,
        outputFormat: 'structured',
    };
}

function toProtocolEntries(responses: BounceResponse[]): ProtocolEntry[] {
    return responses.map((response, index) => ({
        metadata: {
            entryId: `${response.participantSessionId}-${response.timestamp}-${index}`,
            turn: index + 1,
            round: 1,
        },
        timestamp: new Date(response.timestamp).toISOString(),
        author: response.participantSessionId,
        status: 'yield',
        fields: {
            stance: toProtocolStance(response.stance),
            confidence: response.confidence,
            summary: response.keyPoints[0] || response.content.slice(0, 120),
            actionRequested: 'n/a',
            evidence: 'n/a',
        },
        body: response.content,
        hasYield: true,
    }));
}

function normalizeVoteScore(score: number, mode: BounceConsensusMode): number {
    if (mode === 'weighted') {
        // Weighted mode can be [-1, 1]. Normalize to [0, 1].
        return Math.max(0, Math.min(1, (score + 1) / 2));
    }
    return Math.max(0, Math.min(1, score));
}

function extractProposedResolution(response: BounceResponse): string {
    const content = response.content || '';
    const patterns = [
        /(?:^|\n)\s*(?:\*\*)?proposed[_\s-]?resolution(?:\*\*)?\s*[:\-]\s*(.+)/i,
        /(?:^|\n)\s*(?:\*\*)?final[_\s-]?recommendation(?:\*\*)?\s*[:\-]\s*(.+)/i,
        /(?:^|\n)\s*(?:\*\*)?recommendation(?:\*\*)?\s*[:\-]\s*(.+)/i,
        /(?:^|\n)\s*(?:\*\*)?conclusion(?:\*\*)?\s*[:\-]\s*(.+)/i,
    ];

    for (const pattern of patterns) {
        const match = content.match(pattern);
        if (match?.[1]) {
            return match[1].trim().slice(0, 280);
        }
    }

    if (response.keyPoints[0]) {
        return response.keyPoints[0].trim().slice(0, 280);
    }

    const firstSentence = content
        .replace(/\s+/g, ' ')
        .split(/[.!?](?:\s|$)/)
        .map((s) => s.trim())
        .find((s) => s.length > 20);
    return (firstSentence || content.slice(0, 180)).trim();
}

function extractProposalConvergence(responses: BounceResponse[]): {
    leadingProposal: string;
    supportRatio: number;
    supporters: string[];
    dissenters: string[];
} {
    if (responses.length === 0) {
        return {
            leadingProposal: '',
            supportRatio: 0,
            supporters: [],
            dissenters: [],
        };
    }

    const proposals = responses.map((response) => ({
        sessionId: response.participantSessionId,
        confidence: response.confidence,
        proposal: extractProposedResolution(response),
    }));

    const clusters: Array<{
        leader: string;
        members: string[];
        confidences: number[];
    }> = [];

    for (const proposal of proposals) {
        let matchedCluster: typeof clusters[number] | null = null;
        for (const cluster of clusters) {
            const wordSimilarity = calculateSimilarity(cluster.leader, proposal.proposal);
            const bigramSimilarity = calculateBigramSimilarity(cluster.leader, proposal.proposal);
            const combined = wordSimilarity * 0.6 + bigramSimilarity * 0.4;
            if (combined >= 0.62) {
                matchedCluster = cluster;
                break;
            }
        }

        if (matchedCluster) {
            matchedCluster.members.push(proposal.sessionId);
            matchedCluster.confidences.push(proposal.confidence);
        } else {
            clusters.push({
                leader: proposal.proposal,
                members: [proposal.sessionId],
                confidences: [proposal.confidence],
            });
        }
    }

    clusters.sort((a, b) => {
        const bySupport = b.members.length - a.members.length;
        if (bySupport !== 0) return bySupport;

        const avgA = a.confidences.reduce((sum, x) => sum + x, 0) / a.confidences.length;
        const avgB = b.confidences.reduce((sum, x) => sum + x, 0) / b.confidences.length;
        return avgB - avgA;
    });

    const top = clusters[0];
    const supporterSet = new Set(top.members);
    const dissenters = responses
        .map((r) => r.participantSessionId)
        .filter((id) => !supporterSet.has(id));

    return {
        leadingProposal: top.leader,
        supportRatio: top.members.length / responses.length,
        supporters: top.members,
        dissenters,
    };
}

// ============================================================================
// Main Consensus Analyzer
// ============================================================================

/**
 * Analyze consensus across a set of responses
 */
export function analyzeConsensus(
    responses: BounceResponse[],
    options: ConsensusAnalysisOptions = {},
): ConsensusAnalysis {
    const resolvedOptions: Required<ConsensusAnalysisOptions> = {
        ...DEFAULT_OPTIONS,
        ...options,
    };

    if (responses.length === 0) {
        return {
            score: 0,
            voteScore: 0,
            consensusOutcome: 'not-reached',
            level: 'none',
            agreedPoints: [],
            disputedPoints: [],
            unclearPoints: [],
            stanceBreakdown: {},
            trend: 'stable',
            recommendation: 'continue',
            stableRounds: 0,
            proposalConvergence: {
                leadingProposal: '',
                supportRatio: 0,
                supporters: [],
                dissenters: [],
            },
        };
    }

    if (responses.length === 1) {
        const only = responses[0];
        const proposal = extractProposedResolution(only);
        return {
            score: 1.0,
            voteScore: 1.0,
            consensusOutcome: 'reached',
            level: 'unanimous',
            agreedPoints: only.keyPoints,
            disputedPoints: [],
            unclearPoints: [],
            stanceBreakdown: { [only.participantSessionId]: only.stance },
            trend: 'stable',
            recommendation: 'complete',
            stableRounds: 1,
            proposalConvergence: {
                leadingProposal: proposal,
                supportRatio: 1,
                supporters: [only.participantSessionId],
                dissenters: [],
            },
        };
    }

    // Calculate pairwise content similarity
    let totalSimilarity = 0;
    let pairs = 0;

    for (let i = 0; i < responses.length; i++) {
        for (let j = i + 1; j < responses.length; j++) {
            const wordSimilarity = calculateSimilarity(responses[i].content, responses[j].content);
            const bigramSimilarity = calculateBigramSimilarity(responses[i].content, responses[j].content);
            totalSimilarity += (wordSimilarity * 0.6 + bigramSimilarity * 0.4);
            pairs++;
        }
    }

    const avgSimilarity = pairs > 0 ? totalSimilarity / pairs : 0;

    // Calculate stance alignment
    const stanceAlignment = calculateStanceAlignment(responses);

    // Build stance breakdown
    const stanceBreakdown: Record<string, ResponseStance> = {};
    responses.forEach(r => {
        stanceBreakdown[r.participantSessionId] = r.stance;
    });

    // Calculate deterministic vote consensus using protocol-grade logic.
    const rules = makeProtocolRules(responses, resolvedOptions);
    const protocolEntries = toProtocolEntries(responses);
    const voteConsensus = detectConsensus(protocolEntries, rules);

    // Proposal convergence enforces that models are converging on the same final recommendation,
    // not just similar tone/stance.
    const proposalConvergence = extractProposalConvergence(responses);

    // Calculate confidence-weighted semantic score
    const semanticScore = (avgSimilarity * 0.7) + (stanceAlignment * 0.3);
    const normalizedVoteScore = normalizeVoteScore(voteConsensus.score, resolvedOptions.consensusMode);

    // Hybrid score:
    // - deterministic vote score (45%)
    // - proposal convergence quorum (35%)
    // - semantic similarity/alignment (20%)
    const score =
        (normalizedVoteScore * 0.45) +
        (proposalConvergence.supportRatio * 0.35) +
        (semanticScore * 0.20);

    // Determine level
    let level: ConsensusAnalysis['level'];
    if (score >= 0.85) level = 'unanimous';
    else if (score >= 0.65) level = 'strong';
    else if (score >= 0.45) level = 'partial';
    else if (score >= 0.25) level = 'low';
    else level = 'none';

    // Extract agreed and disputed points
    const agreedPoints = findCommonPoints(responses);
    const disputedPoints = findDisputedPoints(responses);

    // Identify unclear points (mentioned by one, contradicted by another)
    const unclearPoints = responses
        .flatMap(r => r.keyPoints)
        .filter(point => {
            const isAgreed = agreedPoints.some(a => calculateSimilarity(a, point) > 0.5);
            const isDisputed = disputedPoints.some(d => calculateSimilarity(d, point) > 0.5);
            return !isAgreed && !isDisputed;
        })
        .slice(0, 3);

    // Determine recommendation
    const recommendation = determineRecommendation(
        score,
        responses.length,
        disputedPoints.length,
        voteConsensus.outcome,
        proposalConvergence.supportRatio,
        resolvedOptions.resolutionQuorum,
    );

    return {
        score,
        voteScore: voteConsensus.score,
        consensusOutcome: voteConsensus.outcome,
        level,
        agreedPoints,
        disputedPoints,
        unclearPoints,
        stanceBreakdown,
        trend: 'stable', // Will be updated by trend analyzer
        recommendation,
        stableRounds: 0,
        proposalConvergence,
    };
}

/**
 * Analyze consensus trend across rounds
 */
export function analyzeConsensusTrend(rounds: BounceRound[]): 'improving' | 'stable' | 'degrading' {
    if (rounds.length < 2) return 'stable';

    const scores = rounds.map(r => r.consensusAtEnd.score);
    const recent = scores.slice(-3); // Last 3 rounds

    if (recent.length < 2) return 'stable';

    const trend = recent[recent.length - 1] - recent[0];

    if (trend > 0.1) return 'improving';
    if (trend < -0.1) return 'degrading';
    return 'stable';
}

/**
 * Determine what action to recommend based on consensus state
 */
function determineRecommendation(
    score: number,
    participantCount: number,
    disputeCount: number,
    outcome: ConsensusAnalysis['consensusOutcome'],
    supportRatio: number,
    quorum: number,
): ConsensusRecommendation {
    if (outcome === 'deadlock') {
        return 'deadlock';
    }

    if (outcome === 'reached' && supportRatio >= quorum && score >= 0.75) {
        return 'complete';
    }

    if (outcome === 'reached' && supportRatio >= 0.6) {
        return 'call_judge';
    }

    // High consensus - ready for conclusion
    if (score >= 0.8) {
        return 'call_judge';
    }

    // Good consensus - judge can synthesize
    if (score >= 0.65) {
        return 'call_judge';
    }

    // Some disputes - focus on resolving them
    if (disputeCount > 0 && score < 0.5) {
        return 'focus_dispute';
    }

    // Low consensus with few participants - need more perspectives
    if (score < 0.4 && participantCount < 3) {
        return 'continue';
    }

    // Deadlock detection (fallback when deterministic outcome is still not reached)
    if (score < 0.3 && participantCount >= 3) {
        return 'deadlock';
    }

    // Default: continue debating
    return 'continue';
}

// ============================================================================
// Consensus Update Helper
// ============================================================================

/**
 * Update consensus analysis with trend information
 */
export function updateConsensusWithTrend(
    current: ConsensusAnalysis,
    rounds: BounceRound[],
    options: ConsensusAnalysisOptions = {},
): ConsensusAnalysis {
    const resolvedOptions: Required<ConsensusAnalysisOptions> = {
        ...DEFAULT_OPTIONS,
        ...options,
    };
    const trend = analyzeConsensusTrend(rounds);

    // Adjust recommendation based on trend
    let recommendation = current.recommendation;
    let stableRounds = 0;

    const snapshots = [...rounds.map((round) => round.consensusAtEnd), current];
    for (let i = snapshots.length - 1; i >= 0; i--) {
        const snapshot = snapshots[i];
        const reachedVote = snapshot.consensusOutcome === 'reached';
        const reachedScore = snapshot.score >= resolvedOptions.consensusThreshold;
        const reachedQuorum =
            snapshot.proposalConvergence.supportRatio >= resolvedOptions.resolutionQuorum;

        if (reachedVote && reachedScore && reachedQuorum) {
            stableRounds++;
            continue;
        }
        break;
    }

    if (trend === 'degrading' && current.score < 0.5) {
        recommendation = 'deadlock';
    } else if (trend === 'improving' && current.score > 0.6 && recommendation === 'continue') {
        recommendation = 'call_judge';
    }

    if (
        current.consensusOutcome === 'reached' &&
        current.proposalConvergence.supportRatio >= resolvedOptions.resolutionQuorum &&
        stableRounds >= resolvedOptions.minimumStableRounds
    ) {
        recommendation = 'complete';
    }

    return {
        ...current,
        trend,
        recommendation,
        stableRounds,
    };
}

// ============================================================================
// Participant Pruning
// ============================================================================

/**
 * Identify participants whose responses are highly similar to another participant.
 * These participants are not adding signal and can be pruned to reduce costs.
 * Returns session IDs of participants to prune (never prunes below 2 active).
 */
export function identifyPrunableParticipants(
    roundResponses: BounceResponse[],
    threshold: number,
): { sessionId: string; modelTitle: string; similarTo: string }[] {
    if (roundResponses.length <= 2) return [];

    const prunable: { sessionId: string; modelTitle: string; similarTo: string }[] = [];

    // Index responses by session ID for O(1) lookup
    const responseMap = new Map(
        roundResponses.map(r => [r.participantSessionId, r])
    );

    // For each pair, check if one is highly similar to another
    // We keep the first participant and mark later ones as prunable
    const kept = new Set<string>();

    for (const response of roundResponses) {
        let isSimilarToKept = false;
        let similarToTitle = '';

        for (const keptId of kept) {
            const keptResponse = responseMap.get(keptId);
            if (!keptResponse) continue;

            const wordSim = calculateSimilarityPublic(response.content, keptResponse.content);
            const bigramSim = calculateBigramSimilarityPublic(response.content, keptResponse.content);
            const combined = wordSim * 0.6 + bigramSim * 0.4;

            // Also check stance alignment
            const stanceDiff = Math.abs(
                stanceToNumericPublic(response.stance) - stanceToNumericPublic(keptResponse.stance)
            );

            // High content similarity AND similar stance = redundant
            if (combined >= threshold && stanceDiff <= 0.15) {
                isSimilarToKept = true;
                similarToTitle = keptResponse.modelTitle;
                break;
            }
        }

        if (isSimilarToKept) {
            prunable.push({
                sessionId: response.participantSessionId,
                modelTitle: response.modelTitle,
                similarTo: similarToTitle,
            });
        } else {
            kept.add(response.participantSessionId);
        }
    }

    // Never prune below 2 active participants
    const activeCount = roundResponses.length - prunable.length;
    if (activeCount < 2) {
        return prunable.slice(0, roundResponses.length - 2);
    }

    return prunable;
}

// Public wrappers for the private similarity functions (used by pruning)
function calculateSimilarityPublic(text1: string, text2: string): number {
    return calculateSimilarity(text1, text2);
}

function calculateBigramSimilarityPublic(text1: string, text2: string): number {
    return calculateBigramSimilarity(text1, text2);
}

function stanceToNumericPublic(stance: ResponseStance): number {
    return stanceToNumeric(stance);
}

// ============================================================================
// Debate Findings Extraction
// ============================================================================

/**
 * Extract structured findings from a completed debate.
 * Converts consensus analysis into SharedKnowledgeEntry items
 * that can be merged into the shared context.
 */
export function extractDebateFindings(
    debateId: string,
    topic: string,
    rounds: BounceRound[],
    finalConsensus: ConsensusAnalysis,
): DebateFindings {
    const allResponses = rounds.flatMap(r => r.responses);
    const participantNames = [...new Set(allResponses.map(r => r.modelTitle))];

    const agreements: SharedKnowledgeEntry[] = finalConsensus.agreedPoints.map((point, idx) => ({
        id: `${debateId}-finding-${idx}`,
        debateTopic: topic,
        finding: point,
        confidence: finalConsensus.score,
        participants: participantNames,
        capturedAt: Date.now(),
        sourceDebateId: debateId,
    }));

    return {
        agreements,
        disputes: finalConsensus.disputedPoints,
        consensusScore: finalConsensus.score,
        topic,
        debateId,
    };
}

/**
 * Format shared knowledge entries into a text block
 * suitable for injection into system prompts.
 */
export function formatKnowledgeForPrompt(entries: SharedKnowledgeEntry[]): string {
    if (entries.length === 0) return '';

    const grouped = new Map<string, SharedKnowledgeEntry[]>();
    for (const entry of entries) {
        const existing = grouped.get(entry.debateTopic) || [];
        existing.push(entry);
        grouped.set(entry.debateTopic, existing);
    }

    const sections: string[] = [];
    for (const [topic, findings] of grouped) {
        const lines = findings.map(
            f => `- ${f.finding} (${Math.round(f.confidence * 100)}% consensus, ${f.participants.join(', ')})`
        );
        sections.push(`## ${topic}\n${lines.join('\n')}`);
    }

    return `# DEBATE FINDINGS (accumulated knowledge)\n\n${sections.join('\n\n')}`;
}

// ============================================================================
// Quick Consensus Check (for real-time UI updates)
// ============================================================================

/**
 * Fast consensus check for UI - less detailed but quicker
 */
export function quickConsensusCheck(responses: BounceResponse[]): {
    score: number;
    level: 'none' | 'low' | 'partial' | 'strong' | 'unanimous';
} {
    if (responses.length < 2) {
        return { score: 1.0, level: 'unanimous' };
    }

    // Quick stance-based check
    const stances = responses.map(r => r.stance);
    const agreeing = stances.filter(s =>
        s === 'strongly_agree' || s === 'agree' || s === 'refine' || s === 'synthesize'
    ).length;

    const disagreeing = stances.filter(s =>
        s === 'strongly_disagree' || s === 'disagree'
    ).length;

    const score = agreeing / responses.length;

    let level: 'none' | 'low' | 'partial' | 'strong' | 'unanimous';
    if (disagreeing === 0 && agreeing === responses.length) level = 'unanimous';
    else if (score >= 0.7) level = 'strong';
    else if (score >= 0.5) level = 'partial';
    else if (score >= 0.3) level = 'low';
    else level = 'none';

    return { score, level };
}
