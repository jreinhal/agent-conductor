/**
 * Bounce Orchestrator - State Machine for Multi-LLM Debate
 *
 * Manages the debate flow between multiple models, tracking state,
 * handling user interjections, and determining when consensus is reached.
 *
 * Inspired by SENTINEL's AgenticRagOrchestrator pattern.
 */

import {
    BounceState,
    BounceConfig,
    BounceRound,
    BounceResponse,
    BounceEvent,
    BounceEventHandler,
    BounceAction,
    ParticipantConfig,
    INITIAL_BOUNCE_STATE,
    DEFAULT_BOUNCE_CONFIG,
    ConsensusAnalysis,
} from './bounce-types';

import {
    buildInitialDebatePrompt,
    buildDebatePromptWithHistory,
    buildJudgeSynthesisPrompt,
    getDebateParticipantSystemPrompt,
    getJudgeSystemPrompt,
    parseStanceFromResponse,
    extractKeyPoints,
    extractAgreementsAndDisagreements,
} from './bounce-prompts';

import {
    analyzeConsensus,
    updateConsensusWithTrend,
    identifyPrunableParticipants,
} from './consensus-analyzer';

// ============================================================================
// Orchestrator Class
// ============================================================================

export class BounceOrchestrator {
    private state: BounceState;
    private eventHandlers: Set<BounceEventHandler>;
    private abortController: AbortController | null;
    private sendMessage: (
        modelId: string,
        systemPrompt: string,
        userMessage: string,
        signal?: AbortSignal
    ) => Promise<string>;

    constructor(
        sendMessage: (
            modelId: string,
            systemPrompt: string,
            userMessage: string,
            signal?: AbortSignal
        ) => Promise<string>
    ) {
        this.state = { ...INITIAL_BOUNCE_STATE };
        this.eventHandlers = new Set();
        this.abortController = null;
        this.sendMessage = sendMessage;
    }

    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Subscribe to bounce events
     */
    subscribe(handler: BounceEventHandler): () => void {
        this.eventHandlers.add(handler);
        return () => this.eventHandlers.delete(handler);
    }

    /**
     * Get current state
     */
    getState(): Readonly<BounceState> {
        return { ...this.state };
    }

    /**
     * Dispatch an action to the orchestrator
     */
    async dispatch(action: BounceAction): Promise<void> {
        switch (action.type) {
            case 'START':
                await this.start(action.topic, action.participants, action.config);
                break;
            case 'PAUSE':
                this.pause();
                break;
            case 'RESUME':
                await this.resume();
                break;
            case 'STOP':
                this.stop();
                break;
            case 'INJECT_MESSAGE':
                await this.injectUserMessage(action.message);
                break;
            case 'SKIP_TO_JUDGE':
                await this.skipToJudge();
                break;
            case 'ADD_PARTICIPANT':
                this.addParticipant(action.participant);
                break;
            case 'REMOVE_PARTICIPANT':
                this.removeParticipant(action.sessionId);
                break;
            case 'UPDATE_CONFIG':
                this.updateConfig(action.config);
                break;
        }
    }

    // ========================================================================
    // Core State Machine
    // ========================================================================

    private async start(
        topic: string,
        participants: ParticipantConfig[],
        configOverrides?: Partial<BounceConfig>
    ): Promise<void> {
        if (this.state.status !== 'idle' && this.state.status !== 'complete' && this.state.status !== 'error') {
            console.warn('Bounce already in progress');
            return;
        }

        // Initialize state
        this.state = {
            ...INITIAL_BOUNCE_STATE,
            status: 'running',
            config: {
                ...DEFAULT_BOUNCE_CONFIG,
                ...configOverrides,
                participants,
            },
            originalTopic: topic,
            sourceSessionId: participants[0]?.sessionId || '',
            startedAt: Date.now(),
        };

        this.abortController = new AbortController();

        this.emit({ type: 'BOUNCE_STARTED', topic, participants });

        try {
            await this.runDebateLoop();
        } catch (error) {
            if ((error as Error).name === 'AbortError') {
                // Graceful cancellation
                return;
            }
            this.handleError(error);
        }
    }

    private pause(): void {
        if (this.state.status !== 'running') return;

        this.state.status = 'paused';
        this.emit({ type: 'BOUNCE_PAUSED' });
    }

    private async resume(): Promise<void> {
        if (this.state.status !== 'paused' && this.state.status !== 'waiting_user') return;

        this.state.status = 'running';
        this.emit({ type: 'BOUNCE_RESUMED' });

        try {
            await this.runDebateLoop();
        } catch (error) {
            if ((error as Error).name === 'AbortError') return;
            this.handleError(error);
        }
    }

