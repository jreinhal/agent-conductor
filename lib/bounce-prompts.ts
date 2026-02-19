/**
 * Bounce/Debate Prompt Templates
 *
 * System prompts and message templates for multi-LLM debate.
 * Designed to elicit structured, comparable responses.
 */

import { BounceResponse, ResponseStance, ConsensusAnalysis, ParticipantConfig } from './bounce-types';

// ============================================================================
// System Prompts
// ============================================================================

/**
 * Base system prompt for debate participants
 */
export function getDebateParticipantSystemPrompt(
    participantTitle: string,
    customSystemPrompt?: string
): string {
    const base = `You are ${participantTitle}, participating in a structured multi-model debate.

Your role is to:
1. Carefully consider the topic and any previous responses
2. Provide your honest perspective, agreeing or disagreeing as warranted
3. Be specific about what you agree with, disagree with, or want to refine
4. Support your position with reasoning
5. Be open to changing your view if presented with compelling arguments

Response Guidelines:
- Be concise but thorough (aim for 150-300 words)
- Clearly state your stance at the beginning
- Reference specific points from previous responses when applicable
- Identify areas of common ground
- Highlight genuine disagreements constructively
- Suggest synthesis when possible

${customSystemPrompt ? `\nAdditional Context:\n${customSystemPrompt}` : ''}`;

    return base;
}

/**
 * System prompt for the judge/synthesizer model
 */
export function getJudgeSystemPrompt(): string {
    return `You are the Judge in a multi-model debate. Your role is to synthesize the discussion and provide a final, balanced answer.

Your responsibilities:
1. Identify the key points of agreement across all participants
2. Acknowledge legitimate points of disagreement
3. Weigh the strength of different arguments
4. Provide a synthesized conclusion that incorporates the best insights
5. Be transparent about any remaining uncertainty

Your synthesis should:
- Start with the areas of consensus
- Address the main disputes and how you resolved them
- Provide a clear, actionable conclusion
- Note any caveats or areas needing further exploration

Be fair to all perspectives while providing clear guidance.`;
}

// ============================================================================
// Message Templates
// ============================================================================

/**
 * Build the initial debate prompt for the first participant
 */
export function buildInitialDebatePrompt(topic: string): string {
    return `## Debate Topic

${topic}

---

You are the first to respond. Please provide your analysis and perspective on this topic.

Structure your response as:
1. **Your Stance**: Clearly state your position
2. **Key Points**: Your main arguments (2-4 points)
3. **Considerations**: Important factors to weigh
4. **Conclusion**: Your recommendation or conclusion`;
}

/**
 * Build a debate prompt that includes previous responses
 */
export function buildDebatePromptWithHistory(
    topic: string,
    previousResponses: BounceResponse[],
    roundNumber: number
): string {
    const responsesSummary = previousResponses.map((r, i) => {
        const stanceEmoji = getStanceEmoji(r.stance);
        return `### ${r.modelTitle} ${stanceEmoji}
**Stance**: ${formatStance(r.stance)}

${r.content}

${r.keyPoints.length > 0 ? `**Key Points**:\n${r.keyPoints.map(p => `- ${p}`).join('\n')}` : ''}
`;
    }).join('\n---\n\n');

    return `## Debate Topic

${topic}

---

## Previous Responses (Round ${roundNumber})

${responsesSummary}

---

## Your Turn

Review the responses above and provide your perspective.

Structure your response as:
1. **Your Stance**: State whether you agree, disagree, or want to refine the discussion
2. **Points of Agreement**: What do you agree with from previous responses?
3. **Points of Disagreement**: Where do you differ? Why?
4. **Your Analysis**: Your unique contribution or synthesis
5. **Conclusion**: Your current position

Be direct about agreements and disagreements. Reference specific points from other participants.`;
}

/**
 * Build the judge's synthesis prompt
 */
