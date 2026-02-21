'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Message } from 'ai';

// Components
import { Canvas, DraggablePanel } from '@/components/Canvas';
import { ChatPanel, ChatPanelRef } from '@/components/ChatPanel';
import { CommandPalette } from '@/components/CommandPalette';
import { ConsensusIndicator } from '@/components/ConsensusIndicator';
import { SmartInput } from '@/components/SmartInput';
import { UsageMeter, useTokenTracking } from '@/components/UsageMeter';
import { ResizablePanels } from '@/components/ResizablePanels';
import { TerminalDock, useTerminalDock } from '@/components/TerminalDock';
import { SettingsModal } from '@/components/SettingsModal';
import { BounceController } from '@/components/BounceController';
import { BouncePanel } from '@/components/BouncePanel';

// Data & State
import { MODELS } from '@/lib/models';
import { PERSONAS, Persona } from '@/lib/personas';
import { WORKFLOWS, Workflow } from '@/lib/workflows';
import { useAgentStore } from '@/lib/store';
import { Session } from '@/lib/types';

type ViewMode = 'grid' | 'freeform' | 'resizable';

export default function Page() {
    // UI State
    const [isCommandOpen, setCommandOpen] = useState(false);
    const [isSettingsOpen, setSettingsOpen] = useState(false);
    const [viewMode, setViewMode] = useState<ViewMode>('grid');
    const [isBounceOpen, setBounceOpen] = useState(false);
    const [bounceTopic, setBounceTopic] = useState<string | null>(null);

    // Terminal dock
    const terminal = useTerminalDock();

    // Token tracking
    const { usage: tokenUsage, trackUsage, clearUsage } = useTokenTracking();

    // Chat panel refs for broadcasting messages
    const panelRefs = useRef<Map<string, ChatPanelRef>>(new Map());

    // Track messages per session for consensus
    const [sessionMessages, setSessionMessages] = useState<Map<string, Message[]>>(new Map());
    const [loadingSessionIds, setLoadingSessionIds] = useState<Set<string>>(new Set());

    // Zustand store
    const sessions = useAgentStore((state) => state.sessions);
    const workflow = useAgentStore((state) => state.workflow);
    const addSession = useAgentStore((state) => state.addSession);
    const removeSession = useAgentStore((state) => state.removeSession);
    const clearSessions = useAgentStore((state) => state.clearSessions);

    const allWorkflows = [...WORKFLOWS, ...workflow.customWorkflows];

    // Global keyboard shortcut for command palette
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                setCommandOpen(prev => !prev);
            }
            // Toggle terminal with Ctrl+`
            if ((e.metaKey || e.ctrlKey) && e.key === '`') {
                e.preventDefault();
                terminal.toggle();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [terminal]);

    // Register panel ref
    const registerPanelRef = useCallback((id: string, ref: ChatPanelRef | null) => {
        if (ref) {
            panelRefs.current.set(id, ref);
        } else {
            panelRefs.current.delete(id);
        }
    }, []);

    // Broadcast message to all panels
    const broadcastMessage = useCallback((content: string) => {
        panelRefs.current.forEach((ref) => {
            ref.sendMessage(content);
        });
    }, []);

    // Keep global loading state in sync with panel loading updates.
    const handleLoadingChange = useCallback((sessionId: string, isLoading: boolean) => {
        setLoadingSessionIds((prev) => {
            const next = new Set(prev);
            if (isLoading) {
                next.add(sessionId);
            } else {
                next.delete(sessionId);
            }
            return next;
        });
    }, []);

    // Handle message updates from panels
    const handleMessagesUpdate = useCallback((sessionId: string, messages: Message[]) => {
        setSessionMessages(prev => {
            const next = new Map(prev);
            next.set(sessionId, messages);
            return next;
        });
    }, []);

    // Model selection
    const handleSelectModel = useCallback((modelId: string) => {
        const exists = sessions.find(s => s.modelId === modelId && !s.isPersona);
        if (exists) {
            removeSession(exists.id);
            clearUsage(exists.id);
        } else {
            const model = MODELS.find(m => m.id === modelId);
            addSession({
                id: `${modelId}-${Date.now()}`,
                modelId,
                title: model?.name || modelId,
                isPersona: false,
                config: { modelId }
            });
        }
    }, [sessions, addSession, removeSession, clearUsage]);

    // Persona selection
    const handleSelectPersona = useCallback((personaId: string) => {
        const persona = PERSONAS.find(p => p.id === personaId);
        if (!persona) return;

        addSession({
            id: `persona-${persona.id}-${Date.now()}`,
            modelId: persona.modelId,
            title: persona.name,
            isPersona: true,
            systemPrompt: persona.systemPrompt
        });
    }, [addSession]);

    // Workflow selection
    const handleSelectWorkflow = useCallback((workflowId: string) => {
        const wf = allWorkflows.find(w => w.id === workflowId);
        if (!wf) return;

        clearSessions();

        const firstStep = wf.steps[0];
        const persona = PERSONAS.find(p => p.id === firstStep.personaId);
        if (!persona) return;

        addSession({
            id: `wf-${wf.id}-step-0-${Date.now()}`,
            modelId: persona.modelId,
            title: `[Step 1] ${persona.name}`,
            isPersona: true,
            systemPrompt: `${persona.systemPrompt}\n\n[WORKFLOW]: ${firstStep.instruction}`
        });
    }, [allWorkflows, clearSessions, addSession]);

    // Synthesize (create judge)
    const handleSynthesize = useCallback(() => {
        if (sessions.length < 2) return;

        // Gather all responses
        let transcript = "Multi-model transcript:\n\n";
        sessions.forEach(s => {
            const msgs = sessionMessages.get(s.id) || [];
            const lastAssistant = [...msgs].reverse().find(m => m.role === 'assistant');
            if (lastAssistant) {
                transcript += `[${s.title}]:\n${lastAssistant.content.slice(0, 2000)}\n\n---\n\n`;
            }
        });

        const judgeModel = MODELS[0];
        addSession({
            id: `judge-${Date.now()}`,
            modelId: judgeModel.id,
            title: `⚖️ Synthesis`,
            isPersona: true,
            systemPrompt: `You are synthesizing multiple AI responses. Review, compare, and provide a unified answer.\n\n${transcript}`
        });
    }, [sessions, sessionMessages, addSession]);

    // Start a bounce/debate from a specific response
    const handleBounce = useCallback((content: string) => {
        setBounceTopic(content);
        setBounceOpen(true);
    }, []);

    // Handle bounce completion
    const handleBounceComplete = useCallback((finalAnswer: string) => {
        // Optionally add the final answer as a new synthesis session
        const judgeModel = MODELS[0];
        addSession({
            id: `bounce-result-${Date.now()}`,
            modelId: judgeModel.id,
            title: `🔀 Debate Result`,
            isPersona: true,
            systemPrompt: `This is the synthesized result from a multi-model debate:\n\n${finalAnswer}`
        });
        setBounceOpen(false);
        setBounceTopic(null);
    }, [addSession]);

    // Close bounce panel
    const handleBounceCancel = useCallback(() => {
        setBounceOpen(false);
        setBounceTopic(null);
    }, []);

    // Clear all
    const handleClearAll = useCallback(() => {
        clearSessions();
        clearUsage();
    }, [clearSessions, clearUsage]);

    // Calculate grid positions for freeform panels
    const getGridPosition = (index: number, total: number): { x: number; y: number } => {
        const cols = total <= 2 ? total : total <= 4 ? 2 : 3;
        const panelWidth = 380;
        const panelHeight = 450;
        const gap = 20;

        const col = index % cols;
        const row = Math.floor(index / cols);

        const totalWidth = cols * panelWidth + (cols - 1) * gap;
        const startX = (window.innerWidth - totalWidth) / 2;

        return {
            x: startX + col * (panelWidth + gap),
            y: 80 + row * (panelHeight + gap),
        };
    };

    // Prepare consensus data
    const consensusSessions = sessions.map(s => ({
        id: s.id,
        title: s.title,
        messages: sessionMessages.get(s.id) || [],
    }));

    return (
        <div className={`h-screen bg-gray-50 dark:bg-gray-950 flex flex-col overflow-hidden ${terminal.isOpen ? 'pb-[200px]' : 'pb-8'}`}>
            {/* Clean minimal header */}
            <header className="flex items-center justify-between px-6 py-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                <div className="flex items-center gap-4">
                    <h1 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                        Agent Conductor
                    </h1>

                    {/* View mode toggle */}
                    <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
                        {(['grid', 'resizable', 'freeform'] as ViewMode[]).map((mode) => (
                            <button
                                key={mode}
                                onClick={() => setViewMode(mode)}
                                className={`px-3 py-1 text-xs rounded-md transition-colors capitalize ${
                                    viewMode === mode
                                        ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                                        : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                                }`}
                            >
                                {mode}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {/* Usage meter */}
                    {sessions.length > 0 && (
                        <UsageMeter
                            sessions={sessions.map(s => ({ id: s.id, modelId: s.modelId, title: s.title }))}
                            tokenUsage={tokenUsage}
                        />
                    )}

                    {/* Active models count */}
                    {sessions.length > 0 && (
                        <span className="text-xs text-gray-400">
                            {sessions.length} active
                        </span>
                    )}

                    {/* Command palette trigger */}
                    <button
                        onClick={() => setCommandOpen(true)}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-500 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <kbd className="hidden sm:inline px-1.5 py-0.5 text-xs bg-gray-200 dark:bg-gray-700 rounded">⌘K</kbd>
                    </button>

                    {/* Terminal toggle */}
                    <button
                        onClick={terminal.toggle}
                        className={`p-2 rounded-lg transition-colors ${
                            terminal.isOpen
                                ? 'bg-gray-800 text-gray-200'
                                : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
                        }`}
                        title="Toggle Terminal (⌘`)"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                    </button>

                    {/* Settings */}
                    <button
                        onClick={() => setSettingsOpen(true)}
                        className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                    </button>
                </div>
            </header>

            {/* Main content area */}
            <div className="flex-1 relative overflow-hidden">
                {sessions.length === 0 ? (
                    /* Empty state */
                    <div className="h-full flex flex-col items-center justify-center text-gray-400">
                        <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
                            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                            </svg>
                        </div>
                        <p className="text-lg font-medium text-gray-600 dark:text-gray-300 mb-2">
                            No models active
                        </p>
                        <p className="text-sm mb-4 text-center max-w-sm">
                            Type <kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-xs">@</kbd> to add models,{' '}
                            <kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-xs">$</kbd> for personas,{' '}
                            <kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-xs">/</kbd> for commands
                        </p>
                        <button
                            onClick={() => setCommandOpen(true)}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                        >
                            Get Started
                        </button>
                    </div>
                ) : viewMode === 'grid' ? (
                    /* Grid view */
                    <div className="h-full overflow-auto p-6">
                        {/* Consensus indicator */}
                        {sessions.length >= 2 && (
                            <div className="max-w-2xl mx-auto mb-4">
                                <ConsensusIndicator sessions={consensusSessions} />
                            </div>
                        )}

                        {/* Grid of panels */}
                        <div className={`
                            grid gap-4 justify-center
                            ${sessions.length === 1 ? 'grid-cols-1 max-w-md mx-auto' : ''}
                            ${sessions.length === 2 ? 'grid-cols-2 max-w-3xl mx-auto' : ''}
                            ${sessions.length >= 3 ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 max-w-6xl mx-auto' : ''}
                        `}>
                            {sessions.map(session => (
                                <div key={session.id} className="min-w-[320px]">
                                    <ChatPanel
                                        ref={(ref) => registerPanelRef(session.id, ref)}
                                        session={session}
                                        onClose={() => {
                                            removeSession(session.id);
                                            clearUsage(session.id);
                                        }}
                                        onMessagesUpdate={(msgs) => handleMessagesUpdate(session.id, msgs)}
                                        onLoadingChange={handleLoadingChange}
                                        onBounce={handleBounce}
                                        compact={sessions.length > 2}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                ) : viewMode === 'resizable' ? (
                    /* Resizable panels view */
                    <div className="h-full p-4">
                        <ResizablePanels
                            direction="horizontal"
                            storageKey="main-panels"
                            panelConfigs={sessions.map(s => ({ id: s.id, minSize: 300 }))}
                        >
                            {sessions.map(session => (
                                <div key={session.id} className="h-full p-2">
                                    <ChatPanel
                                        ref={(ref) => registerPanelRef(session.id, ref)}
                                        session={session}
                                        onClose={() => {
                                            removeSession(session.id);
                                            clearUsage(session.id);
                                        }}
                                        onMessagesUpdate={(msgs) => handleMessagesUpdate(session.id, msgs)}
                                        onLoadingChange={handleLoadingChange}
                                        onBounce={handleBounce}
                                    />
                                </div>
                            ))}
                        </ResizablePanels>
                    </div>
                ) : (
                    /* Freeform canvas view */
                    <Canvas>
                        {sessions.map((session, index) => {
                            const pos = getGridPosition(index, sessions.length);
                            return (
                                <DraggablePanel
                                    key={session.id}
                                    id={session.id}
                                    initialPosition={pos}
                                    dragHandle=".drag-handle"
                                >
                                    <div className="w-[360px] shadow-xl rounded-lg overflow-hidden">
                                        {/* Drag handle */}
                                        <div className="drag-handle h-6 bg-gray-100 dark:bg-gray-800 cursor-grab active:cursor-grabbing flex items-center justify-center">
                                            <div className="w-8 h-1 bg-gray-300 dark:bg-gray-600 rounded-full" />
                                        </div>
                                        <ChatPanel
                                            ref={(ref) => registerPanelRef(session.id, ref)}
                                            session={session}
                                            onClose={() => {
                                                removeSession(session.id);
                                                clearUsage(session.id);
                                            }}
                                            onMessagesUpdate={(msgs) => handleMessagesUpdate(session.id, msgs)}
                                            onLoadingChange={handleLoadingChange}
                                            onBounce={handleBounce}
                                            compact
                                        />
                                    </div>
                                </DraggablePanel>
                            );
                        })}
                    </Canvas>
                )}
            </div>

            {/* Bottom smart input */}
            <div className="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
                <div className="max-w-3xl mx-auto">
                    <SmartInput
                        onSubmit={broadcastMessage}
                        onSelectModel={handleSelectModel}
                        onSelectPersona={handleSelectPersona}
                        onSelectWorkflow={handleSelectWorkflow}
                        onSynthesize={handleSynthesize}
                        onClearAll={handleClearAll}
                        isLoading={loadingSessionIds.size > 0}
                        sessionCount={sessions.length}
                    />
                </div>
            </div>

            {/* Terminal Dock */}
            <TerminalDock
                isOpen={terminal.isOpen}
                onClose={terminal.close}
                onToggle={terminal.toggle}
            />

            {/* Command Palette */}
            <CommandPalette
                isOpen={isCommandOpen}
                onClose={() => setCommandOpen(false)}
                onSelectModel={handleSelectModel}
                onSelectPersona={(persona) => handleSelectPersona(persona.id)}
                onSelectWorkflow={handleSelectWorkflow}
                onSynthesize={handleSynthesize}
                onClearAll={handleClearAll}
                customWorkflows={workflow.customWorkflows}
            />

            {/* Settings Modal */}
            <SettingsModal
                isOpen={isSettingsOpen}
                onClose={() => setSettingsOpen(false)}
            />

            {/* Bounce/Debate Overlay */}
            {isBounceOpen && (
                <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4 bg-black/50 backdrop-blur-sm overflow-y-auto">
                    <div className="w-full max-w-4xl mb-8 grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* Controller */}
                        <div className="lg:col-span-1">
                            <BounceController
                                initialTopic={bounceTopic || ''}
                                onComplete={handleBounceComplete}
                                onCancel={handleBounceCancel}
                            />
                        </div>

                        {/* Debate Progress Panel */}
                        <div className="lg:col-span-1">
                            <BouncePanel maxHeight="600px" />
                        </div>
                    </div>

                    {/* Close button */}
                    <button
                        onClick={handleBounceCancel}
                        className="fixed top-4 right-4 p-2 bg-white dark:bg-gray-800 rounded-full shadow-lg text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            )}
        </div>
    );
}
