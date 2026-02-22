'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import {
    Play,
    Pause,
    Square,
    SkipForward,
    Users,
    MessageSquare,
    Zap,
    Settings2,
    ChevronDown,
    ChevronUp,
    Check,
    X,
} from 'lucide-react';
import {
    useAgentStore,
    useBounceState,
    useBounceConfig,
    useSelectedParticipants,
    useSessions,
} from '@/lib/store';
import {
    BounceOrchestrator,
    createBounceOrchestrator,
} from '@/lib/bounce-orchestrator';
import {
    BounceEvent,
    BounceStatus,
    SerializedBounceSession,
} from '@/lib/bounce-types';

interface BounceControllerProps {
    /** Initial topic to debate (from "Pass Baton" click) */
    initialTopic?: string;
    /** Callback when bounce completes */
    onComplete?: (finalAnswer: string) => void;
    /** Callback when bounce is cancelled */
    onCancel?: () => void;
}

export function BounceController({
    initialTopic,
    onComplete,
    onCancel,
}: BounceControllerProps) {
    const sessions = useSessions();
    const bounceState = useBounceState();
    const bounceConfig = useBounceConfig();
    const selectedParticipants = useSelectedParticipants();
    const bounceHistory = useAgentStore((state) => state.debate.bounceHistory);

    const {
        updateBounceState,
        setBounceConfig,
        addSelectedParticipant,
        updateSelectedParticipant,
        removeSelectedParticipant,
        clearSelectedParticipants,
        resetBounce,
    } = useAgentStore();

    const [topic, setTopic] = useState(initialTopic || '');
    const [showConfig, setShowConfig] = useState(false);
    const [userInterjection, setUserInterjection] = useState('');

    const orchestratorRef = useRef<BounceOrchestrator | null>(null);

    // Handle bounce events from orchestrator (defined before useEffect that uses it)
    const handleBounceEvent = useCallback((event: BounceEvent) => {
        switch (event.type) {
            case 'BOUNCE_STARTED':
                updateBounceState({
                    status: 'running',
                    originalTopic: event.topic,
                    startedAt: Date.now(),
                });
                break;

            case 'ROUND_STARTED':
                updateBounceState({ currentRound: event.roundNumber });
                break;

            case 'PARTICIPANT_THINKING':
                // Could show loading indicator for specific participant
                break;

            case 'PARTICIPANT_RESPONDED':
                // Responses are tracked in orchestrator state
                break;

            case 'ROUND_COMPLETE':
                // Always pull from orchestrator state to avoid stale closures.
                updateBounceState({
                    rounds: orchestratorRef.current?.getState().rounds ?? [event.round],
                });
                break;

            case 'CONSENSUS_UPDATED':
                updateBounceState({ consensus: event.consensus });
                break;

            case 'USER_INTERJECTION_REQUESTED':
                updateBounceState({ status: 'waiting_user' });
                break;

            case 'JUDGING_STARTED':
                updateBounceState({ status: 'judging' });
                break;

            case 'BOUNCE_PAUSED':
                updateBounceState({ status: 'paused' });
                break;

            case 'BOUNCE_RESUMED':
                updateBounceState({ status: 'running' });
                break;

            case 'BOUNCE_COMPLETE':
                updateBounceState({
                    status: 'complete',
                    finalAnswer: event.finalAnswer,
                    consensus: event.consensus,
                    completedAt: Date.now(),
                });
                onComplete?.(event.finalAnswer);
                break;

            case 'BOUNCE_ERROR':
                updateBounceState({
                    status: 'error',
                    error: event.error,
                });
                break;

            case 'BOUNCE_CANCELLED':
                updateBounceState({ status: 'idle' });
                onCancel?.();
                break;

            case 'PARTICIPANT_PRUNED':
                // Pruned participants are tracked in orchestrator state
                // UI updates via CONSENSUS_UPDATED and ROUND_COMPLETE
                break;
        }
    }, [updateBounceState, onComplete, onCancel]);

    // Initialize orchestrator
    useEffect(() => {
        if (!orchestratorRef.current) {
            orchestratorRef.current = createBounceOrchestrator();

            // Subscribe to events
            orchestratorRef.current.subscribe(handleBounceEvent);
        }

        return () => {
            orchestratorRef.current?.reset();
        };
    }, [handleBounceEvent]);

    // Start the debate
    const handleStart = useCallback(async () => {
        if (!topic.trim() || selectedParticipants.length < 2) {
            return;
        }

        const reliabilityByModel = deriveReliabilityByModel(bounceHistory);
        const participants = selectedParticipants.map((participant) => {
            const userWeight = clampUserWeight(participant.userWeight);
            const historicalReliability = reliabilityByModel.get(participant.modelId) ?? 1;
            const providedReliability = participant.reliabilityWeight;
            const reliabilityWeight = clampReliabilityWeight(
                typeof providedReliability === 'number' ? providedReliability : historicalReliability
            );

            return {
                ...participant,
                userWeight,
                reliabilityWeight,
            };
        });

        await orchestratorRef.current?.dispatch({
            type: 'START',
            topic,
            participants,
            config: bounceConfig,
        });
    }, [topic, selectedParticipants, bounceConfig, bounceHistory]);

    // Pause/Resume
    const handlePauseResume = useCallback(async () => {
        if (bounceState.status === 'running') {
            await orchestratorRef.current?.dispatch({ type: 'PAUSE' });
        } else if (bounceState.status === 'paused') {
            await orchestratorRef.current?.dispatch({ type: 'RESUME' });
        }
    }, [bounceState.status]);

    // Stop
    const handleStop = useCallback(async () => {
        await orchestratorRef.current?.dispatch({ type: 'STOP' });
        resetBounce();
    }, [resetBounce]);

    // Skip to judge
    const handleSkipToJudge = useCallback(async () => {
        await orchestratorRef.current?.dispatch({ type: 'SKIP_TO_JUDGE' });
    }, []);

    // Submit user interjection
    const handleInterjection = useCallback(async () => {
        if (!userInterjection.trim()) return;

        await orchestratorRef.current?.dispatch({
            type: 'INJECT_MESSAGE',
            message: userInterjection,
        });
        setUserInterjection('');
    }, [userInterjection]);

    // Continue without interjection
    const handleContinue = useCallback(async () => {
        await orchestratorRef.current?.dispatch({ type: 'RESUME' });
    }, []);

    // Toggle participant selection
    const toggleParticipant = useCallback((session: typeof sessions[0]) => {
        const isSelected = selectedParticipants.some(p => p.sessionId === session.id);

        if (isSelected) {
            removeSelectedParticipant(session.id);
        } else {
            addSelectedParticipant({
                sessionId: session.id,
                modelId: session.modelId,
                title: session.title,
                systemPrompt: session.systemPrompt,
                userWeight: 3,
                reliabilityWeight: 1,
            });
        }
    }, [selectedParticipants, addSelectedParticipant, removeSelectedParticipant]);

    const handleWeightChange = useCallback((sessionId: string, next: string) => {
        const parsed = Number.parseInt(next, 10);
        updateSelectedParticipant(sessionId, {
            userWeight: clampUserWeight(parsed),
        });
    }, [updateSelectedParticipant]);

    const isActive = bounceState.status !== 'idle' && bounceState.status !== 'complete' && bounceState.status !== 'error';
    const canStart = topic.trim().length > 0 && selectedParticipants.length >= 2 && !isActive;

    return (
        <div className="panel-shell rounded-xl overflow-hidden">
            {/* Header */}
            <div
                className="px-4 py-3 text-white"
                style={{
                    background:
                        'linear-gradient(120deg, color-mix(in srgb, var(--ac-accent) 72%, #0d1226), color-mix(in srgb, var(--ac-accent-strong) 86%, #0f1f3d))',
                }}
            >
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Zap className="w-5 h-5" />
                        <h3 className="font-semibold">Multi-Model Debate</h3>
                    </div>
                    <StatusBadge status={bounceState.status} />
                </div>
            </div>

            {/* Topic Input */}
            {!isActive && (
                <div className="p-4 border-b border-[color:var(--ac-border-soft)]">
                    <label className="block text-sm font-medium text-[color:var(--ac-text-dim)] mb-2">
                        Debate Topic
                    </label>
                    <textarea
                        value={topic}
                        onChange={(e) => setTopic(e.target.value)}
                        placeholder="Enter the topic or question to debate..."
                        className="ac-input px-3 py-2 text-sm resize-none"
                        rows={3}
                    />
                </div>
            )}

            {/* Participant Selection */}
            {!isActive && (
                <div className="p-4 border-b border-[color:var(--ac-border-soft)]">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <Users className="w-4 h-4 text-[color:var(--ac-text-muted)]" />
                            <span className="text-sm font-medium text-[color:var(--ac-text-dim)]">
                                Participants ({selectedParticipants.length})
                            </span>
                        </div>
                        {selectedParticipants.length > 0 && (
                            <button
                                onClick={clearSelectedParticipants}
                                className="text-xs text-[color:var(--ac-text-muted)] hover:text-[color:var(--ac-text)]"
                            >
                                Clear all
                            </button>
                        )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {sessions.map((session) => {
                            const isSelected = selectedParticipants.some(
                                p => p.sessionId === session.id
                            );
                            return (
                                <button
                                    key={session.id}
                                    onClick={() => toggleParticipant(session)}
                                    className={`
                                        px-3 py-1.5 rounded-full text-sm font-medium transition-all
                                        ${isSelected
                                            ? 'ring-2 text-[color:var(--ac-text)]'
                                            : 'ac-soft-surface text-[color:var(--ac-text-dim)] hover:border-[color:var(--ac-border)]'
                                        }
                                    `}
                                    style={isSelected ? {
                                        background: 'color-mix(in srgb, var(--ac-accent) 16%, var(--ac-surface))',
                                        borderColor: 'var(--ac-accent)',
                                        boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--ac-accent) 65%, transparent)',
                                    } : undefined}
                                >
                                    {isSelected && <Check className="w-3 h-3 inline mr-1" />}
                                    {session.title}
                                </button>
                            );
                        })}
                    </div>

                    {sessions.length === 0 && (
                        <p className="text-sm text-[color:var(--ac-text-muted)]">
                            No active sessions. Add some models to start a debate.
                        </p>
                    )}

                    {selectedParticipants.length < 2 && sessions.length >= 2 && (
                        <p className="text-xs mt-2" style={{ color: 'color-mix(in srgb, var(--ac-accent-warm) 88%, #fff 12%)' }}>
                            Select at least 2 participants to start
                        </p>
                    )}

                    {selectedParticipants.length > 0 && (
                        <div className="mt-4 space-y-2">
                            <p className="text-xs text-[color:var(--ac-text-muted)]">
                                Influence Weights (1-5)
                            </p>
                            {selectedParticipants.map((participant) => (
                                <div
                                    key={`weight-${participant.sessionId}`}
                                    className="ac-soft-surface rounded-lg px-3 py-2 flex items-center justify-between gap-3"
                                >
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium text-[color:var(--ac-text)] truncate">
                                            {participant.title}
                                        </p>
                                        <p className="text-xs text-[color:var(--ac-text-muted)]">
                                            Reliability: {(participant.reliabilityWeight ?? 1).toFixed(2)}
                                        </p>
                                    </div>
                                    <label className="flex items-center gap-2 text-xs text-[color:var(--ac-text-muted)]">
                                        <span>Weight</span>
                                        <select
                                            value={String(clampUserWeight(participant.userWeight))}
                                            onChange={(event) => handleWeightChange(participant.sessionId, event.target.value)}
                                            className="ac-input px-2 py-1 text-xs w-16"
                                        >
                                            <option value="1">1</option>
                                            <option value="2">2</option>
                                            <option value="3">3</option>
                                            <option value="4">4</option>
                                            <option value="5">5</option>
                                        </select>
                                    </label>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Configuration */}
            {!isActive && (
                <div className="border-b border-[color:var(--ac-border-soft)]">
                    <button
                        onClick={() => setShowConfig(!showConfig)}
                        className="w-full px-4 py-2 flex items-center justify-between text-sm text-[color:var(--ac-text-dim)] hover:bg-[color:var(--ac-surface)]"
                    >
                        <div className="flex items-center gap-2">
                            <Settings2 className="w-4 h-4" />
                            <span>Configuration</span>
                        </div>
                        {showConfig ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>

                    {showConfig && (
                        <div className="px-4 pb-4 space-y-4">
                            {/* Mode */}
                            <div>
                                <label className="block text-xs font-medium text-[color:var(--ac-text-muted)] mb-1">
                                    Debate Mode
                                </label>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setBounceConfig({ mode: 'sequential' })}
                                        className={`flex-1 px-3 py-2 rounded-lg text-sm ${
                                            bounceConfig.mode === 'sequential'
                                                ? 'text-[color:var(--ac-text)]'
                                                : 'ac-soft-surface text-[color:var(--ac-text-dim)]'
                                        }`}
                                        style={bounceConfig.mode === 'sequential' ? {
                                            background: 'color-mix(in srgb, var(--ac-accent) 14%, var(--ac-surface))',
                                            border: '1px solid color-mix(in srgb, var(--ac-accent) 55%, var(--ac-border))',
                                        } : undefined}
                                    >
                                        Sequential
                                    </button>
                                    <button
                                        onClick={() => setBounceConfig({ mode: 'parallel' })}
                                        className={`flex-1 px-3 py-2 rounded-lg text-sm ${
                                            bounceConfig.mode === 'parallel'
                                                ? 'text-[color:var(--ac-text)]'
                                                : 'ac-soft-surface text-[color:var(--ac-text-dim)]'
                                        }`}
                                        style={bounceConfig.mode === 'parallel' ? {
                                            background: 'color-mix(in srgb, var(--ac-accent) 14%, var(--ac-surface))',
                                            border: '1px solid color-mix(in srgb, var(--ac-accent) 55%, var(--ac-border))',
                                        } : undefined}
                                    >
                                        Parallel
                                    </button>
                                </div>
                            </div>

                            {/* Max Rounds */}
                            <div>
                                <label className="block text-xs font-medium text-[color:var(--ac-text-muted)] mb-1">
                                    Max Rounds: {bounceConfig.maxRounds}
                                </label>
                                <input
                                    type="range"
                                    min={1}
                                    max={10}
                                    value={bounceConfig.maxRounds}
                                    onChange={(e) => setBounceConfig({ maxRounds: parseInt(e.target.value) })}
                                    className="w-full"
                                />
                            </div>

                            {/* Consensus Threshold */}
                            <div>
                                <label className="block text-xs font-medium text-[color:var(--ac-text-muted)] mb-1">
                                    Consensus Threshold: {Math.round(bounceConfig.consensusThreshold * 100)}%
                                </label>
                                <input
                                    type="range"
                                    min={50}
                                    max={100}
                                    value={bounceConfig.consensusThreshold * 100}
                                    onChange={(e) => setBounceConfig({ consensusThreshold: parseInt(e.target.value) / 100 })}
                                    className="w-full"
                                />
                            </div>

                            {/* Consensus Mode */}
                            <div>
                                <label className="block text-xs font-medium text-[color:var(--ac-text-muted)] mb-1">
                                    Vote Mode
                                </label>
                                <div className="grid grid-cols-3 gap-2">
                                    {(['majority', 'weighted', 'unanimous'] as const).map((mode) => (
                                        <button
                                            key={mode}
                                            onClick={() => setBounceConfig({ consensusMode: mode })}
                                            className={`px-2 py-2 rounded-lg text-xs capitalize ${
                                                bounceConfig.consensusMode === mode
                                                    ? 'text-[color:var(--ac-text)]'
                                                    : 'ac-soft-surface text-[color:var(--ac-text-dim)]'
                                            }`}
                                            style={bounceConfig.consensusMode === mode ? {
                                                background: 'color-mix(in srgb, var(--ac-accent) 14%, var(--ac-surface))',
                                                border: '1px solid color-mix(in srgb, var(--ac-accent) 55%, var(--ac-border))',
                                            } : undefined}
                                        >
                                            {mode}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Proposal Quorum */}
                            <div>
                                <label className="block text-xs font-medium text-[color:var(--ac-text-muted)] mb-1">
                                    Proposal Quorum: {Math.round(bounceConfig.resolutionQuorum * 100)}%
                                </label>
                                <input
                                    type="range"
                                    min={50}
                                    max={100}
                                    value={bounceConfig.resolutionQuorum * 100}
                                    onChange={(e) => setBounceConfig({ resolutionQuorum: parseInt(e.target.value, 10) / 100 })}
                                    className="w-full"
                                />
                            </div>

                            {/* Stable Rounds */}
                            <div>
                                <label className="block text-xs font-medium text-[color:var(--ac-text-muted)] mb-1">
                                    Stable Rounds: {bounceConfig.minimumStableRounds}
                                </label>
                                <input
                                    type="range"
                                    min={1}
                                    max={4}
                                    value={bounceConfig.minimumStableRounds}
                                    onChange={(e) => setBounceConfig({ minimumStableRounds: parseInt(e.target.value, 10) })}
                                    className="w-full"
                                />
                            </div>

                            {/* User Interjection */}
                            <div className="flex items-center justify-between">
                                <span className="text-xs text-[color:var(--ac-text-muted)]">
                                    Allow interjections
                                </span>
                                <button
                                    onClick={() => setBounceConfig({ allowUserInterjection: !bounceConfig.allowUserInterjection })}
                                    className={`w-10 h-6 rounded-full transition-colors ${
                                        bounceConfig.allowUserInterjection
                                            ? 'bg-[color:var(--ac-accent)]'
                                            : 'bg-gray-300 dark:bg-gray-600'
                                    }`}
                                >
                                    <div className={`w-4 h-4 bg-white rounded-full transition-transform ${
                                        bounceConfig.allowUserInterjection
                                            ? 'translate-x-5'
                                            : 'translate-x-1'
                                    }`} />
                                </button>
                            </div>

                            {/* Participant Pruning */}
                            <div className="flex items-center justify-between">
                                <div>
                                    <span className="text-xs text-[color:var(--ac-text-muted)]">
                                        Prune aligned models
                                    </span>
                                    <p className="text-xs text-[color:var(--ac-text-muted)] mt-0.5">
                                        Drop redundant participants between rounds
                                    </p>
                                </div>
                                <button
                                    onClick={() => setBounceConfig({ enablePruning: !bounceConfig.enablePruning })}
                                    className={`w-10 h-6 rounded-full transition-colors ${
                                        bounceConfig.enablePruning
                                            ? 'bg-[color:var(--ac-accent)]'
                                            : 'bg-gray-300 dark:bg-gray-600'
                                    }`}
                                >
                                    <div className={`w-4 h-4 bg-white rounded-full transition-transform ${
                                        bounceConfig.enablePruning
                                            ? 'translate-x-5'
                                            : 'translate-x-1'
                                    }`} />
                                </button>
                            </div>

                            {/* Context Token Budget */}
                            <div>
                                <label className="block text-xs font-medium text-[color:var(--ac-text-muted)] mb-1">
                                    Context Budget: {bounceConfig.maxContextTokens.toLocaleString()} tokens
                                </label>
                                <input
                                    type="range"
                                    min={2000}
                                    max={32000}
                                    step={1000}
                                    value={bounceConfig.maxContextTokens}
                                    onChange={(e) => setBounceConfig({ maxContextTokens: parseInt(e.target.value) })}
                                    className="w-full"
                                />
                                <p className="text-xs text-[color:var(--ac-text-muted)] mt-0.5">
                                    Older responses are trimmed when context exceeds budget
                                </p>
                            </div>

                            {/* Retry Budget */}
                            <div>
                                <label className="block text-xs font-medium text-[color:var(--ac-text-muted)] mb-1">
                                    Retry Budget Per Model: {bounceConfig.maxResponseRetries}
                                </label>
                                <input
                                    type="range"
                                    min={0}
                                    max={3}
                                    value={bounceConfig.maxResponseRetries}
                                    onChange={(e) => setBounceConfig({ maxResponseRetries: parseInt(e.target.value, 10) })}
                                    className="w-full"
                                />
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* User Interjection Input */}
            {bounceState.status === 'waiting_user' && (
                <div className="p-4 border-b border-[color:var(--ac-border-soft)]" style={{ background: 'color-mix(in srgb, var(--ac-accent-warm) 14%, var(--ac-surface))' }}>
                    <div className="flex items-center gap-2 mb-2">
                        <MessageSquare className="w-4 h-4" style={{ color: 'color-mix(in srgb, var(--ac-accent-warm) 86%, #fff 14%)' }} />
                        <span className="text-sm font-medium" style={{ color: 'color-mix(in srgb, var(--ac-accent-warm) 88%, #fff 12%)' }}>
                            Your turn to interject
                        </span>
                    </div>
                    <textarea
                        value={userInterjection}
                        onChange={(e) => setUserInterjection(e.target.value)}
                        placeholder="Add context, redirect the discussion, or ask a clarifying question..."
                        className="ac-input px-3 py-2 text-sm resize-none mb-2"
                        rows={2}
                    />
                    <div className="flex gap-2">
                        <button
                            onClick={handleInterjection}
                            disabled={!userInterjection.trim()}
                            className="ac-btn-primary flex-1 px-3 py-2 text-white rounded-lg text-sm font-medium transition-all disabled:opacity-40"
                        >
                            Submit
                        </button>
                        <button
                            onClick={handleContinue}
                            className="control-chip px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                        >
                            Skip
                        </button>
                    </div>
                </div>
            )}

            {/* Progress */}
            {isActive && bounceState.consensus && (
                <div className="p-4 border-b border-[color:var(--ac-border-soft)]">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-[color:var(--ac-text-dim)]">
                            Round {bounceState.currentRound} of {bounceConfig.maxRounds}
                        </span>
                        <span className="text-sm font-medium text-[color:var(--ac-text)]">
                            Consensus: {Math.round(bounceState.consensus.score * 100)}%
                        </span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden ac-soft-surface">
                        <div
                            className={`h-full transition-all duration-500 ${
                                bounceState.consensus.level === 'unanimous' || bounceState.consensus.level === 'strong'
                                    ? 'bg-green-500'
                                    : bounceState.consensus.level === 'partial'
                                    ? 'bg-yellow-500'
                                    : 'bg-red-500'
                            }`}
                            style={{ width: `${bounceState.consensus.score * 100}%` }}
                        />
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-[color:var(--ac-text-muted)]">
                        <span>Vote: {bounceState.consensus.consensusOutcome}</span>
                        <span>Quorum: {Math.round(bounceState.consensus.proposalConvergence.supportRatio * 100)}%</span>
                        <span>Stable: {bounceState.consensus.stableRounds}/{bounceConfig.minimumStableRounds}</span>
                    </div>
                </div>
            )}

            {/* Controls */}
            <div className="p-4 flex gap-2">
                {!isActive ? (
                    <button
                        onClick={handleStart}
                        disabled={!canStart}
                        className="ac-btn-primary flex-1 flex items-center justify-center gap-2 px-4 py-2 text-white rounded-lg font-medium transition-all disabled:opacity-40"
                    >
                        <Play className="w-4 h-4" />
                        Start Debate
                    </button>
                ) : (
                    <>
                        <button
                            onClick={handlePauseResume}
                            className="control-chip flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors"
                        >
                            {bounceState.status === 'paused' ? (
                                <>
                                    <Play className="w-4 h-4" />
                                    Resume
                                </>
                            ) : (
                                <>
                                    <Pause className="w-4 h-4" />
                                    Pause
                                </>
                            )}
                        </button>
                        <button
                            onClick={handleSkipToJudge}
                            className="control-chip flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors"
                            style={{ borderColor: 'color-mix(in srgb, var(--ac-accent) 55%, var(--ac-border))' }}
                        >
                            <SkipForward className="w-4 h-4" />
                            Judge Now
                        </button>
                        <button
                            onClick={handleStop}
                            className="ac-btn-danger flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors"
                        >
                            <Square className="w-4 h-4" />
                        </button>
                    </>
                )}
            </div>

            {/* Error Display */}
            {bounceState.status === 'error' && bounceState.error && (
                <div className="mx-4 mb-4 p-3 rounded-lg ac-btn-danger">
                    <div className="flex items-center gap-2 text-[color:var(--ac-danger)]">
                        <X className="w-4 h-4" />
                        <span className="text-sm">{bounceState.error}</span>
                    </div>
                </div>
            )}
        </div>
    );
}

function clampUserWeight(value: number | undefined): number {
    const raw = Number.isFinite(value as number) ? Number(value) : 3;
    return Math.max(1, Math.min(5, Math.round(raw)));
}

function clampReliabilityWeight(value: number): number {
    if (!Number.isFinite(value)) return 1;
    return Math.max(0.5, Math.min(1.5, value));
}

function deriveReliabilityByModel(history: SerializedBounceSession[]): Map<string, number> {
    const stats = new Map<string, { hits: number; total: number }>();

    for (const session of history) {
        const finalRound = session.rounds[session.rounds.length - 1];
        if (!finalRound) continue;

        const supporters = new Set(finalRound.consensusAtEnd.proposalConvergence.supporters);
        for (const response of finalRound.responses) {
            const current = stats.get(response.modelId) || { hits: 0, total: 0 };
            current.total += 1;
            if (supporters.has(response.participantSessionId)) {
                current.hits += 1;
            }
            stats.set(response.modelId, current);
        }
    }

    const result = new Map<string, number>();
    for (const [modelId, { hits, total }] of stats.entries()) {
        // Laplace smoothing to avoid extreme reliability from tiny samples.
        const smoothedRate = (hits + 1) / (total + 2);
        const reliability = 0.75 + smoothedRate * 0.5;
        result.set(modelId, clampReliabilityWeight(reliability));
    }

    return result;
}

// Status badge component
function StatusBadge({ status }: { status: BounceStatus }) {
    const config: Record<BounceStatus, { label: string; color: string }> = {
        idle: { label: 'Ready', color: 'bg-gray-400' },
        configuring: { label: 'Configuring', color: 'bg-blue-400' },
        running: { label: 'Debating', color: 'bg-green-400 animate-pulse' },
        paused: { label: 'Paused', color: 'bg-yellow-400' },
        waiting_user: { label: 'Your Turn', color: 'bg-amber-400 animate-pulse' },
        consensus: { label: 'Consensus!', color: 'bg-green-500' },
        max_rounds: { label: 'Max Rounds', color: 'bg-orange-400' },
        judging: { label: 'Judging', color: 'bg-purple-400 animate-pulse' },
        complete: { label: 'Complete', color: 'bg-green-500' },
        error: { label: 'Error', color: 'bg-red-500' },
    };

    const { label, color } = config[status];

    return (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium text-white ${color}`}>
            {label}
        </span>
    );
}