export function buildJudgeSynthesisPrompt(
    topic: string,
    allResponses: BounceResponse[],
    consensus: ConsensusAnalysis
): string {
    const responsesSummary = allResponses.map(r => {
        return `### ${r.modelTitle} (${formatStance(r.stance)})
${r.content}

Key Points: ${r.keyPoints.join('; ') || 'Not specified'}
`;
    }).join('\n---\n\n');

    return `## Final Synthesis Required

**Original Topic:**
${topic}

---

## All Debate Responses

${responsesSummary}

---

## Consensus Analysis

- **Consensus Level**: ${consensus.level} (${Math.round(consensus.score * 100)}%)
- **Points of Agreement**: ${consensus.agreedPoints.join('; ') || 'None identified'}
- **Points of Dispute**: ${consensus.disputedPoints.join('; ') || 'None identified'}
- **Stance Distribution**: ${Object.entries(consensus.stanceBreakdown).map(([k, v]) => `${k}: ${v}`).join(', ')}

---

## Your Task

As the Judge, synthesize this debate into a final answer.

Provide:
1. **Executive Summary**: A clear, direct answer to the original question (2-3 sentences)
2. **Consensus Points**: What all or most participants agreed on
3. **Resolution of Disputes**: How you weighed conflicting viewpoints
4. **Final Recommendation**: Your synthesized conclusion
5. **Confidence Level**: How confident you are in this synthesis (high/medium/low)
6. **Caveats**: Any important limitations or areas of remaining uncertainty

Be balanced but decisive. The user needs a clear answer.`;
}

/**
 * Build a prompt for requesting user interjection
 */
export function buildInterjectionRequestPrompt(
    topic: string,
    currentRound: number,
    consensus: ConsensusAnalysis
): string {
    return `## Debate Paused for Your Input

**Topic:** ${topic}
**Current Round:** ${currentRound}
**Consensus Level:** ${consensus.level} (${Math.round(consensus.score * 100)}%)

**Areas of Agreement:**
${consensus.agreedPoints.map(p => `- ${p}`).join('\n') || '- None yet identified'}

**Areas of Dispute:**
${consensus.disputedPoints.map(p => `- ${p}`).join('\n') || '- None yet identified'}

---

You can:
- Add context or constraints
- Ask a clarifying question
- Redirect the discussion
- Request focus on a specific aspect

Type your input below, or click "Continue Debate" to proceed.`;
}

// ============================================================================
// Response Parsing
// ============================================================================

/**
 * Extract stance from a model's response
 */
export function parseStanceFromResponse(content: string): ResponseStance {
    const lower = content.toLowerCase();
    const first500 = lower.substring(0, 500); // Focus on beginning where stance is stated

    // Check for explicit stance markers
    if (first500.includes('strongly agree') || first500.includes('completely agree') || first500.includes('fully support')) {
        return 'strongly_agree';
    }
    if (first500.includes('strongly disagree') || first500.includes('completely disagree') || first500.includes('cannot support')) {
        return 'strongly_disagree';
    }
    if (first500.includes('i agree') || first500.includes('agree with') || first500.includes('support this')) {
        return 'agree';
    }
    if (first500.includes('i disagree') || first500.includes('disagree with') || first500.includes('oppose')) {
        return 'disagree';
    }
    if (first500.includes('refine') || first500.includes('build upon') || first500.includes('extend')) {
        return 'refine';
    }
    if (first500.includes('synthesize') || first500.includes('combine') || first500.includes('merge')) {
        return 'synthesize';
    }

    // Check sentiment balance
    const positiveSignals = ['yes', 'correct', 'valid', 'good point', 'makes sense', 'agree'];
    const negativeSignals = ['no', 'incorrect', 'invalid', 'flawed', 'wrong', 'disagree'];

    const positiveCount = positiveSignals.filter(s => lower.includes(s)).length;
    const negativeCount = negativeSignals.filter(s => lower.includes(s)).length;

    if (positiveCount > negativeCount + 2) return 'agree';
    if (negativeCount > positiveCount + 2) return 'disagree';

    return 'neutral';
}

