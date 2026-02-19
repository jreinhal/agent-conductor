/**
 * Consensus Detection Engine
 *
 * Implements structured consensus detection as defined in the
 * Bounce Protocol v0.1 specification (Section 7).
 *
 * Supports three consensus modes:
 * - **majority**: >50% approve with average confidence >= threshold
 * - **weighted**: weighted score of stances >= threshold
 * - **unanimous**: all agents approve with confidence >= threshold
 *
 * Agents with `defer` stance are excluded from calculation.
 * If all agents defer, the result is `deadlock`.
 *
 * @module lib/coordination/consensus
 */

import type {
  ProtocolEntry,
  ProtocolRules,
  ConsensusResult,
  ConsensusOutcome,
  Stance,
} from '@/lib/protocol/types';

// ─── Helper: Latest Entries Per Agent ───────────────────────────────

/**
 * Extract the most recent entry per agent from a list of entries.
 * Optionally filter to a specific round.
 *
 * When multiple entries exist for the same agent (and round, if specified),
 * the last one in the array wins (entries are ordered chronologically).
 */
export function getLatestEntriesPerAgent(
  entries: ProtocolEntry[],
  round?: number,
): Map<string, ProtocolEntry> {
  const result = new Map<string, ProtocolEntry>();

  for (const entry of entries) {
    if (round !== undefined && entry.metadata.round !== round) {
      continue;
    }
    // Later entries overwrite earlier ones for the same author
    result.set(entry.author, entry);
  }

  return result;
}

// ─── Helper: Find Latest Round ──────────────────────────────────────

/**
 * Determine the highest round number present in a list of entries.
 * Returns 0 if the entries array is empty.
 */
function findLatestRound(entries: ProtocolEntry[]): number {
  let max = 0;
  for (const entry of entries) {
    if (entry.metadata.round > max) {
      max = entry.metadata.round;
    }
  }
  return max;
}

// ─── Consensus Detection ────────────────────────────────────────────

/**
 * Detect consensus from a set of protocol entries using the rules
 * defined in the session's ProtocolRules.
 *
 * Only entries from the latest round are considered. For each agent,
 * only the most recent entry in that round is used.
 *
 * @param entries - All protocol entries in the session dialogue.
 * @param rules - The protocol rules governing consensus detection.
 * @returns A ConsensusResult with outcome, score, and per-agent stances.
 */
export function detectConsensus(
  entries: ProtocolEntry[],
  rules: ProtocolRules,
): ConsensusResult {
  const latestRound = findLatestRound(entries);

  if (latestRound === 0) {
    return {
      outcome: 'not-reached',
      score: 0,
      agentStances: [],
      round: 0,
    };
  }

  const latestEntries = getLatestEntriesPerAgent(entries, latestRound);

  // Build per-agent stance summary
  const agentStances: ConsensusResult['agentStances'] = [];
  for (const [agent, entry] of latestEntries) {
    agentStances.push({
      agent,
      stance: entry.fields.stance ?? 'neutral',
      confidence: entry.fields.confidence ?? 0,
    });
  }

  // Separate defer agents from active agents
  const activeStances = agentStances.filter((s) => s.stance !== 'defer');
  const deferCount = agentStances.length - activeStances.length;

  // All agents defer -> deadlock
  if (activeStances.length === 0 && deferCount > 0) {
    return {
      outcome: 'deadlock',
      score: 0,
      agentStances,
      round: latestRound,
    };
  }

  // No active stances and no defers -> not-reached (no entries for this round)
  if (activeStances.length === 0) {
    return {
      outcome: 'not-reached',
      score: 0,
      agentStances,
      round: latestRound,
    };
  }

  switch (rules.consensusMode) {
    case 'majority':
      return detectMajority(activeStances, agentStances, rules, latestRound);
    case 'weighted':
      return detectWeighted(activeStances, agentStances, rules, latestRound);
    case 'unanimous':
      return detectUnanimous(activeStances, agentStances, rules, latestRound);
    default:
      return {
        outcome: 'not-reached',
        score: 0,
        agentStances,
        round: latestRound,
      };
  }
}

