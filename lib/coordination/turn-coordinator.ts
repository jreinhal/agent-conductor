/**
 * Turn Coordinator — State Machine for Bounce Protocol Turn Management
 *
 * Manages turn-taking between agents according to the protocol rules.
 * Supports round-robin, free-form, and supervised turn orders,
 * with timeout handling and escalation policies.
 *
 * @module lib/coordination/turn-coordinator
 */

import { EventEmitter } from 'events';
import type {
  ProtocolRules,
  ProtocolEntry,
  EscalationPolicy,
} from '@/lib/protocol/types';

// ─── Turn State ─────────────────────────────────────────────────────

/** All possible states of the turn coordinator state machine. */
export type TurnState =
  | 'idle'
  | 'agent-active'
  | 'yield-received'
  | 'next-agent'
  | 'timeout'
  | 'escalating'
  | 'round-complete'
  | 'session-complete';

// ─── Options ────────────────────────────────────────────────────────

/** Configuration for the TurnCoordinator. */
export interface TurnCoordinatorOptions {
  /** Protocol rules governing the session. */
  rules: ProtocolRules;
  /** Callback when it is an agent's turn. */
  onAgentTurn?: (agentName: string, round: number, turn: number) => void;
  /** Callback when a timeout occurs. */
  onTimeout?: (agentName: string) => void;
  /** Callback when escalation is needed. */
  onEscalation?: (reason: string) => void;
  /** Callback when a round completes. */
  onRoundComplete?: (round: number) => void;
  /** Callback when the session completes. */
  onSessionComplete?: (reason: string) => void;
}

// ─── Events ─────────────────────────────────────────────────────────

export interface TurnCoordinatorEvents {
  'state-change': (from: TurnState, to: TurnState) => void;
  'agent-turn': (agentName: string, round: number, turn: number) => void;
  'timeout': (agentName: string) => void;
  'escalation': (reason: string) => void;
  'round-complete': (round: number) => void;
  'session-complete': (reason: string) => void;
}

// ─── TurnCoordinator ────────────────────────────────────────────────

/**
 * State machine coordinating agent turns in a Bounce Protocol session.
 *
 * State transitions:
 * ```
 * idle -> start() -> agent-active(first agent)
 * agent-active -> recordYield() -> yield-received -> next-agent -> agent-active(next) | round-complete
 * agent-active -> timeout -> escalating -> (skip | human | default) -> next-agent | session-complete
 * round-complete -> (max-rounds reached?) -> session-complete | agent-active(first agent, next round)
 * ```
 */
export class TurnCoordinator extends EventEmitter {
  private readonly rules: ProtocolRules;
  private readonly options: TurnCoordinatorOptions;

  private state: TurnState = 'idle';
  private currentAgent: string | null = null;
  private currentRound = 0;
  private currentTurn = 0;
  private completionReason: string | null = null;

  /**
   * For round-robin: index into the agents array indicating who goes next.
   * For free-form: set of agents that have contributed in the current round.
   * For supervised: the name of the agent designated to go next.
   */
  private roundRobinIndex = 0;
  private freeFormContributed: Set<string> = new Set();
  private freeFormYielded: Set<string> = new Set();
  private supervisedNextAgent: string | null = null;

