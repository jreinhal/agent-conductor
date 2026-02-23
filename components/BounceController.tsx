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
    BounceConsensusMode,
    ConsensusAnalysis,
    BounceStatus,
    SerializedBounceSession,
} from '@/lib/bounce-types';

const WAITING_AUTO_CONTINUE_SECONDS = 12;

interface BounceControllerProps {
    /** Initial topic to debate (from "Pass Baton" click) */
    initialTopic?: string;
    /** Callback when bounce completes */
    onComplete?: (finalAnswer: string) => void;
    /** Callback when bounce is cancelled */
    onCancel?: () => void;
    /** Shared local file context to include in each round */
    fileContext?: string;
    /** Number of files currently included in debate context */
    attachedFileCount?: number;
}

export function BounceController({
    initialTopic,
    onComplete,
    onCancel,
    fileContext,
    attachedFileCount = 0,
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
    const [showMathDetails, setShowMathDetails] = useState(true);
    const [userInterjection, setUserInterjection] = useState('');
    const [activeThinkers, setActiveThinkers] = useState<string[]>([]);
    const [lastActivityAt, setLastActivityAt] = useState<number | null>(null);
    const [clockNow, setClockNow] = useState<number>(0);
    const [waitingSinceAt, setWaitingSinceAt] = useState<number | null>(null);
    const [autoContinueEnabled, setAutoContinueEnabled] = useState<boolean>(true);

    const orchestratorRef = useRef<BounceOrchestrator | null>(null);
    const autoContinuedForWaitAtRef = useRef<number | null>(null);
    const fileContextRef = useRef<string>(fileContext || '');

    useEffect(() => {
        fileContextRef.current = fileContext || '';
    }, [fileContext]);

    useEffect(() => {
        const timer = setInterval(() => {
            setClockNow(Date.now());
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    // Handle bounce events from orchestrator (defined before useEffect that uses it)
    const handleBounceEvent = useCallback((event: BounceEvent) => {
        switch (event.type) {
            case 'BOUNCE_STARTED':
                updateBounceState({
                    status: 'running',
                    originalTopic: event.topic,
                    startedAt: Date.now(),
                });
                setActiveThinkers([]);
                setLastActivityAt(Date.now());
                setWaitingSinceAt(null);
                break;

            case 'ROUND_STARTED':
                updateBounceState({ currentRound: event.roundNumber });
                setLastActivityAt(Date.now());
                break;

            case 'PARTICIPANT_THINKING':
                setActiveThinkers((prev) => (
                    prev.includes(event.sessionId) ? prev : [...prev, event.sessionId]
                ));
                setLastActivityAt(Date.now());
                break;

            case 'PARTICIPANT_RESPONDED':
                setActiveThinkers((prev) => prev.filter((sessionId) => sessionId !== event.response.participantSessionId));
                setLastActivityAt(Date.now());
                break;

            case 'ROUND_COMPLETE':
                // Always pull from orchestrator state to avoid stale closures.
                updateBounceState({
                    rounds: orchestratorRef.current?.getState().rounds ?? [event.round],
                });
                setActiveThinkers([]);
                setLastActivityAt(Date.now());
                setWaitingSinceAt(null);
                break;

            case 'CONSENSUS_UPDATED':
                updateBounceState({ consensus: event.consensus });
                setLastActivityAt(Date.now());
                break;

            case 'USER_INTERJECTION_REQUESTED':
                updateBounceState({ status: 'waiting_user' });
                setActiveThinkers([]);
                setLastActivityAt(Date.now());
                setWaitingSinceAt(Date.now());
                break;

            case 'JUDGING_STARTED':
                updateBounceState({ status: 'judging' });
                setActiveThinkers([]);
                setLastActivityAt(Date.now());
                setWaitingSinceAt(null);
                break;

            case 'BOUNCE_PAUSED':
                updateBounceState({ status: 'paused' });
                setActiveThinkers([]);
                setLastActivityAt(Date.now());
                setWaitingSinceAt(null);
                break;

            case 'BOUNCE_RESUMED':
                updateBounceState({ status: 'running' });
                setLastActivityAt(Date.now());
                setWaitingSinceAt(null);
                break;

            case 'BOUNCE_COMPLETE':
                updateBounceState({
                    status: 'complete',
                    finalAnswer: event.finalAnswer,
                    consensus: event.consensus,
                    completedAt: Date.now(),
                });
                setActiveThinkers([]);
                setLastActivityAt(Date.now());
                setWaitingSinceAt(null);
                onComplete?.(event.finalAnswer);
                break;

            case 'BOUNCE_ERROR':
                updateBounceState({
                    status: 'error',
                    error: event.error,
                });
                setActiveThinkers([]);
                setLastActivityAt(Date.now());
                setWaitingSinceAt(null);
                break;

            case 'BOUNCE_CANCELLED':
                updateBounceState({ status: 'idle' });
                setActiveThinkers([]);
                setLastActivityAt(Date.now());
                setWaitingSinceAt(null);
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
            orchestratorRef.current = createBounceOrchestrator('/api', () => fileContextRef.current);

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
        setWaitingSinceAt(null);
    }, [userInterjection]);

    // Continue without interjection
    const handleContinue = useCallback(async () => {
        setWaitingSinceAt(null);
        await orchestratorRef.current?.dispatch({ type: 'RESUME' });
    }, []);

    useEffect(() => {
        if (bounceState.status !== 'waiting_user') {
            autoContinuedForWaitAtRef.current = null;
            return;
        }
        if (!autoContinueEnabled) return;
        if (userInterjection.trim().length > 0) return;
        if (!waitingSinceAt) return;

        const waitMs = clockNow - waitingSinceAt;
        if (waitMs < WAITING_AUTO_CONTINUE_SECONDS * 1000) return;
        if (autoContinuedForWaitAtRef.current === waitingSinceAt) return;

        autoContinuedForWaitAtRef.current = waitingSinceAt;
        void orchestratorRef.current?.dispatch({ type: 'RESUME' });
    }, [bounceState.status, autoContinueEnabled, userInterjection, waitingSinceAt, clockNow]);

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
    const consensusMath = bounceState.consensus
        ? deriveConsensusMath(bounceState.consensus, bounceConfig.consensusMode)
        : null;
    const sortedInfluence = bounceState.consensus
        ? [...bounceState.consensus.influence.modelBreakdown].sort(
            (a, b) => Math.abs(b.signedContribution) - Math.abs(a.signedContribution)
        )
        : [];
    const secondsSinceActivity = lastActivityAt
        ? Math.max(0, Math.floor((clockNow - lastActivityAt) / 1000))
        : 0;
    const waitingSecondsElapsed = waitingSinceAt
        ? Math.max(0, Math.floor((clockNow - waitingSinceAt) / 1000))
        : 0;
    const autoContinueIn = Math.max(0, WAITING_AUTO_CONTINUE_SECONDS - waitingSecondsElapsed);
    const isInterjectionDrafted = userInterjection.trim().length > 0;
    const activeThinkerLabels = activeThinkers.map((sessionId) => {
        const selected = selectedParticipants.find((participant) => participant.sessionId === sessionId);
        if (selected?.title) return selected.title;
        const session = sessions.find((entry) => entry.id === sessionId);
        return session?.title || sessionId;
    });
    const activityTone: 'active' | 'waiting' | 'warning' | 'muted' =
        bounceState.status === 'waiting_user'
            ? 'waiting'
            : bounceState.status === 'running' && secondsSinceActivity >= 45
            ? 'warning'
            : bounceState.status === 'running'
            ? 'active'
            : 'muted';
    const activityMessage =
        bounceState.status === 'waiting_user'
            ? `Waiting for your input before Round ${Math.min(bounceState.currentRound + 1, bounceConfig.maxRounds)}. Use Submit or Skip to continue.`
            : bounceState.status === 'paused'
            ? 'Debate is paused.'
            : bounceState.status === 'running' && activeThinkerLabels.length > 0
            ? `${activeThinkerLabels.join(', ')} ${activeThinkerLabels.length > 1 ? 'are' : 'is'} actively debating.`
            : bounceState.status === 'running' && secondsSinceActivity >= 45
            ? `No new debate events for ${secondsSinceActivity}s.`
            : bounceState.status === 'running'
            ? 'Coordinating next turn...'
            : null;
    const freshnessDotColor =
        secondsSinceActivity < 10 ? 'bg-green-400' :
        secondsSinceActivity < 30 ? 'bg-amber-400' :
        'bg-red-400';
    const gateReason = getGateReason(bounceState.status, bounceState.currentRound, bounceConfig.maxRounds, bounceState.consensus, bounceState.error, secondsSinceActivity);

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
            {attachedFileCount > 0 && (
                <div className="px-4 py-3 border-b border-[color:var(--ac-border-soft)]">
                    <div className="ac-soft-surface rounded-lg px-3 py-2 text-xs text-[color:var(--ac-text-muted)]">
                        {attachedFileCount} attached file{attachedFileCount === 1 ? '' : 's'} will be included in each debate round and the final judge synthesis.
                    </div>
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
                    <div className="mb-2 flex items-center justify-between gap-3">
                        <p className="text-xs" style={{ color: 'color-mix(in srgb, var(--ac-accent-warm) 74%, #fff 26%)' }}>
                            Debate is paused waiting for your input.
                        </p>
                        <button
                            onClick={() => setAutoContinueEnabled((prev) => !prev)}
                            className="control-chip px-2.5 py-1 rounded-md text-[11px] whitespace-nowrap"
                        >
                            {autoContinueEnabled ? 'Auto-continue on' : 'Auto-continue off'}
                        </button>
                    </div>
                    <div className="mb-2 text-[11px] text-[color:var(--ac-text-muted)]">
                        {autoContinueEnabled
                            ? isInterjectionDrafted
                                ? 'Auto-continue is paused while you are typing.'
                                : `Continuing automatically in ${autoContinueIn}s unless you submit input.`
                            : 'Auto-continue is disabled for this debate.'}
                    </div>
                    <textarea
                        value={userInterjection}
                        onChange={(e) => setUserInterjection(e.target.value)}
                        placeholder="Add context, redirect the discussion, or ask a clarifying question..."
                        className="ac-input px-3 py-2 text-sm leading-relaxed resize-y mb-2 min-h-[110px]"
                        rows={4}
                    />
                    <div className="flex gap-2">
                        <button
                            onClick={handleInterjection}
                            disabled={!userInterjection.trim()}
                            className="ac-btn-primary flex-1 px-3 py-2 text-white rounded-lg text-sm font-medium transition-all disabled:opacity-40"
                        >
                            Submit & Continue
                        </button>
                        <button
                            onClick={handleContinue}
                            className="control-chip px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                        >
                            Continue Without Input
                        </button>
                    </div>
                </div>
            )}

            {/* Activity / Heartbeat / Gate-Reason (always visible when active) */}
            {isActive && (
                <div className="px-4 pt-4 pb-2 border-b border-[color:var(--ac-border-soft)]">
                    {activityMessage ? (
                        <div className={`px-3 py-2 rounded-lg text-xs border ${
                            activityTone === 'active'
                                ? 'text-cyan-300 border-cyan-500/40 bg-cyan-500/10'
                                : activityTone === 'waiting'
                                ? 'text-amber-300 border-amber-500/40 bg-amber-500/10'
                                : activityTone === 'warning'
                                ? 'text-[color:var(--ac-danger)] border-[color:var(--ac-danger)]/40 bg-[color:var(--ac-danger)]/10'
                                : 'text-[color:var(--ac-text-muted)] border-[color:var(--ac-border-soft)] bg-[color:var(--ac-surface)]'
                        }`}>
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                    {bounceState.status === 'running' && (
                                        <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${freshnessDotColor}`} title={`Last activity ${secondsSinceActivity}s ago`} />
                                    )}
                                    <span>{activityMessage}</span>
                                </div>
                                <span className="font-mono text-[10px] opacity-80">
                                    {secondsSinceActivity}s ago
                                </span>
                            </div>
                            {gateReason && (
                                <div className="mt-1.5 text-[11px] opacity-75">{gateReason}</div>
                            )}
                        </div>
                    ) : (
                        <div className="px-3 py-2 rounded-lg text-xs border text-cyan-300 border-cyan-500/40 bg-cyan-500/10">
                            <div className="flex items-center gap-2">
                                <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${freshnessDotColor}`} />
                                <span>Round {bounceState.currentRound || 1} is initializing...</span>
                                <span className="ml-auto font-mono text-[10px] opacity-80">
                                    {secondsSinceActivity}s ago
                                </span>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Consensus Metrics (only after first consensus analysis) */}
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

                    <button
                        onClick={() => setShowMathDetails((prev) => !prev)}
                        className="mt-3 w-full control-chip px-3 py-2 rounded-lg text-xs flex items-center justify-between"
                    >
                        <span>Consensus Math Breakdown</span>
                        {showMathDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>

                    {showMathDetails && consensusMath && (
                        <div className="mt-2 rounded-lg ac-soft-surface p-3 space-y-3">
                            <div className="text-[11px] font-mono text-[color:var(--ac-text-muted)]">
                                score = 45% gate + 35% quorum + 20% semantic
                            </div>

                            <div className="h-2 rounded-full overflow-hidden ac-soft-surface flex">
                                <div
                                    className="h-full bg-cyan-500/90"
                                    style={{ width: `${consensusMath.gateContribution * 100}%` }}
                                    title={`Gate contribution ${Math.round(consensusMath.gateContribution * 100)}%`}
                                />
                                <div
                                    className="h-full bg-indigo-500/90"
                                    style={{ width: `${consensusMath.quorumContribution * 100}%` }}
                                    title={`Quorum contribution ${Math.round(consensusMath.quorumContribution * 100)}%`}
                                />
                                <div
                                    className="h-full bg-emerald-500/90"
                                    style={{ width: `${consensusMath.semanticContribution * 100}%` }}
                                    title={`Semantic contribution ${Math.round(consensusMath.semanticContribution * 100)}%`}
                                />
                            </div>

                            <div className="grid grid-cols-3 gap-2 text-[11px] text-[color:var(--ac-text-muted)]">
                                <span className="ac-badge px-2 py-1 rounded">
                                    gate {Math.round(consensusMath.gateContribution * 100)}%
                                </span>
                                <span className="ac-badge px-2 py-1 rounded">
                                    quorum {Math.round(consensusMath.quorumContribution * 100)}%
                                </span>
                                <span className="ac-badge px-2 py-1 rounded">
                                    semantic {Math.round(consensusMath.semanticContribution * 100)}%
                                </span>
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-[11px] text-[color:var(--ac-text-muted)]">
                                <span className="ac-badge px-2 py-1 rounded">
                                    weighted support {Math.round(bounceState.consensus.influence.weightedSupportRatio * 100)}%
                                    {' '}vs threshold {Math.round(bounceConfig.consensusThreshold * 100)}%
                                </span>
                                <span className="ac-badge px-2 py-1 rounded">
                                    vote score {Math.round(consensusMath.normalizedVoteScore * 100)}%
                                </span>
                                <span className={`ac-badge px-2 py-1 rounded ${
                                    bounceState.consensus.influence.unweightedGatePassed
                                        ? 'text-emerald-400'
                                        : 'text-[color:var(--ac-text-muted)]'
                                }`}>
                                    unweighted gate {bounceState.consensus.influence.unweightedGatePassed ? 'passed' : 'pending'}
                                </span>
                                <span className={`ac-badge px-2 py-1 rounded ${
                                    bounceState.consensus.influence.weightedGatePassed
                                        ? 'text-emerald-400'
                                        : 'text-[color:var(--ac-text-muted)]'
                                }`}>
                                    weighted gate {bounceState.consensus.influence.weightedGatePassed ? 'passed' : 'pending'}
                                </span>
                            </div>

                            {sortedInfluence.length > 0 && (
                                <div className="space-y-2">
                                    {sortedInfluence.map((entry) => {
                                        const isSupport = entry.signedContribution >= 0;
                                        const sharePct = Math.round(entry.effectiveShare * 100);
                                        const stance = bounceState.consensus?.stanceBreakdown[entry.sessionId];
                                        const stanceLabel = stance
                                            ? stance.replace(/_/g, ' ')
                                            : '';
                                        const stanceColor = entry.stanceValue >= 0.5
                                            ? 'text-emerald-400'
                                            : entry.stanceValue >= 0
                                            ? 'text-yellow-400'
                                            : 'text-rose-400';
                                        return (
                                            <div
                                                key={`influence-${entry.sessionId}`}
                                                className="rounded-md border border-[color:var(--ac-border-soft)] px-2.5 py-2"
                                            >
                                                <div className="flex items-center justify-between text-[11px]">
                                                    <span className="font-medium text-[color:var(--ac-text)] truncate pr-2">
                                                        {entry.modelTitle}
                                                    </span>
                                                    <div className="flex items-center gap-2">
                                                        {stanceLabel && (
                                                            <span className={`text-[10px] ${stanceColor}`}>
                                                                {stanceLabel}
                                                            </span>
                                                        )}
                                                        <span className={isSupport ? 'text-emerald-400' : 'text-rose-400'}>
                                                            {formatSignedPercent(entry.signedContribution)}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="mt-1 text-[10px] text-[color:var(--ac-text-muted)]">
                                                    weight {entry.userWeight.toFixed(0)} · reliability {entry.reliabilityWeight.toFixed(2)} · confidence {entry.confidenceModifier.toFixed(2)} → {sharePct}% share
                                                </div>
                                                {/* Split bar: support portion in green, opposition in red */}
                                                <div className="mt-1.5 h-2 rounded-full overflow-hidden bg-[color:var(--ac-surface)] flex">
                                                    <div
                                                        className="h-full bg-emerald-400/80 transition-all duration-500"
                                                        style={{ width: `${isSupport ? Math.max(3, sharePct) : 0}%` }}
                                                    />
                                                    <div
                                                        className="h-full bg-rose-400/80 transition-all duration-500"
                                                        style={{ width: `${!isSupport ? Math.max(3, sharePct) : 0}%` }}
                                                    />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Controls */}
            <div className="p-4 flex gap-2">
                {!isActive ? (
                    <button
                        onClick={handleStart}
                        disabled={!canStart}
                        title={!canStart ? 'Select at least 2 models and enter a topic' : undefined}
                        className="ac-btn-primary flex-1 flex items-center justify-center gap-2 px-4 py-2 text-white rounded-lg font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        <Play className="w-4 h-4" />
                        Start Debate
                    </button>
                ) : (
                    <>
                        <button
                            onClick={handlePauseResume}
                            className="ac-btn-primary flex-1 flex items-center justify-center gap-2 px-4 py-2 text-white rounded-lg font-medium transition-all"
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
                            title="Stop debate"
                            className="ac-btn-danger flex items-center justify-center px-3 py-2 rounded-lg transition-colors"
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

interface DerivedConsensusMath {
    normalizedVoteScore: number;
    gateAlignment: number;
    gateContribution: number;
    quorumContribution: number;
    semanticScore: number;
    semanticContribution: number;
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

function normalizeVoteScoreForMode(score: number, mode: BounceConsensusMode): number {
    if (mode === 'weighted') {
        // Weighted consensus scores can be in [-1, 1]; normalize for UI.
        return clamp01((score + 1) / 2);
    }
    return clamp01(score);
}

function deriveConsensusMath(consensus: ConsensusAnalysis, mode: BounceConsensusMode): DerivedConsensusMath {
    const normalizedVoteScore = normalizeVoteScoreForMode(consensus.voteScore, mode);
    const gateAlignment = clamp01(
        (consensus.influence.weightedSupportRatio * 0.55) +
        (normalizedVoteScore * 0.45)
    );
    const gateContribution = clamp01(gateAlignment * 0.45);
    const quorumContribution = clamp01(consensus.proposalConvergence.supportRatio * 0.35);
    const semanticContribution = clamp01(consensus.score - gateContribution - quorumContribution);
    const semanticScore = clamp01(semanticContribution / 0.20);

    return {
        normalizedVoteScore,
        gateAlignment,
        gateContribution,
        quorumContribution,
        semanticScore,
        semanticContribution,
    };
}

function formatSignedPercent(value: number): string {
    const pct = Math.round(value * 100);
    return `${pct >= 0 ? '+' : ''}${pct}%`;
}

function getGateReason(
    status: BounceStatus,
    currentRound: number,
    maxRounds: number,
    consensus: ConsensusAnalysis | null,
    error: string | null,
    secondsSinceActivity: number,
): string | null {
    switch (status) {
        case 'waiting_user':
            return 'Next round blocked: waiting for your interjection';
        case 'paused':
            return 'Debate paused by user';
        case 'consensus':
            return `Consensus reached at round ${currentRound} — proceeding to judge`;
        case 'max_rounds':
            return `Maximum rounds (${maxRounds}) reached — proceeding to judge`;
        case 'judging':
            return 'Judge is synthesizing final answer';
        case 'running':
            if (secondsSinceActivity > 30) {
                return `Models are responding — last activity ${secondsSinceActivity}s ago`;
            }
            return null;
        case 'error':
            return error || 'An error occurred';
        default:
            return null;
    }
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
