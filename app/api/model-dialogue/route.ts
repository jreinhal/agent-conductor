import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { runLocalCliChat } from '@/lib/cli-chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const REQUEST_SCHEMA = z.object({
    topic: z.string().min(6).max(6000),
    cycles: z.number().int().min(1).max(3).default(1),
    codexModel: z.string().min(2).max(100).default('gpt-5.3-codex'),
    claudeModel: z.string().min(2).max(100).default('claude-opus-4.6'),
    includeFinal: z.boolean().default(true),
    runPreflight: z.boolean().default(true),
    mode: z.enum(['freeform', 'strategy']).default('freeform'),
});

interface DialogueTurn {
    speaker: 'Codex' | 'Claude';
    cycle: number;
    durationMs: number;
    text: string;
}

function nowIsoSlug() {
    return new Date().toISOString().replace(/[:]/g, '-').replace(/\..+$/, 'Z');
}

function sanitizePathPart(value: string) {
    return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 80);
}

function compact(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

function buildTranscriptBlock(entries: DialogueTurn[]): string {
    if (entries.length === 0) return '(no prior turns)';
    return entries
        .map(
            (entry, index) =>
                `Turn ${index + 1} (${entry.speaker}, ${entry.durationMs}ms):\n${entry.text}`
        )
        .join('\n\n---\n\n');
}

function buildCodexPrompt(
    topic: string,
    entries: DialogueTurn[],
    cycle: number,
    totalCycles: number,
    mode: 'freeform' | 'strategy'
) {
    if (mode === 'freeform') {
        return [
            'You are GPT-5.3 Codex in a direct conversation with Claude.',
            `Cycle ${cycle}/${totalCycles}.`,
            'Goal: collaborate naturally on the user topic and move toward useful conclusions.',
            'Rules:',
            '- Talk directly to Claude.',
            '- Build on prior turn context.',
            '- Keep concise and concrete (<= 220 words).',
            '',
            `User topic:\n${topic}`,
            '',
            `Conversation so far:\n${buildTranscriptBlock(entries)}`,
            '',
            'Reply as Codex in normal conversational style.',
        ].join('\n');
    }

    return [
        'You are GPT-5.3 Codex in a two-model strategy dialogue with Claude.',
        'Goal: decide the best next execution plan for Agent Conductor.',
        `Current cycle: ${cycle}/${totalCycles}.`,
        'Constraints:',
        '- Be concrete, execution-oriented, and opinionated.',
        '- Keep response under 220 words.',
        '- Include exactly: 3 priorities, 3 risks, and 1 immediate next command.',
        '',
        `Topic:\n${topic}`,
        '',
        `Dialogue so far:\n${buildTranscriptBlock(entries)}`,
        '',
        'Respond as Codex only.',
    ].join('\n');
}

function buildClaudePrompt(
    topic: string,
    entries: DialogueTurn[],
    cycle: number,
    totalCycles: number,
    mode: 'freeform' | 'strategy'
) {
    if (mode === 'freeform') {
        return [
            'You are Claude in a direct conversation with Codex.',
            `Cycle ${cycle}/${totalCycles}.`,
            'Goal: collaborate naturally on the user topic and improve the joint answer.',
            'Rules:',
            '- Talk directly to Codex.',
            '- Build on prior turn context.',
            '- Keep concise and concrete (<= 220 words).',
            '',
            `User topic:\n${topic}`,
            '',
            `Conversation so far:\n${buildTranscriptBlock(entries)}`,
            '',
            'Reply as Claude in normal conversational style.',
        ].join('\n');
    }

    return [
        'You are Claude in a two-model strategy dialogue with Codex.',
        'Goal: stress-test and improve the execution plan for Agent Conductor.',
        `Current cycle: ${cycle}/${totalCycles}.`,
        'Constraints:',
        '- Be concise and specific.',
        '- Keep response under 220 words.',
        '- Include exactly: 3 refinements, 2 disagreements (if any), and 1 decisive recommendation.',
        '',
        `Topic:\n${topic}`,
        '',
        `Dialogue so far:\n${buildTranscriptBlock(entries)}`,
        '',
        'Respond as Claude only.',
    ].join('\n');
}

function buildFinalSynthesisPrompt(
    topic: string,
    entries: DialogueTurn[],
    mode: 'freeform' | 'strategy'
) {
    if (mode === 'freeform') {
        return [
            'You are Codex creating a final synthesis after a Codex+Claude conversation.',
            'Provide a clean, practical merged conclusion.',
            'Keep it concise (<= 260 words).',
            '',
            `User topic:\n${topic}`,
            '',
            `Conversation transcript:\n${buildTranscriptBlock(entries)}`,
        ].join('\n');
    }

    return [
        'You are Codex producing final synthesis after a Codex+Claude strategy dialogue.',
        'Return a final actionable plan for Agent Conductor.',
        'Constraints:',
        '- Keep under 260 words.',
        '- Sections: Final Direction, 7-Day Plan, Launch Gate.',
        '',
        `Topic:\n${topic}`,
        '',
        `Dialogue transcript:\n${buildTranscriptBlock(entries)}`,
    ].join('\n');
}

function formatTranscriptMarkdown(
    topic: string,
    turns: DialogueTurn[],
    observations: string[],
    finalSynthesis: string,
    settings: {
        cycles: number;
        codexModel: string;
        claudeModel: string;
    }
): string {
    const lines: string[] = [];
    lines.push('# Codex + Claude Dialogue');
    lines.push('');
    lines.push(`- timestamp: ${new Date().toISOString()}`);
    lines.push(`- topic: ${topic}`);
    lines.push(`- codex_model: ${settings.codexModel}`);
    lines.push(`- claude_model: ${settings.claudeModel}`);
    lines.push(`- cycles: ${settings.cycles}`);
    lines.push('');
    lines.push('## Transcript');
    lines.push('');
    turns.forEach((turn, idx) => {
        lines.push(`### Turn ${idx + 1} - ${turn.speaker} (${turn.durationMs}ms)`);
        lines.push('');
        lines.push(turn.text);
        lines.push('');
    });
    if (observations.length > 0) {
        lines.push('## Retrospective Signals');
        lines.push('');
        observations.forEach((observation) => lines.push(`- ${observation}`));
        lines.push('');
    }
    if (finalSynthesis.trim()) {
        lines.push('## Final Synthesis (Codex)');
        lines.push('');
        lines.push(finalSynthesis.trim());
        lines.push('');
    }
    return lines.join('\n');
}

async function writeTranscriptFile(
    topic: string,
    turns: DialogueTurn[],
    observations: string[],
    finalSynthesis: string,
    settings: {
        cycles: number;
        codexModel: string;
        claudeModel: string;
    }
): Promise<string> {
    const outputDir = path.join(process.cwd(), 'output', 'dialogues');
    await fs.mkdir(outputDir, { recursive: true });

    const slug = sanitizePathPart(compact(topic).toLowerCase().replace(/\s+/g, '-')) || 'dialogue';
    const filePath = path.join(outputDir, `${nowIsoSlug()}-${slug}.md`);
    const markdown = formatTranscriptMarkdown(topic, turns, observations, finalSynthesis, settings);
    await fs.writeFile(filePath, markdown, 'utf-8');
    return filePath;
}

function sse(payload: unknown) {
    return `data: ${JSON.stringify(payload)}\n\n`;
}

function maybeThrowAborted(signal: AbortSignal) {
    if (signal.aborted) {
        throw new Error('Dialogue aborted by client.');
    }
}

export async function POST(req: Request) {
    let parsedBody: z.infer<typeof REQUEST_SCHEMA>;
    try {
        const raw = (await req.json()) as unknown;
        const parsed = REQUEST_SCHEMA.safeParse(raw);
        if (!parsed.success) {
            return NextResponse.json(
                { error: 'Invalid dialogue request payload.', details: parsed.error.flatten() },
                { status: 400 }
            );
        }
        parsedBody = parsed.data;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return NextResponse.json({ error: message || 'Invalid request body.' }, { status: 400 });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const startedAt = Date.now();
            const turns: DialogueTurn[] = [];
            const observations: string[] = [];
            let finalSynthesis = '';
            let closed = false;

            const emit = (payload: unknown) => {
                if (closed) return;
                controller.enqueue(encoder.encode(sse(payload)));
            };

            const close = () => {
                if (closed) return;
                closed = true;
                controller.close();
            };

            try {
                emit({ type: 'status', phase: 'starting', message: 'Initializing dialogue run...' });
                maybeThrowAborted(req.signal);

                if (parsedBody.runPreflight) {
                    emit({ type: 'status', phase: 'preflight', message: 'Running CLI preflight checks...' });
                    const preflightStartedAt = Date.now();
                    const codexSmoke = await runLocalCliChat(
                        parsedBody.codexModel,
                        [{ role: 'user', content: 'Reply with exactly: READY' }]
                    );
                    maybeThrowAborted(req.signal);

                    const claudeSmoke = await runLocalCliChat(
                        parsedBody.claudeModel,
                        [{ role: 'user', content: 'Reply with exactly: READY' }]
                    );
                    maybeThrowAborted(req.signal);

                    if (!/ready/i.test(codexSmoke)) {
                        throw new Error(
                            `Codex smoke check failed for ${parsedBody.codexModel}. Output: ${compact(codexSmoke).slice(0, 140)}`
                        );
                    }
                    if (!/ready/i.test(claudeSmoke)) {
                        throw new Error(
                            `Claude smoke check failed for ${parsedBody.claudeModel}. Output: ${compact(claudeSmoke).slice(0, 140)}`
                        );
                    }

                    const preflightDuration = Date.now() - preflightStartedAt;
                    const note = `Preflight completed in ${preflightDuration}ms (executables + smoke checks).`;
                    observations.push(note);
                    emit({ type: 'observation', value: note });
                }

                for (let cycle = 1; cycle <= parsedBody.cycles; cycle += 1) {
                    maybeThrowAborted(req.signal);
                    emit({
                        type: 'status',
                        phase: 'running',
                        message: `Cycle ${cycle}/${parsedBody.cycles}: Codex turn...`,
                    });
                    emit({ type: 'turn_start', speaker: 'Codex', cycle });

                    const codexPrompt = buildCodexPrompt(
                        parsedBody.topic,
                        turns,
                        cycle,
                        parsedBody.cycles,
                        parsedBody.mode
                    );
                    const codexStartedAt = Date.now();
                    const codexText = await runLocalCliChat(parsedBody.codexModel, [
                        { role: 'user', content: codexPrompt },
                    ]);
                    const codexDurationMs = Date.now() - codexStartedAt;
                    const codexTurn: DialogueTurn = {
                        speaker: 'Codex',
                        cycle,
                        durationMs: codexDurationMs,
                        text: codexText.trim(),
                    };
                    turns.push(codexTurn);
                    const codexObservation = `Cycle ${cycle}: Codex response in ${codexDurationMs}ms.`;
                    observations.push(codexObservation);
                    emit({ type: 'turn_complete', ...codexTurn });
                    emit({ type: 'observation', value: codexObservation });

                    maybeThrowAborted(req.signal);
                    emit({
                        type: 'status',
                        phase: 'running',
                        message: `Cycle ${cycle}/${parsedBody.cycles}: Claude turn...`,
                    });
                    emit({ type: 'turn_start', speaker: 'Claude', cycle });

                    const claudePrompt = buildClaudePrompt(
                        parsedBody.topic,
                        turns,
                        cycle,
                        parsedBody.cycles,
                        parsedBody.mode
                    );
                    const claudeStartedAt = Date.now();
                    const claudeText = await runLocalCliChat(parsedBody.claudeModel, [
                        { role: 'user', content: claudePrompt },
                    ]);
                    const claudeDurationMs = Date.now() - claudeStartedAt;
                    const claudeTurn: DialogueTurn = {
                        speaker: 'Claude',
                        cycle,
                        durationMs: claudeDurationMs,
                        text: claudeText.trim(),
                    };
                    turns.push(claudeTurn);
                    const claudeObservation = `Cycle ${cycle}: Claude response in ${claudeDurationMs}ms.`;
                    observations.push(claudeObservation);
                    emit({ type: 'turn_complete', ...claudeTurn });
                    emit({ type: 'observation', value: claudeObservation });
                }

                if (parsedBody.includeFinal) {
                    maybeThrowAborted(req.signal);
                    emit({
                        type: 'status',
                        phase: 'finalizing',
                        message: 'Running final Codex synthesis...',
                    });
                    const finalPrompt = buildFinalSynthesisPrompt(parsedBody.topic, turns, parsedBody.mode);
                    const finalStartedAt = Date.now();
                    finalSynthesis = await runLocalCliChat(parsedBody.codexModel, [
                        { role: 'user', content: finalPrompt },
                    ]);
                    const finalDurationMs = Date.now() - finalStartedAt;
                    const finalObservation = `Final synthesis completed in ${finalDurationMs}ms.`;
                    observations.push(finalObservation);
                    emit({
                        type: 'final_complete',
                        durationMs: finalDurationMs,
                        text: finalSynthesis.trim(),
                    });
                    emit({ type: 'observation', value: finalObservation });
                }

                const transcriptPath = await writeTranscriptFile(
                    parsedBody.topic,
                    turns,
                    observations,
                    finalSynthesis,
                    {
                        cycles: parsedBody.cycles,
                        codexModel: parsedBody.codexModel,
                        claudeModel: parsedBody.claudeModel,
                    }
                );

                emit({
                    type: 'done',
                    totalDurationMs: Date.now() - startedAt,
                    transcriptPath,
                    turns: turns.length,
                    observations,
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                emit({
                    type: 'error',
                    message: message || 'Dialogue run failed.',
                });
            } finally {
                emit({ type: 'end' });
                close();
            }
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
        },
    });
}