    private stop(): void {
        this.abortController?.abort();
        this.state.status = 'complete';
        this.state.completedAt = Date.now();
        this.emit({ type: 'BOUNCE_CANCELLED' });
    }

    private async injectUserMessage(message: string): Promise<void> {
        if (this.state.status !== 'waiting_user' && this.state.status !== 'paused') {
            console.warn('Not waiting for user input');
            return;
        }

        // Add user interjection as context for next round
        this.state.originalTopic = `${this.state.originalTopic}\n\n[User Interjection]: ${message}`;

        this.emit({ type: 'USER_INTERJECTED', message });

        // Resume debate
        await this.resume();
    }

    private async skipToJudge(): Promise<void> {
        if (this.state.rounds.length === 0) {
            console.warn('No rounds to judge');
            return;
        }

        this.state.status = 'judging';
        await this.runJudgeSynthesis();
    }

    private addParticipant(participant: ParticipantConfig): void {
        if (this.state.status === 'running') {
            console.warn('Cannot add participant while debate is running');
            return;
        }

        this.state.config.participants.push(participant);
    }

    private removeParticipant(sessionId: string): void {
        if (this.state.status === 'running') {
            console.warn('Cannot remove participant while debate is running');
            return;
        }

        this.state.config.participants = this.state.config.participants.filter(
            p => p.sessionId !== sessionId
        );
    }

    private updateConfig(config: Partial<BounceConfig>): void {
        this.state.config = { ...this.state.config, ...config };
    }

    // ========================================================================
    // Debate Loop
    // ========================================================================

    private async runDebateLoop(): Promise<void> {
        const { config } = this.state;

        while (
            this.state.status === 'running' &&
            this.state.currentRound < config.maxRounds
        ) {
            // Start new round
            this.state.currentRound++;
            this.state.currentParticipantIndex = 0;

            this.emit({ type: 'ROUND_STARTED', roundNumber: this.state.currentRound });

            const roundResponses: BounceResponse[] = [];

            if (config.mode === 'sequential') {
                // Sequential: each participant responds in order
                for (let i = 0; i < config.participants.length; i++) {
                    if (this.state.status !== 'running') break;

                    this.state.currentParticipantIndex = i;
                    const participant = config.participants[i];

                    const response = await this.getParticipantResponse(
                        participant,
                        roundResponses
                    );

                    if (response) {
                        roundResponses.push(response);
                        this.emit({ type: 'PARTICIPANT_RESPONDED', response });

                        // Pause between responses if configured
                        if (config.pauseBetweenResponses > 0 && i < config.participants.length - 1) {
                            await this.sleep(config.pauseBetweenResponses);
                        }
                    }
                }
            } else {
                // Parallel: all participants respond simultaneously
                const promises = config.participants.map(participant =>
                    this.getParticipantResponse(participant, [])
                );

                const responses = await Promise.all(promises);
                responses.forEach(response => {
                    if (response) {
                        roundResponses.push(response);
                        this.emit({ type: 'PARTICIPANT_RESPONDED', response });
                    }
                });
            }

            // Analyze consensus at end of round
            const consensus = analyzeConsensus(roundResponses, {
                consensusMode: config.consensusMode,
                consensusThreshold: config.consensusThreshold,
                resolutionQuorum: config.resolutionQuorum,
                minimumStableRounds: config.minimumStableRounds,
            });
            const updatedConsensus = updateConsensusWithTrend(consensus, this.state.rounds, {
                consensusMode: config.consensusMode,
                consensusThreshold: config.consensusThreshold,
                resolutionQuorum: config.resolutionQuorum,
                minimumStableRounds: config.minimumStableRounds,
            });

            // Record the round
            const round: BounceRound = {
                roundNumber: this.state.currentRound,
                responses: roundResponses,
                consensusAtEnd: updatedConsensus,
                timestamp: Date.now(),
            };

            this.state.rounds.push(round);
            this.state.consensus = updatedConsensus;

            this.emit({ type: 'ROUND_COMPLETE', round });
            this.emit({ type: 'CONSENSUS_UPDATED', consensus: updatedConsensus });

            // Prune aligned participants if enabled
            if (config.enablePruning && config.participants.length > 2) {
                const prunable = identifyPrunableParticipants(
                    roundResponses,
                    config.pruningThreshold
                );

                for (const p of prunable) {
                    config.participants = config.participants.filter(
                        pp => pp.sessionId !== p.sessionId
                    );
                    this.state.prunedParticipants.push({
                        sessionId: p.sessionId,
                        modelTitle: p.modelTitle,
                        prunedAtRound: this.state.currentRound,
                    });
                    this.emit({
                        type: 'PARTICIPANT_PRUNED',
                        sessionId: p.sessionId,
                        modelTitle: p.modelTitle,
                        reason: `Aligned with ${p.similarTo}`,
                    });
                }
            }

            // Check if we should stop
            if (this.shouldStopDebate(updatedConsensus)) {
                break;
            }

            // Check if user interjection is configured
            if (config.allowUserInterjection && this.state.currentRound < config.maxRounds) {
                this.state.status = 'waiting_user';
                this.emit({ type: 'USER_INTERJECTION_REQUESTED' });
                return; // Will resume when user injects or clicks continue
            }
        }

        // Debate complete - run judge synthesis
        if (this.state.status === 'running') {
            await this.runJudgeSynthesis();
        }
    }