  /** Timer handle for turn timeouts. */
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: TurnCoordinatorOptions) {
    super();
    this.options = options;
    this.rules = options.rules;
  }

  // ─── Public Getters ─────────────────────────────────────────────

  /** Get the current state of the state machine. */
  getState(): TurnState {
    return this.state;
  }

  /** Get the currently active agent, or null if idle / session complete. */
  getCurrentAgent(): string | null {
    return this.currentAgent;
  }

  /** Get the current round number (1-indexed). */
  getCurrentRound(): number {
    return this.currentRound;
  }

  /** Get the current turn number within the round (1-indexed). */
  getCurrentTurn(): number {
    return this.currentTurn;
  }

  /** Check whether the session is complete. */
  isComplete(): boolean {
    return this.state === 'session-complete';
  }

  /** Get the session completion reason, or null if still active. */
  getCompletionReason(): string | null {
    return this.completionReason;
  }

  // ─── Public Actions ─────────────────────────────────────────────

  /** Start the coordination -- activates the first agent. */
  start(): void {
    if (this.state !== 'idle') {
      throw new Error(`Cannot start: coordinator is in state "${this.state}", expected "idle"`);
    }

    if (this.rules.agents.length === 0) {
      this.transitionTo('session-complete');
      this.completionReason = 'no-agents';
      this.emitSessionComplete('no-agents');
      return;
    }

    this.currentRound = 1;
    this.currentTurn = 1;
    this.roundRobinIndex = 0;
    this.freeFormContributed.clear();
    this.freeFormYielded.clear();
    this.supervisedNextAgent = null;

    this.activateAgent(this.rules.agents[0]);
  }

  /** Record that an entry was received from an agent. */
  recordEntry(entry: ProtocolEntry): void {
    if (this.state === 'session-complete') {
      return;
    }

    const agentName = entry.author;

    if (this.rules.turnOrder === 'free-form') {
      this.freeFormContributed.add(agentName);
    }

    // For supervised mode, extract action_requested to determine next agent
    if (this.rules.turnOrder === 'supervised' && entry.fields.actionRequested) {
      const requested = entry.fields.actionRequested;
      if (requested !== 'n/a') {
        // Check if the requested agent is in the agents list
        const matchedAgent = this.rules.agents.find(
          (a) => requested.includes(a)
        );
        if (matchedAgent) {
          this.supervisedNextAgent = matchedAgent;
        }
      }
    }
  }

  /** Record that a yield was received -- advance to next turn. */
  recordYield(agentName: string): void {
    if (this.state === 'session-complete') {
      return;
    }

    if (this.state !== 'agent-active') {
      return;
    }

    this.clearTimeout();

    if (this.rules.turnOrder === 'free-form') {
      this.freeFormYielded.add(agentName);
    }

    this.transitionTo('yield-received');
    this.advanceToNext();
  }

  /** Check if a specific agent is allowed to write now. */
  isAgentAllowed(agentName: string): boolean {
    if (this.state !== 'agent-active') {
      return false;
    }

    switch (this.rules.turnOrder) {
      case 'round-robin':
        return this.currentAgent === agentName;
      case 'free-form':
        return this.rules.agents.includes(agentName);
      case 'supervised':
        return this.currentAgent === agentName;
      default:
        return false;
    }
  }

  /** Force advance to the next agent (e.g., after timeout). */
  forceAdvance(): void {
    if (this.state === 'session-complete' || this.state === 'idle') {
      return;
    }

    this.clearTimeout();
    this.advanceToNext();
  }

  /** Clean up timers (call when disposing of the coordinator). */
  dispose(): void {
    this.clearTimeout();
    this.removeAllListeners();
  }

  // ─── Private: State Machine ───────────────────────────────────────

  private transitionTo(newState: TurnState): void {
    const oldState = this.state;
    this.state = newState;
    this.emit('state-change', oldState, newState);
  }

  private activateAgent(agentName: string): void {
    this.currentAgent = agentName;
    this.transitionTo('agent-active');
    this.startTimeout();
    this.emitAgentTurn(agentName, this.currentRound, this.currentTurn);
  }

  private advanceToNext(): void {
    this.transitionTo('next-agent');

    switch (this.rules.turnOrder) {
      case 'round-robin':
        this.advanceRoundRobin();
        break;
      case 'free-form':
        this.advanceFreeForm();
        break;
      case 'supervised':
        this.advanceSupervised();
        break;
    }
  }

  private advanceRoundRobin(): void {
    this.roundRobinIndex += 1;

    if (this.roundRobinIndex >= this.rules.agents.length) {
      // All agents have gone this round
      this.completeRound();
    } else {
      this.currentTurn += 1;
      this.activateAgent(this.rules.agents[this.roundRobinIndex]);
    }
  }

  private advanceFreeForm(): void {
    // Round ends when all agents have contributed at least once
    // or all active agents have yielded
    const allContributed = this.rules.agents.every(
      (a) => this.freeFormContributed.has(a)
    );
    const allYielded = this.rules.agents.every(
      (a) => this.freeFormYielded.has(a)
    );

    if (allContributed || allYielded) {
      this.completeRound();
    } else {
      // In free-form, we still need to set an "active" agent for timeout purposes.
      // Pick the next agent that hasn't contributed yet.
      const nextAgent = this.rules.agents.find(
        (a) => !this.freeFormContributed.has(a)
      );
      if (nextAgent) {
        this.currentTurn += 1;
        this.activateAgent(nextAgent);
      } else {
        this.completeRound();
      }
    }
  }

  private advanceSupervised(): void {
    if (this.supervisedNextAgent) {
      const nextAgent = this.supervisedNextAgent;
      this.supervisedNextAgent = null;
      this.currentTurn += 1;
      this.activateAgent(nextAgent);
    } else {
      // No explicit next agent requested -- round complete
      this.completeRound();
    }
  }

  private completeRound(): void {
    this.transitionTo('round-complete');
    this.emitRoundComplete(this.currentRound);

    if (this.currentRound >= this.rules.maxRounds) {
      this.transitionTo('session-complete');
      this.completionReason = 'max-rounds-reached';
      this.emitSessionComplete('max-rounds-reached');
    } else {
      // Start next round
      this.currentRound += 1;
      this.currentTurn = 1;
      this.roundRobinIndex = 0;
      this.freeFormContributed.clear();
      this.freeFormYielded.clear();
      this.supervisedNextAgent = null;

      this.activateAgent(this.rules.agents[0]);
    }
  }

  // ─── Private: Timeout Handling ────────────────────────────────────

  private startTimeout(): void {
    this.clearTimeout();

    const timeoutMs = this.rules.turnTimeout * 1000;

    this.timeoutTimer = setTimeout(() => {
      this.handleTimeout();
    }, timeoutMs);
  }

  private clearTimeout(): void {
    if (this.timeoutTimer !== null) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  private handleTimeout(): void {
    const timedOutAgent = this.currentAgent;
    this.transitionTo('timeout');

    if (timedOutAgent) {
      this.emitTimeout(timedOutAgent);
    }

    this.transitionTo('escalating');
    this.applyEscalationPolicy(this.rules.escalation, timedOutAgent);
  }

  private applyEscalationPolicy(
    policy: EscalationPolicy,
    timedOutAgent: string | null,
  ): void {
    const reason = `Timeout for agent "${timedOutAgent ?? 'unknown'}", policy: ${policy}`;

    switch (policy) {
      case 'timeout-skip':
        this.emitEscalation(reason);
        // Mark the agent as having contributed (free-form) so round can complete
        if (this.rules.turnOrder === 'free-form' && timedOutAgent) {
          this.freeFormContributed.add(timedOutAgent);
          this.freeFormYielded.add(timedOutAgent);
        }
        this.advanceToNext();
        break;

      case 'human':
        this.emitEscalation(reason);
        // Session pauses -- do not advance. External intervention required.
        // The coordinator stays in 'escalating' state.
        break;

      case 'default-action':
        this.emitEscalation(reason);
        // Implementation-defined default: skip the agent and continue
        if (this.rules.turnOrder === 'free-form' && timedOutAgent) {
          this.freeFormContributed.add(timedOutAgent);
          this.freeFormYielded.add(timedOutAgent);
        }
        this.advanceToNext();
        break;
    }
  }

  // ─── Private: Event Emitters ──────────────────────────────────────

  private emitAgentTurn(agentName: string, round: number, turn: number): void {
    this.emit('agent-turn', agentName, round, turn);
    this.options.onAgentTurn?.(agentName, round, turn);
  }

  private emitTimeout(agentName: string): void {
    this.emit('timeout', agentName);
    this.options.onTimeout?.(agentName);
  }

  private emitEscalation(reason: string): void {
    this.emit('escalation', reason);
    this.options.onEscalation?.(reason);
  }

  private emitRoundComplete(round: number): void {
    this.emit('round-complete', round);
    this.options.onRoundComplete?.(round);
  }

  private emitSessionComplete(reason: string): void {
    this.emit('session-complete', reason);
    this.options.onSessionComplete?.(reason);
  }
}
