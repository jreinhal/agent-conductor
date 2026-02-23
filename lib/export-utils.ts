/**
 * Export utilities for sessions and debate history.
 * Supports JSON and Markdown formats.
 */

import type { SessionWithMessages } from './store';
import type { SerializedBounceSession } from './bounce-types';

/** Trigger a browser download of an in-memory blob. */
function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function timestamp(): string {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/** Export all sessions and debate history as a JSON file. */
export function exportAsJSON(
    sessions: SessionWithMessages[],
    bounceHistory: SerializedBounceSession[],
) {
    const payload = {
        exportedAt: new Date().toISOString(),
        version: 1,
        sessions: sessions.map((s) => ({
            id: s.id,
            modelId: s.modelId,
            title: s.title,
            isPersona: s.isPersona,
            systemPrompt: s.systemPrompt,
            messageCount: s.messages.length,
            messages: s.messages.map((m) => ({
                role: m.role,
                content: m.content,
            })),
        })),
        debates: bounceHistory,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
    });
    downloadBlob(blob, `agent-conductor-export-${timestamp()}.json`);
}

/** Export all sessions and debate history as a Markdown file. */
export function exportAsMarkdown(
    sessions: SessionWithMessages[],
    bounceHistory: SerializedBounceSession[],
) {
    const lines: string[] = [];
    lines.push('# Agent Conductor Export');
    lines.push(`Exported: ${new Date().toLocaleString()}`);
    lines.push('');

    // Sessions
    if (sessions.length > 0) {
        lines.push('## Sessions');
        lines.push('');
        for (const session of sessions) {
            lines.push(`### ${session.title} (${session.modelId})`);
            if (session.systemPrompt) {
                lines.push(`> System: ${session.systemPrompt.slice(0, 200)}${session.systemPrompt.length > 200 ? '...' : ''}`);
            }
            lines.push('');
            for (const msg of session.messages) {
                const role = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : msg.role;
                lines.push(`**${role}:**`);
                lines.push(msg.content as string);
                lines.push('');
            }
            lines.push('---');
            lines.push('');
        }
    }

    // Debate history
    if (bounceHistory.length > 0) {
        lines.push('## Debate History');
        lines.push('');
        for (const debate of bounceHistory) {
            lines.push(`### Debate: ${debate.topic}`);
            lines.push(`- Status: ${debate.status}`);
            lines.push(`- Rounds: ${debate.rounds.length}`);
            if (debate.finalAnswer) {
                lines.push('');
                lines.push('**Final Answer:**');
                lines.push(debate.finalAnswer);
            }
            lines.push('');
            lines.push('---');
            lines.push('');
        }
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    downloadBlob(blob, `agent-conductor-export-${timestamp()}.md`);
}