    private async getParticipantResponse(
        participant: ParticipantConfig,
        previousResponses: BounceResponse[]
    ): Promise<BounceResponse | null> {
        this.emit({
            type: 'PARTICIPANT_THINKING',
            sessionId: participant.sessionId,
            modelId: participant.modelId,
        });

        const startTime = Date.now();

        try {
            // Build the prompt
            const isFirstResponse = this.state.rounds.length === 0 && previousResponses.length === 0;
            const allPreviousResponses = [
                ...this.state.rounds.flatMap(r => r.responses),
                ...previousResponses,
            ];

            const prompt = isFirstResponse
                ? buildInitialDebatePrompt(this.state.originalTopic)
                : buildDebatePromptWithHistory(
                    this.state.originalTopic,
                    allPreviousResponses,
                    this.state.currentRound,
                    this.state.config.maxContextTokens
                );

            const systemPrompt = getDebateParticipantSystemPrompt(
                participant.title,
                participant.systemPrompt
            );

            // Get response from model with bounded retries for transient failures.
            const content = await this.sendMessageWithRetry(
                participant.modelId,
                systemPrompt,
                prompt
            );

            const durationMs = Date.now() - startTime;

            // Parse the response
            const stance = parseStanceFromResponse(content);
            const keyPoints = extractKeyPoints(content);
            const { agreements, disagreements } = extractAgreementsAndDisagreements(content);

            const response: BounceResponse = {
                participantSessionId: participant.sessionId,
                modelId: participant.modelId,
                modelTitle: participant.title,
                stance,
                content,
                keyPoints,
                agreements,
                disagreements,
                confidence: this.extractConfidence(content),
                durationMs,
                timestamp: Date.now(),
            };

            return response;
        } catch (error) {
            if ((error as Error).name === 'AbortError') {
                throw error;
            }
            console.error(`Error getting response from ${participant.modelId}:`, error);
            return null;
        }
    }

