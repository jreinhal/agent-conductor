import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type SpawnBehavior =
    | { type: 'error'; error: Error }
    | { type: 'close'; code: number; stdout?: string; stderr?: string };

const spawnMock = vi.fn();

vi.mock('child_process', () => ({
    spawn: (...args: unknown[]) => spawnMock(...args),
}));

function createMockChild(behavior: SpawnBehavior) {
    const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
        stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
        pid: number;
        kill: ReturnType<typeof vi.fn>;
    };

    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = {
        write: vi.fn(),
        end: vi.fn(),
    };
    child.pid = 4321;
    child.kill = vi.fn();

    queueMicrotask(() => {
        if (behavior.type === 'error') {
            child.emit('error', behavior.error);
            return;
        }

        if (behavior.stdout) {
            child.stdout.emit('data', Buffer.from(behavior.stdout, 'utf-8'));
        }
        if (behavior.stderr) {
            child.stderr.emit('data', Buffer.from(behavior.stderr, 'utf-8'));
        }
        child.emit('close', behavior.code, null);
    });

    return child;
}

describe('runLocalCliChat retry behavior', () => {
    beforeEach(() => {
        spawnMock.mockReset();
        process.env.AC_CLI_TIMEOUT_MS = '5000';
    });

    afterEach(() => {
        vi.resetModules();
    });

    it('retries once on transient timeout-like errors', async () => {
        const behaviors: SpawnBehavior[] = [
            { type: 'error', error: new Error('timed out waiting for codex') },
            {
                type: 'close',
                code: 0,
                stdout: JSON.stringify({
                    type: 'item.completed',
                    item: { type: 'agent_message', text: 'resolved' },
                }),
            },
        ];

        spawnMock.mockImplementation(() => createMockChild(behaviors.shift() || {
            type: 'error',
            error: new Error('missing behavior'),
        }));

        const { runLocalCliChat } = await import('@/lib/cli-chat');
        const output = await runLocalCliChat('gpt-5.3-codex', [{ role: 'user', content: 'hello' }]);

        expect(output).toBe('resolved');
        expect(spawnMock).toHaveBeenCalledTimes(2);
    });

    it('does not retry non-transient process errors', async () => {
        const behaviors: SpawnBehavior[] = [
            { type: 'error', error: new Error('permission denied') },
        ];

        spawnMock.mockImplementation(() => createMockChild(behaviors.shift() || {
            type: 'error',
            error: new Error('missing behavior'),
        }));

        const { runLocalCliChat } = await import('@/lib/cli-chat');

        await expect(
            runLocalCliChat('gpt-5.3-codex', [{ role: 'user', content: 'hello' }])
        ).rejects.toThrow('permission denied');

        expect(spawnMock).toHaveBeenCalledTimes(1);
    });
});
