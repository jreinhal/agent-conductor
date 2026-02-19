'use client';

import { useState, useCallback } from 'react';
import {
  Check,
  X,
  Minus,
  Clock,
  ChevronDown,
  ChevronUp,
  Copy,
  CheckCheck,
  ExternalLink,
} from 'lucide-react';
import type { ProtocolEntry, Stance } from '@/lib/protocol/types';
import {
  getStanceDisplay,
  confidenceToPercent,
  formatRelativeTime,
  getAgentColor,
  getAgentInitials,
  getEntryStatusDisplay,
} from '@/lib/file-session-utils';

// ─── Types ──────────────────────────────────────────────────────────

export interface SessionEntryCardProps {
  entry: ProtocolEntry;
  /** Whether this entry is newly added (triggers entrance animation). */
  isNew?: boolean;
  className?: string;
}

// ─── Stance Icon Component ──────────────────────────────────────────

function StanceIcon({ stance }: { stance: Stance | undefined }) {
  const display = getStanceDisplay(stance);
  const iconProps = { className: `w-3.5 h-3.5 ${display.colorClass}`, strokeWidth: 2.5 };

  switch (display.icon) {
    case 'check':
      return <Check {...iconProps} />;
    case 'x':
      return <X {...iconProps} />;
    case 'minus':
      return <Minus {...iconProps} />;
    case 'clock':
      return <Clock {...iconProps} />;
    default:
      return <Minus {...iconProps} />;
  }
}

// ─── Body Collapse Threshold ────────────────────────────────────────

/** Lines above this count start collapsed. */
const COLLAPSE_THRESHOLD = 4;

// ─── Component ──────────────────────────────────────────────────────

export function SessionEntryCard({ entry, isNew = false, className = '' }: SessionEntryCardProps) {
  const bodyLines = entry.body.split('\n');
  const isLong = bodyLines.length > COLLAPSE_THRESHOLD;
  const [expanded, setExpanded] = useState(!isLong);
  const [copied, setCopied] = useState(false);

  const agentColor = getAgentColor(entry.author);
  const initials = getAgentInitials(entry.author);
  const stanceDisplay = getStanceDisplay(entry.fields.stance);
  const confidencePct = confidenceToPercent(entry.fields.confidence);
  const relativeTime = formatRelativeTime(entry.timestamp);
  const entryStatus = getEntryStatusDisplay(entry.status);

  const handleCopy = useCallback(async () => {
    try {
      const text = [
        entry.fields.summary ? `Summary: ${entry.fields.summary}` : '',
        entry.body,
      ]
        .filter(Boolean)
        .join('\n\n');
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available
    }
  }, [entry.fields.summary, entry.body]);

  // Parse evidence links
  const evidenceLinks =
    entry.fields.evidence && entry.fields.evidence !== 'n/a'
      ? entry.fields.evidence.split(/[,;\s]+/).filter(Boolean)
      : [];

  return (
    <div
      className={`
        group relative rounded-lg border border-[#2a2a38] bg-[#16161e] overflow-hidden
        hover:border-[#3a3a48]
        ${isNew ? 'animate-slideInUp' : ''}
        ${className}
      `}
      style={{
        transition:
          'border-color 200ms cubic-bezier(0.25, 0.1, 0.25, 1), box-shadow 200ms cubic-bezier(0.25, 0.1, 0.25, 1)',
      }}
    >
      {/* Card Header */}
      <div className="flex items-center gap-3 px-3 py-2.5 border-b border-[#1f1f2a]">
        {/* Agent avatar */}
        <div
          className={`
            w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0
            ${agentColor.bg}
          `}
        >
          {initials}
        </div>

        {/* Agent name + timestamp */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-200 truncate">
              {entry.author}
            </span>
            <span className="text-[10px] text-gray-500">{relativeTime}</span>
          </div>
        </div>

        {/* Status badge */}
        <span
          className={`
            px-1.5 py-0.5 rounded text-[10px] font-medium
            ${entryStatus.bgClass} ${entryStatus.colorClass}
          `}
        >
          {entryStatus.label}
        </span>

        {/* Copy button */}
        <button
          onClick={handleCopy}
          className="p-1 rounded text-gray-500 hover:text-gray-300 hover:bg-[#2a2a38] opacity-0 group-hover:opacity-100"
          style={{ transition: 'opacity 150ms ease, color 150ms ease, background-color 150ms ease' }}
          title="Copy entry"
        >
          {copied ? <CheckCheck className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Structured Fields Row */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-[#1f1f2a]/50 bg-[#13131a]">
        {/* Stance indicator */}
        <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded ${stanceDisplay.bgClass}`}>
          <StanceIcon stance={entry.fields.stance} />
          <span className={`text-[11px] font-medium ${stanceDisplay.colorClass}`}>
            {stanceDisplay.label}
          </span>
        </div>

        {/* Confidence bar */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <span className="text-[10px] text-gray-500 shrink-0">Conf</span>
          <div className="flex-1 h-1.5 rounded-full bg-[#2a2a38] overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-400"
              style={{
                width: `${confidencePct}%`,
                transition: 'width 300ms cubic-bezier(0.25, 0.1, 0.25, 1)',
              }}
            />
          </div>
          <span className="text-[10px] text-gray-400 tabular-nums shrink-0">{confidencePct}%</span>
        </div>

        {/* Round/Turn indicator */}
        <span className="text-[10px] text-gray-500 shrink-0 tabular-nums">
          R{entry.metadata.round}T{entry.metadata.turn}
        </span>
      </div>

      {/* Summary line */}
      {entry.fields.summary && (
        <div className="px-3 py-2 border-b border-[#1f1f2a]/30">
          <p className="text-sm font-medium text-gray-200 leading-snug">
            {entry.fields.summary}
          </p>
        </div>
      )}

      {/* Body content */}
      {entry.body && (
        <div className="px-3 py-2">
          <div
            className={`text-sm text-gray-400 leading-relaxed whitespace-pre-wrap break-words ${
              !expanded ? 'line-clamp-4' : ''
            }`}
          >
            {entry.body}
          </div>

          {isLong && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 mt-1.5 text-[11px] text-blue-400 hover:text-blue-300"
              style={{ transition: 'color 150ms ease' }}
            >
              {expanded ? (
                <>
                  <ChevronUp className="w-3 h-3" /> Show less
                </>
              ) : (
                <>
                  <ChevronDown className="w-3 h-3" /> Show more
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* Evidence links */}
      {evidenceLinks.length > 0 && (
        <div className="px-3 py-2 border-t border-[#1f1f2a]/30">
          <div className="flex flex-wrap gap-1.5">
            {evidenceLinks.map((link, idx) => (
              <span
                key={idx}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#1f1f2a] text-[10px] text-gray-400 max-w-[200px] truncate"
                title={link}
              >
                <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                {link}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Action requested */}
      {entry.fields.actionRequested && entry.fields.actionRequested !== 'n/a' && (
        <div className="px-3 py-2 border-t border-[#1f1f2a]/30 bg-amber-500/5">
          <div className="flex items-start gap-1.5">
            <Clock className="w-3 h-3 text-amber-400 mt-0.5 shrink-0" />
            <span className="text-[11px] text-amber-300">
              Action: {entry.fields.actionRequested}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
