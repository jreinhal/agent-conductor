'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MODELS } from '@/lib/models';

interface ModelDialoguePanelProps {
    isOpen: boolean;
    onClose: () => void;
}

interface DialogueTurn {
    speaker: 'Codex' | 'Claude';
    cycle: number;
    durationMs: number;
    text: string;
}

type StreamEvent =
    | { type: 'status'; phase: string; message: string }
    | { type: 'turn_start'; speaker: 'Codex' | 'Claude'; cycle: number }
    | { type: 'turn_complete'; speaker: 'Codex' | 'Claude'; cycle: number; durationMs: number; text: string }
    | { type: 'final_complete'; durationMs: number; text: string }
    | { type: 'observation'; value: string }
    | { type: 'done'; totalDurationMs: number; transcriptPath: string; turns: number; observations: string[] }
    | { type: 'error'; message: string }
    | { type: 'end' };

function formatDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return '0ms';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

export function ModelDialoguePanel({ isOpen, onClose }: ModelDialoguePanelProps) {
    const [topic, setTopic] = useState(
        'Best way to move forward with Agent Conductor from current state to a market-ready desktop launch'
    );
    const [cycles, setCycles] = useState(1);
    const [codexModel, setCodexModel] = useState('gpt-5.3-codex');
    const [claudeModel, setClaudeModel] = useState('claude-opus-4.6');
    const [includeFinal, setIncludeFinal] = useState(true);
    const [runPreflight, setRunPreflight] = useState(true);
    const [isRunning, setIsRunning] = useState(false);
    const [status, setStatus] = useState<string>('Idle');
    const [turns, setTurns] = useState<DialogueTurn[]>([]);
    const [observations, setObservations] = useState<string[]>([]);
    const [finalSynthesis, setFinalSynthesis] = useState('');
    const [finalDurationMs, setFinalDurationMs] = useState<number | null>(null);
    const [totalDurationMs, setTotalDurationMs] = useState<number | null>(null);
    const [transcriptPath, setTranscriptPath] = useState('');
    const [error, setError] = useState('');
    const [activeTurn, setActiveTurn] = useState<{ speaker: 'Codex' | 'Claude'; cycle: number } | null>(null);

    const abortRef = useRef<AbortController | null>(null);

    const codexOptions = useMemo(
        () => MODELS.filter((model) => model.id.includes('gpt') || model.id.includes('codex')),
        []
    );
    const claudeOptions = useMemo(
        () => MODELS.filter((model) => model.id.includes('claude')),
        []
    );

    const resetRunState = useCallback(() => {
        setTurns([]);
        setObservations([]);
        setFinalSynthesis('');
        setFinalDurationMs(null);
        setTotalDurationMs(null);
        setTranscriptPath('');
        setError('');
        setActiveTurn(null);
        setStatus('Idle');
    }, []);

    useEffect(() => {
        if (!isOpen && abortRef.current) {
            abortRef.current.abort();
            abortRef.current = null;
            setIsRunning(false);
        }
    }, [isOpen]);

    const stopRun = useCallback(() => {
        if (!abortRef.current) return;
        abortRef.current.abort();
        abortRef.current = null;
        setIsRunning(false);
        setStatus('Stopped');
        setActiveTurn(null);
    }, []);

    const handleStreamEvent = useCallback((event: StreamEvent) => {
        if (event.type === 'status') {
            setStatus(event.message);
            return;
        }
        if (event.type === 'turn_start') {
            setActiveTurn({ speaker: event.speaker, cycle: event.cycle });
            return;
        }
        if (event.type === 'turn_complete') {
            setTurns((prev) => [
                ...prev,
                {
                    speaker: event.speaker,
                    cycle: event.cycle,
                    durationMs: event.durationMs,
                    text: event.text,
                },
            ]);
            setActiveTurn(null);
            return;
        }
        if (event.type === 'final_complete') {
            setFinalSynthesis(event.text);
            setFinalDurationMs(event.durationMs);
            return;
        }
        if (event.type === 'observation') {
            setObservations((prev) =>
                prev.includes(event.value) ? prev : [...prev, event.value]
            );
            return;
        }
        if (event.type === 'done') {
            setTotalDurationMs(event.totalDurationMs);
            setTranscriptPath(event.transcriptPath);
            setStatus('Complete');
            if (Array.isArray(event.observations) && event.observations.length > 0) {
                setObservations(event.observations);
            }
            return;
        }
        if (event.type === 'error') {
            setError(event.message);
            setStatus('Failed');
            return;
        }
        if (event.type === 'end') {
            setActiveTurn(null);
        }
    }, []);

    const runDialogue = useCallback(async () => {
        if (isRunning) return;
        if (!topic.trim()) {
            setError('Topic is required.');
            return;
        }

        resetRunState();
        setIsRunning(true);
        setStatus('Starting dialogue...');
        const abortController = new AbortController();
        abortRef.current = abortController;

        try {
            const response = await fetch('/api/model-dialogue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    topic: topic.trim(),
                    cycles,
                    codexModel,
                    claudeModel,
                    includeFinal,
                    runPreflight,
                }),
                signal: abortController.signal,
            });

            if (!response.ok) {
                const payload = (await response.json()) as { error?: string };
                throw new Error(payload.error || 'Failed to start dialogue.');
            }
            if (!response.body) {
                throw new Error('No dialogue stream returned.');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                let separatorIndex = buffer.indexOf('\n\n');
                while (separatorIndex !== -1) {
                    const block = buffer.slice(0, separatorIndex);
                    buffer = buffer.slice(separatorIndex + 2);

                    const dataLines = block
                        .split('\n')
                        .filter((line) => line.startsWith('data:'))
                        .map((line) => line.slice(5).trim());
                    const payload = dataLines.join('\n').trim();
                    if (!payload) {
                        separatorIndex = buffer.indexOf('\n\n');
                        continue;
                    }

                    try {
                        const event = JSON.parse(payload) as StreamEvent;
                        handleStreamEvent(event);
                    } catch {
                        // Ignore malformed chunks.
                    }

                    separatorIndex = buffer.indexOf('\n\n');
                }
            }
        } catch (runError) {
            if ((runError as Error).name === 'AbortError') {
                setStatus('Stopped');
            } else {
                const message = runError instanceof Error ? runError.message : String(runError);
                setError(message || 'Dialogue failed.');
                setStatus('Failed');
            }
        } finally {
            setIsRunning(false);
            abortRef.current = null;
        }
    }, [
        claudeModel,
        codexModel,
        cycles,
        handleStreamEvent,
        includeFinal,
        isRunning,
        resetRunState,
        runPreflight,
        topic,
    ]);

    if (!isOpen) return null;

    return (
        <div className="ac-overlay fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
            <div
                className="ac-modal-shell w-full max-w-6xl h-[86vh] rounded-2xl overflow-hidden flex flex-col"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="px-5 py-3 border-b border-[color:var(--ac-border-soft)] flex items-center justify-between">
                    <div>
                        <h2 className="text-base font-semibold text-[color:var(--ac-text)]">Model Dialogue Runner</h2>
                        <p className="text-xs text-[color:var(--ac-text-dim)] mt-0.5">
                            Live Codex + Claude strategy loop with retrospective signal capture
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={runDialogue}
                            disabled={isRunning}
                            className="ac-btn-primary px-3 py-1.5 text-xs rounded-lg disabled:opacity-60"
                        >
                            {isRunning ? 'Running...' : 'Run Dialogue'}
                        </button>
                        <button
                            onClick={stopRun}
                            disabled={!isRunning}
                            className="control-chip px-3 py-1.5 text-xs disabled:opacity-50"
                        >
                            Stop
                        </button>
                        <button onClick={onClose} className="control-chip p-1.5" aria-label="Close">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>

                <div className="px-5 py-3 border-b border-[color:var(--ac-border-soft)] grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <div>
                        <label className="block text-xs text-[color:var(--ac-text-muted)] mb-1">Topic</label>
                        <textarea
                            value={topic}
                            onChange={(event) => setTopic(event.target.value)}
                            rows={3}
                            className="ac-input px-3 py-2 text-sm resize-y"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-2 content-start">
                        <label className="text-xs text-[color:var(--ac-text-muted)]">
                            Cycles
                            <select
                                value={String(cycles)}
                                onChange={(event) => setCycles(Math.max(1, Math.min(3, Number.parseInt(event.target.value, 10) || 1)))}
                                className="ac-input mt-1 px-2 py-1.5 text-xs"
                                disabled={isRunning}
                            >
                                <option value="1">1</option>
                                <option value="2">2</option>
                                <option value="3">3</option>
                            </select>
                        </label>
                        <label className="text-xs text-[color:var(--ac-text-muted)]">
                            Final Synthesis
                            <select
                                value={includeFinal ? 'yes' : 'no'}
                                onChange={(event) => setIncludeFinal(event.target.value === 'yes')}
                                className="ac-input mt-1 px-2 py-1.5 text-xs"
                                disabled={isRunning}
                            >
                                <option value="yes">Yes</option>
                                <option value="no">No</option>
                            </select>
                        </label>
                        <label className="text-xs text-[color:var(--ac-text-muted)]">
                            Codex Model
                            <select
                                value={codexModel}
                                onChange={(event) => setCodexModel(event.target.value)}
                                className="ac-input mt-1 px-2 py-1.5 text-xs"
                                disabled={isRunning}
                            >
                                {codexOptions.map((model) => (
                                    <option key={model.id} value={model.id}>{model.name}</option>
                                ))}
                            </select>
                        </label>
                        <label className="text-xs text-[color:var(--ac-text-muted)]">
                            Claude Model
                            <select
                                value={claudeModel}
                                onChange={(event) => setClaudeModel(event.target.value)}
                                className="ac-input mt-1 px-2 py-1.5 text-xs"
                                disabled={isRunning}
                            >
                                {claudeOptions.map((model) => (
                                    <option key={model.id} value={model.id}>{model.name}</option>
                                ))}
                            </select>
                        </label>
                        <label className="text-xs text-[color:var(--ac-text-muted)] col-span-2">
                            Preflight
                            <select
                                value={runPreflight ? 'yes' : 'no'}
                                onChange={(event) => setRunPreflight(event.target.value === 'yes')}
                                className="ac-input mt-1 px-2 py-1.5 text-xs"
                                disabled={isRunning}
                            >
                                <option value="yes">Run smoke checks</option>
                                <option value="no">Skip smoke checks</option>
                            </select>
                        </label>
                    </div>
                </div>

                <div className="px-5 py-2 border-b border-[color:var(--ac-border-soft)] text-xs flex flex-wrap items-center gap-3">
                    <span className="ac-badge px-2 py-1 rounded">status: {status}</span>
                    {activeTurn && (
                        <span className="ac-badge px-2 py-1 rounded">
                            active: {activeTurn.speaker} (cycle {activeTurn.cycle})
                        </span>
                    )}
                    {totalDurationMs !== null && (
                        <span className="ac-badge px-2 py-1 rounded">
                            total: {formatDuration(totalDurationMs)}
                        </span>
                    )}
                    {transcriptPath && (
                        <span className="ac-badge px-2 py-1 rounded truncate max-w-[50ch]" title={transcriptPath}>
                            transcript: {transcriptPath}
                        </span>
                    )}
                    {error && (
                        <span className="text-[color:var(--ac-danger)]">{error}</span>
                    )}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,0.55fr)] flex-1 min-h-0">
                    <div className="p-4 space-y-3 overflow-y-auto border-r border-[color:var(--ac-border-soft)]">
                        {turns.length === 0 && !isRunning && !error && (
                            <div className="text-sm text-[color:var(--ac-text-muted)]">
                                No turns yet. Configure and click Run Dialogue.
                            </div>
                        )}

                        {turns.map((turn, idx) => (
                            <div key={`${turn.speaker}-${turn.cycle}-${idx}`} className="rounded-xl border border-[color:var(--ac-border-soft)] bg-[color:var(--ac-surface)] p-3">
                                <div className="flex items-center justify-between gap-2 text-xs mb-2">
                                    <span className="font-medium text-[color:var(--ac-text)]">
                                        {turn.speaker} · cycle {turn.cycle}
                                    </span>
                                    <span className="text-[color:var(--ac-text-muted)]">{formatDuration(turn.durationMs)}</span>
                                </div>
                                <div className="text-sm text-[color:var(--ac-text-dim)] whitespace-pre-wrap leading-relaxed">
                                    {turn.text}
                                </div>
                            </div>
                        ))}

                        {finalSynthesis && (
                            <div className="rounded-xl border border-[color:var(--ac-border-soft)] bg-[color:var(--ac-surface)] p-3">
                                <div className="flex items-center justify-between gap-2 text-xs mb-2">
                                    <span className="font-medium text-[color:var(--ac-text)]">Final Synthesis</span>
                                    <span className="text-[color:var(--ac-text-muted)]">
                                        {finalDurationMs !== null ? formatDuration(finalDurationMs) : '-'}
                                    </span>
                                </div>
                                <div className="text-sm text-[color:var(--ac-text-dim)] whitespace-pre-wrap leading-relaxed">
                                    {finalSynthesis}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="p-4 space-y-3 overflow-y-auto">
                        <div className="rounded-xl border border-[color:var(--ac-border-soft)] bg-[color:var(--ac-surface)] p-3">
                            <h3 className="text-xs uppercase tracking-[0.12em] text-[color:var(--ac-text-muted)] mb-2">
                                Retrospective
                            </h3>
                            {observations.length === 0 ? (
                                <p className="text-sm text-[color:var(--ac-text-muted)]">
                                    Timing and execution notes will appear here while the run progresses.
                                </p>
                            ) : (
                                <ul className="space-y-2">
                                    {observations.map((note, index) => (
                                        <li key={`${note}-${index}`} className="text-sm text-[color:var(--ac-text-dim)]">
                                            {note}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>

                        <div className="rounded-xl border border-[color:var(--ac-border-soft)] bg-[color:var(--ac-surface)] p-3">
                            <h3 className="text-xs uppercase tracking-[0.12em] text-[color:var(--ac-text-muted)] mb-2">
                                Usage
                            </h3>
                            <p className="text-xs text-[color:var(--ac-text-muted)] leading-relaxed">
                                This runner executes local CLI models directly and writes a markdown transcript under{' '}
                                <code>output/dialogues</code>.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
