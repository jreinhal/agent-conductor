import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Session } from './types';
import { Workflow } from './workflows';
import { Message } from 'ai';
import {
    BounceState,
    BounceConfig,
    BounceRound,
    BounceEvent,
    ParticipantConfig,
    INITIAL_BOUNCE_STATE,
    DEFAULT_BOUNCE_CONFIG,
    ConsensusAnalysis,
    SerializedBounceSession,
} from './bounce-types';

// Extended session with messages
export interface SessionWithMessages extends Session {
    messages: Message[];
}

// Workflow state
interface WorkflowState {
    activeWorkflowId: string | null;
    stepIndex: number;
    customWorkflows: Workflow[];
}

// UI state
interface UIState {
    isSidebarOpen: boolean;
    isEvalMode: boolean;
    isJudging: boolean;
    isBuilderOpen: boolean;
    bounceState: {
        isOpen: boolean;
        content: string | null;
    };
    bounceConfigOpen: boolean;
}

// Debate/Bounce state
interface DebateState {
    /** Current bounce orchestration state */
    bounce: BounceState;

    /** History of completed bounce sessions */
    bounceHistory: SerializedBounceSession[];

    /** Selected participants for next bounce */
    selectedParticipants: ParticipantConfig[];

    /** Current bounce configuration */
    bounceConfig: BounceConfig;
}

// Main store state
interface AgentConductorState {
    // Sessions
    sessions: SessionWithMessages[];

    // Shared context
    sharedContext: string;

    // Workflow
    workflow: WorkflowState;

    // UI
    ui: UIState;

    // Debate
    debate: DebateState;

    // Session actions
    addSession: (session: Session) => void;
    removeSession: (sessionId: string) => void;
    clearSessions: () => void;
    updateSessionMessages: (sessionId: string, messages: Message[]) => void;

    // Context actions
    setSharedContext: (context: string) => void;

    // Workflow actions
    setActiveWorkflow: (workflowId: string | null) => void;
    setWorkflowStep: (index: number) => void;
    addCustomWorkflow: (workflow: Workflow) => void;
    removeCustomWorkflow: (workflowId: string) => void;

    // UI actions
    toggleSidebar: () => void;
    setEvalMode: (isEvalMode: boolean) => void;
    setJudging: (isJudging: boolean) => void;
    setBuilderOpen: (isOpen: boolean) => void;
    setBounceState: (state: { isOpen: boolean; content: string | null }) => void;
    setBounceConfigOpen: (isOpen: boolean) => void;

    // Debate actions
    updateBounceState: (bounce: Partial<BounceState>) => void;
    setBounceConfig: (config: Partial<BounceConfig>) => void;
    addSelectedParticipant: (participant: ParticipantConfig) => void;
    removeSelectedParticipant: (sessionId: string) => void;
    clearSelectedParticipants: () => void;
    addBounceToHistory: (session: SerializedBounceSession) => void;
    clearBounceHistory: () => void;
    resetBounce: () => void;

    // Computed helpers
    getSessionContent: (sessionId: string) => string;
    getAllSessionsContent: () => Record<string, string>;
    getParticipantsFromSessions: () => ParticipantConfig[];
}

