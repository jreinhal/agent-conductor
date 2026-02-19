/**
 * File-Session UI Components — Barrel Export
 *
 * Renders Bounce Protocol session files in real-time.
 * These are standalone components alongside the existing ChatPanel;
 * they do NOT modify any existing files.
 */

export { FileSessionPanel } from './FileSessionPanel';
export type { FileSessionPanelProps } from './FileSessionPanel';

export { SessionTimeline } from './SessionTimeline';
export type { SessionTimelineProps } from './SessionTimeline';

export { SessionEntryCard } from './SessionEntryCard';
export type { SessionEntryCardProps } from './SessionEntryCard';

// Re-export the hook for convenience
export { useFileSession } from '@/hooks/useFileSession';
export type {
  UseFileSessionOptions,
  UseFileSessionReturn,
} from '@/hooks/useFileSession';