/**
 * Extract key points from a response
 */
export function extractKeyPoints(content: string): string[] {
    const points: string[] = [];

    // Look for numbered or bulleted lists
    const listPatterns = [
        /\d+\.\s*\*\*([^*]+)\*\*/g,  // 1. **Point**
        /\d+\.\s+([^\n]+)/g,         // 1. Point
        /[-•]\s*\*\*([^*]+)\*\*/g,   // - **Point**
        /[-•]\s+([^\n]+)/g,          // - Point
    ];

    for (const pattern of listPatterns) {
        const matches = content.matchAll(pattern);
        for (const match of matches) {
            const point = match[1].trim();
            if (point.length > 10 && point.length < 200 && !points.includes(point)) {
                points.push(point);
            }
        }
    }

    // If no list found, try to extract from "Key Points" section
    const keyPointsSection = content.match(/key points?:?\s*([\s\S]*?)(?=\n\n|\n#|$)/i);
    if (keyPointsSection && points.length === 0) {
        const sectionPoints = keyPointsSection[1].split(/\n/).filter(l => l.trim());
        points.push(...sectionPoints.slice(0, 5).map(p => p.replace(/^[-•\d.]\s*/, '').trim()));
    }

    return points.slice(0, 5); // Max 5 key points
}

/**
 * Extract agreements and disagreements from a response
 */
export function extractAgreementsAndDisagreements(content: string): {
    agreements: string[];
    disagreements: string[];
} {
    const agreements: string[] = [];
    const disagreements: string[] = [];

    const lower = content.toLowerCase();

    // Agreement patterns
    const agreementPatterns = [
        /i agree (?:with|that) ([^.]+)/gi,
        /(?:agree|concur) (?:with|on) ([^.]+)/gi,
        /(?:correct|valid|good) point (?:about|regarding|on) ([^.]+)/gi,
    ];

    // Disagreement patterns
    const disagreementPatterns = [
        /i disagree (?:with|that) ([^.]+)/gi,
        /(?:disagree|differ) (?:with|on) ([^.]+)/gi,
        /(?:incorrect|flawed|wrong) (?:about|regarding|on) ([^.]+)/gi,
        /however,?\s+([^.]+)/gi,
        /but\s+([^.]+)/gi,
    ];

    for (const pattern of agreementPatterns) {
        const matches = content.matchAll(pattern);
        for (const match of matches) {
            const point = match[1].trim();
            if (point.length > 10 && point.length < 150) {
                agreements.push(point);
            }
        }
    }

    for (const pattern of disagreementPatterns) {
        const matches = content.matchAll(pattern);
        for (const match of matches) {
            const point = match[1].trim();
            if (point.length > 10 && point.length < 150) {
                disagreements.push(point);
            }
        }
    }

    return {
        agreements: [...new Set(agreements)].slice(0, 3),
        disagreements: [...new Set(disagreements)].slice(0, 3),
    };
}

// ============================================================================
// Helpers
// ============================================================================

function getStanceEmoji(stance: ResponseStance): string {
    switch (stance) {
        case 'strongly_agree': return '✅✅';
        case 'agree': return '✅';
        case 'neutral': return '➖';
        case 'disagree': return '❌';
        case 'strongly_disagree': return '❌❌';
        case 'refine': return '🔧';
        case 'synthesize': return '🔀';
        default: return '❓';
    }
}

function formatStance(stance: ResponseStance): string {
    switch (stance) {
        case 'strongly_agree': return 'Strongly Agrees';
        case 'agree': return 'Agrees';
        case 'neutral': return 'Neutral';
        case 'disagree': return 'Disagrees';
        case 'strongly_disagree': return 'Strongly Disagrees';
        case 'refine': return 'Refining';
        case 'synthesize': return 'Synthesizing';
        default: return 'Unknown';
    }
}

export { getStanceEmoji, formatStance };