    private async sendMessageWithRetry(
        modelId: string,
        systemPrompt: string,
        prompt: string
    ): Promise<string> {
        const maxAttempts = Math.max(1, this.state.config.maxResponseRetries + 1);
        let lastError: unknown;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await this.sendMessage(
                    modelId,
                    systemPrompt,
                    prompt,
                    this.abortController?.signal
                );
            } catch (error) {
                if ((error as Error).name === 'AbortError') {
                    throw error;
                }
                lastError = error;
                if (attempt >= maxAttempts) {
                    break;
                }

                const backoffMs = this.state.config.retryBackoffMs * Math.pow(2, attempt - 1);
                console.warn(
                    `[BounceOrchestrator] Retry ${attempt}/${maxAttempts - 1} for ${modelId} in ${backoffMs}ms`,
                    error
                );
                await this.sleep(backoffMs);
            }
        }

        throw lastError instanceof Error ? lastError : new Error('Failed to obtain model response');
    }

    private shouldStopDebate(consensus: ConsensusAnalysis): boolean {
        const { config } = this.state;
        const reachedVote = consensus.consensusOutcome === 'reached';
        const reachedScore = consensus.score >= config.consensusThreshold;
        const reachedQuorum = consensus.proposalConvergence.supportRatio >= config.resolutionQuorum;
        const reachedStability = consensus.stableRounds >= config.minimumStableRounds;

        // Check deterministic auto-stop gate: vote + quorum + stability.
        if (config.autoStopOnConsensus && reachedVote && reachedScore && reachedQuorum && reachedStability) {
            this.state.status = 'consensus';
            return true;
        }

        // Strong recommendation to synthesize.
        if (consensus.recommendation === 'complete') {
            return true;
        }

        if (consensus.recommendation === 'call_judge' && reachedVote && reachedQuorum) {
            return true;
        }

        // Check for deadlock.
        if (consensus.recommendation === 'deadlock') {
            return true;
        }

        // Check max rounds
        if (this.state.currentRound >= config.maxRounds) {
            this.state.status = 'max_rounds';
            return true;
        }

        return false;
    }

    private async runJudgeSynthesis(): Promise<void> {
        this.state.status = 'judging';
        this.emit({ type: 'JUDGING_STARTED' });

        const allResponses = this.state.rounds.flatMap(r => r.responses);

        if (allResponses.length === 0) {
            this.handleError(new Error('No responses to synthesize'));
            return;
        }

        const resolvedConsensus = this.state.consensus || analyzeConsensus(allResponses, {
            consensusMode: this.state.config.consensusMode,
            consensusThreshold: this.state.config.consensusThreshold,
            resolutionQuorum: this.state.config.resolutionQuorum,
            minimumStableRounds: this.state.config.minimumStableRounds,
        });

        const prompt = buildJudgeSynthesisPrompt(
            this.state.originalTopic,
            allResponses,
            resolvedConsensus
        );

        const systemPrompt = getJudgeSystemPrompt();

        try {
            const finalAnswer = await this.sendMessageWithRetry(
                this.state.config.judgeModelId,
                systemPrompt,
                prompt
            );

            this.state.finalAnswer = finalAnswer;
            this.state.status = 'complete';
            this.state.completedAt = Date.now();

            this.emit({
                type: 'BOUNCE_COMPLETE',
                finalAnswer,
                consensus: resolvedConsensus,
            });
        } catch (error) {
            if ((error as Error).name === 'AbortError') return;
            this.handleError(error);
        }
    }

    // ========================================================================
    // Helpers
    // ========================================================================

    private emit(event: BounceEvent): void {
        this.eventHandlers.forEach(handler => handler(event));
    }

    private handleError(error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        this.state.status = 'error';
        this.state.error = message;
        this.emit({ type: 'BOUNCE_ERROR', error: message });
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private extractConfidence(content: string): number {
        const lower = content.toLowerCase();

        // Look for explicit confidence statements
        const confidenceMatch = lower.match(/confidence[:\s]+(\d+)%/);
        if (confidenceMatch) {
            return parseInt(confidenceMatch[1], 10) / 100;
        }

        // Look for confidence level keywords
        if (lower.includes('high confidence') || lower.includes('very confident')) {
            return 0.85;
        }
        if (lower.includes('moderate confidence') || lower.includes('fairly confident')) {
            return 0.65;
        }
        if (lower.includes('low confidence') || lower.includes('uncertain')) {
            return 0.4;
        }

        // Default confidence based on stance language
        if (lower.includes('definitely') || lower.includes('certainly') || lower.includes('absolutely')) {
            return 0.8;
        }
        if (lower.includes('probably') || lower.includes('likely')) {
            return 0.65;
        }
        if (lower.includes('possibly') || lower.includes('maybe') || lower.includes('might')) {
            return 0.45;
        }

        return 0.6; // Default moderate confidence
    }

    /**
     * Reset orchestrator to initial state
     */
    reset(): void {
        this.abortController?.abort();
        this.state = { ...INITIAL_BOUNCE_STATE };
    }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a bounce orchestrator with the standard API fetch
 */
export function createBounceOrchestrator(apiBaseUrl: string = '/api'): BounceOrchestrator {
    const sendMessage = async (
        modelId: string,
        systemPrompt: string,
        userMessage: string,
        signal?: AbortSignal
    ): Promise<string> => {
        const response = await fetch(`${apiBaseUrl}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: modelId,
                system: systemPrompt,
                messages: [{ role: 'user', content: userMessage }],
            }),
            signal,
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || 'API request failed');
        }

        // Handle streaming response
        const reader = response.body?.getReader();
        if (!reader) throw new Error('No response body');

        const decoder = new TextDecoder();
        let content = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            // Parse the Vercel AI SDK data stream format
            const lines = chunk.split('\n');
            for (const line of lines) {
                if (line.startsWith('0:')) {
                    // Text chunk
                    try {
                        const text = JSON.parse(line.slice(2));
                        content += text;
                    } catch {
                        // Not valid JSON, might be raw text
                        content += line.slice(2);
                    }
                }
            }
        }

        return content;
    };

    return new BounceOrchestrator(sendMessage);
}
