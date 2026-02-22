/**
 * Bounce/Debate Prompt Templates
 *
 * System prompts and message templates for multi-LLM debate.
 * Designed to elicit structured, comparable responses.
 */

import { BounceResponse, ResponseStance, ConsensusAnalysis } from './bounce-types';

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
- Use the exact headings in the response contract so your output can be machine-parsed.
- Be concise but complete (roughly 120-260 words).
- If you disagree, provide a concrete alternative proposal.

Response Contract (required headings):
STANCE: strongly_agree | agree | refine | synthesize | neutral | disagree | strongly_disagree
CONFIDENCE: <0-100>%
PROPOSED_RESOLUTION: <one sentence recommendation>
AGREEMENTS:
- <point>
DISAGREEMENTS:
- <point>
RISK: <one concrete risk>
MITIGATION: <one concrete mitigation>
RATIONALE: <short justification>

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

For round 1, propose an initial solution that other models can evaluate.
Make your proposal precise enough that another model can either adopt it or challenge it.`;
}

/**
 * Estimate token count from text (words * 1.3 is a reasonable approximation)
 */
function estimateTokens(text: string): number {
    return Math.ceil(text.split(/\s+/).length * 1.3);
}

/**
 * Build a full-detail response block for a single response
 */
function buildFullResponseBlock(r: BounceResponse): string {
    const stanceEmoji = getStanceEmoji(r.stance);
    return `### ${r.modelTitle} ${stanceEmoji}
**Stance**: ${formatStance(r.stance)}

${r.content}

${r.keyPoints.length > 0 ? `**Key Points**:\n${r.keyPoints.map(p => `- ${p}`).join('\n')}` : ''}
`;
}

/**
 * Build a condensed response block (stance + key points only, no full content)
 */
function buildCondensedResponseBlock(r: BounceResponse): string {
    const stanceEmoji = getStanceEmoji(r.stance);
    const points = r.keyPoints.length > 0
        ? r.keyPoints.map(p => `- ${p}`).join('\n')
        : '- (no key points extracted)';
    return `### ${r.modelTitle} ${stanceEmoji} *(condensed)*
**Stance**: ${formatStance(r.stance)}
**Key Points**:
${points}
`;
}

/**
 * Build a debate prompt that includes previous responses.
 * If maxContextTokens is provided, older responses are condensed to fit within budget.
 */
export function buildDebatePromptWithHistory(
    topic: string,
    previousResponses: BounceResponse[],
    roundNumber: number,
    maxContextTokens?: number
): string {
    const promptFrame = `## Debate Topic

${topic}

---

## Previous Responses (Round ${roundNumber})

{RESPONSES}

---

## Your Turn

Review the responses above and provide your perspective.

For this round:
1. Evaluate the strongest proposal so far.
2. Either adopt it (optionally with one refinement) or replace it with a better proposal.
3. Include exactly one risk and one mitigation.
4. Keep arguments evidence-based and directly comparable to previous turns.

Be direct about agreements and disagreements. Reference specific points from other participants.`;

    const frameTokens = estimateTokens(promptFrame);

    // Build all full-detail blocks
    const fullBlocks = previousResponses.map(r => buildFullResponseBlock(r));
    const condensedBlocks = previousResponses.map(r => buildCondensedResponseBlock(r));

    // If no budget or fits within budget, use full detail
    const fullContent = fullBlocks.join('\n---\n\n');
    if (!maxContextTokens || estimateTokens(fullContent) + frameTokens <= maxContextTokens) {
        return promptFrame.replace('{RESPONSES}', fullContent);
    }

    // Budget exceeded: condense older responses, keep recent ones full
    // Pre-calculate token counts to avoid re-joining on every iteration
    const responseBlocks = [...fullBlocks];
    const fullBlockTokens = fullBlocks.map(estimateTokens);
    const condensedBlockTokens = condensedBlocks.map(estimateTokens);
    const separatorTokens = estimateTokens('\n---\n\n');
    const separatorTotal = fullBlockTokens.length > 1
        ? (fullBlockTokens.length - 1) * separatorTokens
        : 0;
    let totalTokens = fullBlockTokens.reduce((a, b) => a + b, 0) + separatorTotal + frameTokens;
    const budget = maxContextTokens;

    for (let i = 0; i < responseBlocks.length - 1 && totalTokens > budget; i++) {
        totalTokens = totalTokens - fullBlockTokens[i] + condensedBlockTokens[i];
        responseBlocks[i] = condensedBlocks[i];
    }

    // Fallback: if still over budget after condensing all older responses,
    // condense the newest response too rather than overflowing model context
    if (totalTokens > budget && responseBlocks.length > 0) {
        const lastIdx = responseBlocks.length - 1;
        totalTokens = totalTokens - fullBlockTokens[lastIdx] + condensedBlockTokens[lastIdx];
        responseBlocks[lastIdx] = condensedBlocks[lastIdx];
    }

    return promptFrame.replace('{RESPONSES}', responseBlocks.join('\n---\n\n'));
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

    const structuredStanceMatch = content.match(
        /(?:^|\n)\s*(?:\*\*)?stance(?:\*\*)?\s*[:\-]\s*([a-z_\s-]+)/i
    );
    if (structuredStanceMatch) {
        const raw = structuredStanceMatch[1].trim().toLowerCase().replace(/\s+/g, '_');
        if (raw.includes('strongly_agree')) return 'strongly_agree';
        if (raw.includes('strongly_disagree')) return 'strongly_disagree';
        if (raw.includes('agree')) return 'agree';
        if (raw.includes('disagree')) return 'disagree';
        if (raw.includes('refine')) return 'refine';
        if (raw.includes('synthesize')) return 'synthesize';
        if (raw.includes('neutral')) return 'neutral';
    }

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
