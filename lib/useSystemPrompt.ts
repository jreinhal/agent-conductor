import { useMemo } from 'react';
import { Session } from '@/lib/types';
import { useAgentStore } from '@/lib/store';
import { formatKnowledgeForPrompt } from '@/lib/consensus-analyzer';

/**
 * Build the composite system prompt for a session by combining:
 * 1. Shared project context (user-defined)
 * 2. Accumulated debate knowledge
 * 3. Session-specific system prompt (e.g. persona)
 */
export function useSystemPrompt(session: Session): string {
    const sharedContext = useAgentStore((state) => state.sharedContext);
    const sharedKnowledge = useAgentStore((state) => state.sharedKnowledge);

    return useMemo(() => {
        const knowledgeBlock = formatKnowledgeForPrompt(sharedKnowledge);
        return [
            sharedContext ? `# SHARED PROJECT CONTEXT:\n${sharedContext}` : '',
            knowledgeBlock,
            session.systemPrompt || '',
        ].filter(Boolean).join('\n\n---\n\n');
    }, [sharedContext, sharedKnowledge, session.systemPrompt]);
}
