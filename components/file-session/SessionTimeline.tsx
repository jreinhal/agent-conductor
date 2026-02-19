'use client';

import { useMemo } from 'react';
import { Activity, Target, Zap } from 'lucide-react';
import type { ProtocolEntry, ProtocolRules } from '@/lib/protocol/types';
import {
  getAgentColor,
  getAgentInitials,
  getSessionStatus,
  getStatusBadge,
  getCurrentRound,
} from '@/lib/file-session-utils';

// ─── Types ──────────────────────────────────────────────────────────

export interface SessionTimelineProps {
  entries: ProtocolEntry[];
  rules: ProtocolRules;
  currentRound: number;
  className?: string;
}

// ─── Component ──────────────────────────────────────────────────────

export function SessionTimeline({
  entries,
  rules,
  currentRound,
  className = '',
}: SessionTimelineProps) {
  // Compute per-agent activity data
  const agentActivity = useMemo(() => {
    const activity = new Map<string, { rounds: Set<number>; count: number }>();

    for (const agent of rules.agents) {
      activity.set(agent, { rounds: new Set(), count: 0 });
    }

    for (const entry of entries) {
      const data = activity.get(entry.author);
      if (data) {
        data.rounds.add(entry.metadata.round);
        data.count++;
      }
    }

    return activity;
  }, [entries, rules.agents]);

  // Compute consensus progress
  const consensusProgress = useMemo(() => {
    if (entries.length === 0) return 0;

    // Find entries in the current round
    const currentRoundEntries = entries.filter(
      (e) => e.metadata.round === currentRound,
    );

    if (currentRoundEntries.length === 0) return 0;

    // Count approve stances
    const approveCount = currentRoundEntries.filter(
      (e) => e.fields.stance === 'approve',
    ).length;

    // Progress as fraction of current round entries that approve
    return currentRoundEntries.length > 0
      ? approveCount / currentRoundEntries.length
      : 0;
  }, [entries, currentRound]);

  const sessionStatus = getSessionStatus(entries, rules.maxRounds);
  const statusBadge = getStatusBadge(sessionStatus);
  const maxRounds = rules.maxRounds;
  const threshold = rules.consensusThreshold;

  return (
    <div className={`rounded-lg border border-[#2a2a38] bg-[#16161e] overflow-hidden ${className}`}>
      {/* Timeline header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#1f1f2a]">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-gray-500" />
          <span className="text-xs font-medium text-gray-300">Timeline</span>
        </div>
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${statusBadge.bgClass} ${statusBadge.colorClass}`}>
          {statusBadge.label}
        </span>
      </div>

      {/* Round markers */}
      <div className="px-3 py-2 border-b border-[#1f1f2a]/50">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-gray-500 shrink-0">Rounds</span>
          <div className="flex items-center gap-1 flex-1 overflow-x-auto">
            {Array.from({ length: maxRounds }, (_, i) => i + 1).map((round) => {
              const isActive = round === currentRound;
              const isComplete = round < currentRound;
              const hasEntries = entries.some((e) => e.metadata.round === round);

              return (
                <div
                  key={round}
                  className={`
                    w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0
                    ${
                      isActive
                        ? 'bg-blue-500 text-white ring-2 ring-blue-500/30'
                        : isComplete
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : hasEntries
                            ? 'bg-[#2a2a38] text-gray-300'
                            : 'bg-[#1f1f2a] text-gray-600'
                    }
                  `}
                  style={{
                    transition: 'background-color 200ms ease, color 200ms ease',
                  }}
                >
                  {round}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Per-agent activity */}
      <div className="px-3 py-2 border-b border-[#1f1f2a]/50">
        <div className="space-y-1.5">
          {rules.agents.map((agent) => {
            const data = agentActivity.get(agent);
            const color = getAgentColor(agent);
            const initials = getAgentInitials(agent);
            const entryCount = data?.count ?? 0;

            return (
              <div key={agent} className="flex items-center gap-2">
                {/* Agent avatar */}
                <div
                  className={`
                    w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white shrink-0
                    ${color.bg}
                  `}
                >
                  {initials}
                </div>

                {/* Agent name */}
                <span className="text-[11px] text-gray-400 w-20 truncate shrink-0">
                  {agent}
                </span>

                {/* Round activity segments */}
                <div className="flex items-center gap-0.5 flex-1">
                  {Array.from({ length: maxRounds }, (_, i) => i + 1).map((round) => {
                    const active = data?.rounds.has(round) ?? false;
                    return (
                      <div
                        key={round}
                        className={`
                          flex-1 h-2 rounded-sm
                          ${active ? color.bg : 'bg-[#1f1f2a]'}
                        `}
                        style={{
                          opacity: active ? 0.7 : 0.3,
                          transition: 'opacity 200ms ease, background-color 200ms ease',
                        }}
                      />
                    );
                  })}
                </div>

                {/* Entry count */}
                <span className="text-[10px] text-gray-500 tabular-nums w-4 text-right shrink-0">
                  {entryCount}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Consensus progress bar */}
      <div className="px-3 py-2">
        <div className="flex items-center gap-2">
          <Target className="w-3 h-3 text-gray-500 shrink-0" />
          <span className="text-[10px] text-gray-500 shrink-0">Consensus</span>
          <div className="flex-1 h-2 rounded-full bg-[#1f1f2a] overflow-hidden relative">
            {/* Threshold marker */}
            <div
              className="absolute top-0 bottom-0 w-px bg-amber-400/60 z-10"
              style={{ left: `${threshold * 100}%` }}
              title={`Threshold: ${Math.round(threshold * 100)}%`}
            />
            {/* Progress fill */}
            <div
              className={`
                h-full rounded-full
                ${
                  consensusProgress >= threshold
                    ? 'bg-gradient-to-r from-emerald-500 to-emerald-400'
                    : 'bg-gradient-to-r from-blue-500 to-blue-400'
                }
              `}
              style={{
                width: `${Math.round(consensusProgress * 100)}%`,
                transition: 'width 400ms cubic-bezier(0.25, 0.1, 0.25, 1)',
              }}
            />
          </div>
          <span className="text-[10px] text-gray-400 tabular-nums shrink-0">
            {Math.round(consensusProgress * 100)}%
          </span>
        </div>
      </div>
    </div>
  );
}
