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

    const {
        updateBounceState,
        setBounceConfig,
        addSelectedParticipant,
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
                updateBounceState({
                    rounds: [...bounceState.rounds, event.round],
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
    }, [bounceState.rounds, updateBounceState, onComplete, onCancel]);

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

    // Update topic when initialTopic changes
    useEffect(() => {
        if (initialTopic) {
            setTopic(initialTopic);
        }
    }, [initialTopic]);

    // Start the debate
    const handleStart = useCallback(async () => {
        if (!topic.trim() || selectedParticipants.length < 2) {
            return;
        }

        await orchestratorRef.current?.dispatch({
            type: 'START',
            topic,
            participants: selectedParticipants,
            config: bounceConfig,
        });
    }, [topic, selectedParticipants, bounceConfig]);

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
            });
        }
    }, [selectedParticipants, addSelectedParticipant, removeSelectedParticipant]);

    const isActive = bounceState.status !== 'idle' && bounceState.status !== 'complete' && bounceState.status !== 'error';
    const canStart = topic.trim().length > 0 && selectedParticipants.length >= 2 && !isActive;

    return (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 bg-gradient-to-r from-purple-500 to-indigo-600 text-white">
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
                <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Debate Topic
                    </label>
                    <textarea
                        value={topic}
                        onChange={(e) => setTopic(e.target.value)}
                        placeholder="Enter the topic or question to debate..."
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                        rows={3}
                    />
                </div>
            )}

            {/* Participant Selection */}
            {!isActive && (
                <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <Users className="w-4 h-4 text-gray-500" />
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                Participants ({selectedParticipants.length})
                            </span>
                        </div>
                        {selectedParticipants.length > 0 && (
                            <button
                                onClick={clearSelectedParticipants}
                                className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
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
                                            ? 'bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 ring-2 ring-purple-500'
                                            : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                                        }
                                    `}
                                >
                                    {isSelected && <Check className="w-3 h-3 inline mr-1" />}
                                    {session.title}
                                </button>
                            );
                        })}
                    </div>

                    {sessions.length === 0 && (
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            No active sessions. Add some models to start a debate.
                        </p>
                    )}

                    {selectedParticipants.length < 2 && sessions.length >= 2 && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                            Select at least 2 participants to start
                        </p>
                    )}
                </div>
            )}

            {/* Configuration */}
            {!isActive && (
                <div className="border-b border-gray-200 dark:border-gray-700">
                    <button
                        onClick={() => setShowConfig(!showConfig)}
                        className="w-full px-4 py-2 flex items-center justify-between text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800"
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
                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                                    Debate Mode
                                </label>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setBounceConfig({ mode: 'sequential' })}
                                        className={`flex-1 px-3 py-2 rounded-lg text-sm ${
                                            bounceConfig.mode === 'sequential'
                                                ? 'bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300'
                                                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                                        }`}
                                    >
                                        Sequential
                                    </button>
                                    <button
                                        onClick={() => setBounceConfig({ mode: 'parallel' })}
                                        className={`flex-1 px-3 py-2 rounded-lg text-sm ${
                                            bounceConfig.mode === 'parallel'
                                                ? 'bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300'
                                                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                                        }`}
                                    >
                                        Parallel
                                    </button>
                                </div>
                            </div>

                            {/* Max Rounds */}
                            <div>
                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
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
                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
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

                            {/* User Interjection */}
                            <div className="flex items-center justify-between">
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                    Allow interjections
                                </span>
                                <button
                                    onClick={() => setBounceConfig({ allowUserInterjection: !bounceConfig.allowUserInterjection })}
                                    className={`w-10 h-6 rounded-full transition-colors ${
                                        bounceConfig.allowUserInterjection
                                            ? 'bg-purple-500'
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
                                    <span className="text-xs text-gray-500 dark:text-gray-400">
                                        Prune aligned models
                                    </span>
                                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                                        Drop redundant participants between rounds
                                    </p>
                                </div>
                                <button
                                    onClick={() => setBounceConfig({ enablePruning: !bounceConfig.enablePruning })}
                                    className={`w-10 h-6 rounded-full transition-colors ${
                                        bounceConfig.enablePruning
                                            ? 'bg-purple-500'
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
                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
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
                                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                                    Older responses are trimmed when context exceeds budget
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* User Interjection Input */}
            {bounceState.status === 'waiting_user' && (
                <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800">
                    <div className="flex items-center gap-2 mb-2">
                        <MessageSquare className="w-4 h-4 text-amber-600" />
                        <span className="text-sm font-medium text-amber-700 dark:text-amber-300">
                            Your turn to interject
                        </span>
                    </div>
                    <textarea
                        value={userInterjection}
                        onChange={(e) => setUserInterjection(e.target.value)}
                        placeholder="Add context, redirect the discussion, or ask a clarifying question..."
                        className="w-full px-3 py-2 border border-amber-300 dark:border-amber-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:ring-2 focus:ring-amber-500 focus:border-transparent resize-none mb-2"
                        rows={2}
                    />
                    <div className="flex gap-2">
                        <button
                            onClick={handleInterjection}
                            disabled={!userInterjection.trim()}
                            className="flex-1 px-3 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white rounded-lg text-sm font-medium transition-colors"
                        >
                            Submit
                        </button>
                        <button
                            onClick={handleContinue}
                            className="px-3 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium transition-colors"
                        >
                            Skip
                        </button>
                    </div>
                </div>
            )}

            {/* Progress */}
            {isActive && bounceState.consensus && (
                <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-gray-600 dark:text-gray-400">
                            Round {bounceState.currentRound} of {bounceConfig.maxRounds}
                        </span>
                        <span className="text-sm font-medium">
                            Consensus: {Math.round(bounceState.consensus.score * 100)}%
                        </span>
                    </div>
                    <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
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
                </div>
            )}

            {/* Controls */}
            <div className="p-4 flex gap-2">
                {!isActive ? (
                    <button
                        onClick={handleStart}
                        disabled={!canStart}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 dark:disabled:bg-purple-800 text-white rounded-lg font-medium transition-colors"
                    >
                        <Play className="w-4 h-4" />
                        Start Debate
                    </button>
                ) : (
                    <>
                        <button
                            onClick={handlePauseResume}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg font-medium transition-colors"
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
                            className="flex items-center justify-center gap-2 px-4 py-2 bg-indigo-100 dark:bg-indigo-900/50 hover:bg-indigo-200 dark:hover:bg-indigo-900 text-indigo-700 dark:text-indigo-300 rounded-lg font-medium transition-colors"
                        >
                            <SkipForward className="w-4 h-4" />
                            Judge Now
                        </button>
                        <button
                            onClick={handleStop}
                            className="flex items-center justify-center gap-2 px-4 py-2 bg-red-100 dark:bg-red-900/50 hover:bg-red-200 dark:hover:bg-red-900 text-red-700 dark:text-red-300 rounded-lg font-medium transition-colors"
                        >
                            <Square className="w-4 h-4" />
                        </button>
                    </>
                )}
            </div>

            {/* Error Display */}
            {bounceState.status === 'error' && bounceState.error && (
                <div className="mx-4 mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
                        <X className="w-4 h-4" />
                        <span className="text-sm">{bounceState.error}</span>
                    </div>
                </div>
            )}
        </div>
    );
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
