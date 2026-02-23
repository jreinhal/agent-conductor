/**
 * Tests for lib/export-utils.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DOM APIs used by export-utils
const mockCreateObjectURL = vi.fn(() => 'blob:mock-url');
const mockRevokeObjectURL = vi.fn();
const mockClick = vi.fn();
const mockAppendChild = vi.fn();
const mockRemoveChild = vi.fn();

vi.stubGlobal('URL', {
    createObjectURL: mockCreateObjectURL,
    revokeObjectURL: mockRevokeObjectURL,
});

vi.stubGlobal('document', {
    createElement: vi.fn(() => ({
        href: '',
        download: '',
        click: mockClick,
    })),
    body: {
        appendChild: mockAppendChild,
        removeChild: mockRemoveChild,
    },
});

// Import after mocks
import { exportAsJSON, exportAsMarkdown } from '../lib/export-utils';
import type { SessionWithMessages } from '../lib/store';
import type { SerializedBounceSession } from '../lib/bounce-types';

function makeSession(id: string, title: string, messages: { role: string; content: string }[]): SessionWithMessages {
    return {
        id,
        modelId: `model-${id}`,
        title,
        isPersona: false,
        messages: messages.map((m) => ({
            id: `msg-${Math.random()}`,
            role: m.role as 'user' | 'assistant',
            content: m.content,
        })),
    };
}

function makeDebate(topic: string): SerializedBounceSession {
    return {
        topic,
        status: 'complete',
        rounds: [{ roundNumber: 1, responses: [] }],
        finalAnswer: 'The answer is 42',
        startedAt: Date.now(),
        completedAt: Date.now(),
    } as unknown as SerializedBounceSession;
}

describe('exportAsJSON', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('creates a Blob and triggers download', () => {
        const sessions = [makeSession('a', 'GPT', [{ role: 'user', content: 'hello' }])];
        const debates = [makeDebate('test topic')];

        exportAsJSON(sessions, debates);

        expect(mockCreateObjectURL).toHaveBeenCalledOnce();
        expect(mockClick).toHaveBeenCalledOnce();
        expect(mockRevokeObjectURL).toHaveBeenCalledOnce();
    });

    it('handles empty data', () => {
        exportAsJSON([], []);
        expect(mockClick).toHaveBeenCalledOnce();
    });

    it('includes session messages in the payload', () => {
        const sessions = [
            makeSession('a', 'Claude', [
                { role: 'user', content: 'What is 2+2?' },
                { role: 'assistant', content: '4' },
            ]),
        ];

        // Capture the Blob content
        let blobContent = '';
        vi.stubGlobal('Blob', class {
            constructor(parts: string[]) {
                blobContent = parts[0];
            }
        });

        exportAsJSON(sessions, []);

        const parsed = JSON.parse(blobContent);
        expect(parsed.sessions).toHaveLength(1);
        expect(parsed.sessions[0].messages).toHaveLength(2);
        expect(parsed.sessions[0].messages[0].content).toBe('What is 2+2?');
        expect(parsed.version).toBe(1);
    });
});

describe('exportAsMarkdown', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('creates a Markdown download', () => {
        const sessions = [
            makeSession('a', 'GPT', [
                { role: 'user', content: 'hello' },
                { role: 'assistant', content: 'world' },
            ]),
        ];

        let blobContent = '';
        vi.stubGlobal('Blob', class {
            constructor(parts: string[]) {
                blobContent = parts[0];
            }
        });

        exportAsMarkdown(sessions, []);

        expect(blobContent).toContain('# Agent Conductor Export');
        expect(blobContent).toContain('### GPT (model-a)');
        expect(blobContent).toContain('**User:**');
        expect(blobContent).toContain('hello');
    });

    it('includes debate history', () => {
        let blobContent = '';
        vi.stubGlobal('Blob', class {
            constructor(parts: string[]) {
                blobContent = parts[0];
            }
        });

        exportAsMarkdown([], [makeDebate('Should we use TypeScript?')]);

        expect(blobContent).toContain('## Debate History');
        expect(blobContent).toContain('Should we use TypeScript?');
        expect(blobContent).toContain('The answer is 42');
    });
});