export const useAgentStore = create<AgentConductorState>()(
    persist(
        (set, get) => ({
            // Initial state
            sessions: [],
            sharedContext: '',
            workflow: {
                activeWorkflowId: null,
                stepIndex: 0,
                customWorkflows: [],
            },
            ui: {
                isSidebarOpen: false,
                isEvalMode: false,
                isJudging: false,
                isBuilderOpen: false,
                bounceState: {
                    isOpen: false,
                    content: null,
                },
                bounceConfigOpen: false,
            },
            debate: {
                bounce: { ...INITIAL_BOUNCE_STATE },
                bounceHistory: [],
                selectedParticipants: [],
                bounceConfig: { ...DEFAULT_BOUNCE_CONFIG },
            },

            // Session actions
            addSession: (session) => set((state) => ({
                sessions: [...state.sessions, { ...session, messages: [] }],
            })),

            removeSession: (sessionId) => set((state) => ({
                sessions: state.sessions.filter((s) => s.id !== sessionId),
            })),

            clearSessions: () => set({ sessions: [] }),

            updateSessionMessages: (sessionId, messages) => set((state) => ({
                sessions: state.sessions.map((s) =>
                    s.id === sessionId ? { ...s, messages } : s
                ),
            })),

            // Context actions
            setSharedContext: (context) => set({ sharedContext: context }),

            // Workflow actions
            setActiveWorkflow: (workflowId) => set((state) => ({
                workflow: { ...state.workflow, activeWorkflowId: workflowId, stepIndex: 0 },
            })),

            setWorkflowStep: (index) => set((state) => ({
                workflow: { ...state.workflow, stepIndex: index },
            })),

            addCustomWorkflow: (workflow) => set((state) => ({
                workflow: {
                    ...state.workflow,
                    customWorkflows: [...state.workflow.customWorkflows, workflow],
                },
            })),

            removeCustomWorkflow: (workflowId) => set((state) => ({
                workflow: {
                    ...state.workflow,
                    customWorkflows: state.workflow.customWorkflows.filter(
                        (w) => w.id !== workflowId
                    ),
                },
            })),

            // UI actions
            toggleSidebar: () => set((state) => ({
                ui: { ...state.ui, isSidebarOpen: !state.ui.isSidebarOpen },
            })),

            setEvalMode: (isEvalMode) => set((state) => ({
                ui: { ...state.ui, isEvalMode },
            })),

            setJudging: (isJudging) => set((state) => ({
                ui: { ...state.ui, isJudging },
            })),

            setBuilderOpen: (isOpen) => set((state) => ({
                ui: { ...state.ui, isBuilderOpen: isOpen },
            })),

            setBounceState: (bounceState) => set((state) => ({
                ui: { ...state.ui, bounceState },
            })),

            setBounceConfigOpen: (isOpen) => set((state) => ({
                ui: { ...state.ui, bounceConfigOpen: isOpen },
            })),

            // Debate actions
            updateBounceState: (bounce) => set((state) => ({
                debate: {
                    ...state.debate,
                    bounce: { ...state.debate.bounce, ...bounce },
                },
            })),

            setBounceConfig: (config) => set((state) => ({
                debate: {
                    ...state.debate,
                    bounceConfig: { ...state.debate.bounceConfig, ...config },
                },
            })),

            addSelectedParticipant: (participant) => set((state) => ({
                debate: {
                    ...state.debate,
                    selectedParticipants: [
                        ...state.debate.selectedParticipants.filter(
                            (p) => p.sessionId !== participant.sessionId
                        ),
                        participant,
                    ],
                },
            })),

            removeSelectedParticipant: (sessionId) => set((state) => ({
                debate: {
                    ...state.debate,
                    selectedParticipants: state.debate.selectedParticipants.filter(
                        (p) => p.sessionId !== sessionId
                    ),
                },
            })),

            clearSelectedParticipants: () => set((state) => ({
                debate: {
                    ...state.debate,
                    selectedParticipants: [],
                },
            })),

            addBounceToHistory: (session) => set((state) => ({
                debate: {
                    ...state.debate,
                    bounceHistory: [...state.debate.bounceHistory, session],
                },
            })),

            clearBounceHistory: () => set((state) => ({
                debate: {
                    ...state.debate,
                    bounceHistory: [],
                },
            })),

            resetBounce: () => set((state) => ({
                debate: {
                    ...state.debate,
                    bounce: { ...INITIAL_BOUNCE_STATE },
                    selectedParticipants: [],
                },
            })),

            // Computed helpers
            getSessionContent: (sessionId) => {
                const session = get().sessions.find((s) => s.id === sessionId);
                if (!session) return '';
                return session.messages
                    .map((m) => `[${m.role}]: ${m.content}`)
                    .join('\n\n');
            },

            getAllSessionsContent: () => {
                const sessions = get().sessions;
                const content: Record<string, string> = {};
                sessions.forEach((s) => {
                    content[s.id] = s.messages
                        .map((m) => `[${m.role}]: ${m.content}`)
                        .join('\n\n');
                });
                return content;
            },

            getParticipantsFromSessions: () => {
                const sessions = get().sessions;
                return sessions.map((s) => ({
                    sessionId: s.id,
                    modelId: s.modelId,
                    title: s.title,
                    systemPrompt: s.systemPrompt,
                }));
            },
        }),
        {
            name: 'agent-conductor-storage',
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                // Only persist these fields
                sharedContext: state.sharedContext,
                workflow: {
                    customWorkflows: state.workflow.customWorkflows,
                },
            }),
        }
    )
);

// Selector hooks for better performance
export const useSessions = () => useAgentStore((state) => state.sessions);
export const useSharedContext = () => useAgentStore((state) => state.sharedContext);
export const useWorkflow = () => useAgentStore((state) => state.workflow);
export const useUI = () => useAgentStore((state) => state.ui);
export const useDebate = () => useAgentStore((state) => state.debate);
export const useBounceState = () => useAgentStore((state) => state.debate.bounce);
export const useBounceConfig = () => useAgentStore((state) => state.debate.bounceConfig);
export const useSelectedParticipants = () => useAgentStore((state) => state.debate.selectedParticipants);