// ─── Majority Consensus ─────────────────────────────────────────────

/**
 * Majority consensus: reached when >50% of active agents approve
 * and the average confidence of approving agents >= threshold.
 *
 * Per spec Section 7.1:
 * ```
 * let approvers = entries in latest round where stance == "approve"
 * let total = number of agents (active, excluding defer)
 * let avg_confidence = mean(approvers.map(e => e.confidence))
 * consensus_reached = (approvers.count > total / 2) AND (avg_confidence >= threshold)
 * ```
 */
function detectMajority(
  activeStances: Array<{ agent: string; stance: Stance; confidence: number }>,
  allStances: ConsensusResult['agentStances'],
  rules: ProtocolRules,
  round: number,
): ConsensusResult {
  const approvers = activeStances.filter((s) => s.stance === 'approve');
  const totalActive = activeStances.length;

  if (approvers.length === 0) {
    return {
      outcome: 'not-reached',
      score: 0,
      agentStances: allStances,
      round,
    };
  }

  const avgConfidence =
    approvers.reduce((sum, s) => sum + s.confidence, 0) / approvers.length;

  const majorityReached = approvers.length > totalActive / 2;
  const thresholdMet = avgConfidence >= rules.consensusThreshold;

  return {
    outcome: majorityReached && thresholdMet ? 'reached' : 'not-reached',
    score: avgConfidence,
    agentStances: allStances,
    round,
  };
}

// ─── Weighted Consensus ─────────────────────────────────────────────

/**
 * Weighted consensus: each agent's vote weighted by confidence.
 *
 * Per spec Section 7.2:
 * ```
 * let score = sum(entries.map(e =>
 *     e.stance == "approve" ? e.confidence :
 *     e.stance == "reject"  ? -e.confidence :
 *     0.0
 * )) / number_of_agents
 *
 * consensus_reached = score >= threshold
 * ```
 *
 * number_of_agents here refers to the count of active (non-defer) agents.
 */
function detectWeighted(
  activeStances: Array<{ agent: string; stance: Stance; confidence: number }>,
  allStances: ConsensusResult['agentStances'],
  rules: ProtocolRules,
  round: number,
): ConsensusResult {
  const totalActive = activeStances.length;

  let weightedSum = 0;
  for (const s of activeStances) {
    if (s.stance === 'approve') {
      weightedSum += s.confidence;
    } else if (s.stance === 'reject') {
      weightedSum -= s.confidence;
    }
    // neutral contributes 0
  }

  const score = weightedSum / totalActive;

  return {
    outcome: score >= rules.consensusThreshold ? 'reached' : 'not-reached',
    score,
    agentStances: allStances,
    round,
  };
}

// ─── Unanimous Consensus ────────────────────────────────────────────

/**
 * Unanimous consensus: all active agents must approve with confidence >= threshold.
 *
 * Per spec Section 7.3:
 * ```
 * consensus_reached = all(entries.map(e =>
 *     e.stance == "approve" AND e.confidence >= threshold
 * ))
 * ```
 */
function detectUnanimous(
  activeStances: Array<{ agent: string; stance: Stance; confidence: number }>,
  allStances: ConsensusResult['agentStances'],
  rules: ProtocolRules,
  round: number,
): ConsensusResult {
  const allApproveAboveThreshold = activeStances.every(
    (s) => s.stance === 'approve' && s.confidence >= rules.consensusThreshold,
  );

  // For score, use the minimum confidence among approvers (bottleneck metric).
  // If not all approve, use 0.
  const score = allApproveAboveThreshold
    ? Math.min(...activeStances.map((s) => s.confidence))
    : 0;

  return {
    outcome: allApproveAboveThreshold ? 'reached' : 'not-reached',
    score,
    agentStances: allStances,
    round,
  };
}
