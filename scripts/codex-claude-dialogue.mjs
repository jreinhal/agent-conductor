#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_TOPIC =
  'Best way to move Agent Conductor forward into a polished, market-ready desktop product over the next 30 days.';
const DEFAULT_CYCLES = 2;
const DEFAULT_TIMEOUT_MS = Number(process.env.AC_CLI_TIMEOUT_MS || 180_000);
const DEFAULT_CODEX_MODEL = 'gpt-5.3-codex';
const DEFAULT_CLAUDE_MODEL = 'claude-opus-4.6';
const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), 'output', 'dialogues');

function printUsage() {
  console.log([
    'Usage: node scripts/codex-claude-dialogue.mjs [options]',
    '',
    'Options:',
    '  --topic "<text>"            Topic or question for the dialogue',
    '  --cycles <n>                Number of Codex->Claude cycles (default: 2)',
    '  --codex-model <id>          Codex model id (default: gpt-5.3-codex)',
    '  --claude-model <id>         Claude model id (default: claude-opus-4.6)',
    '  --timeout-ms <n>            Per-turn timeout in ms (default: AC_CLI_TIMEOUT_MS or 180000)',
    '  --output <path>             Output markdown path (default: output/dialogues/<timestamp>.md)',
    '  --verify-only               Run CLI preflight + smoke checks only',
    '  --no-final                  Skip final synthesis turn',
    '  --help                      Show this help',
    '',
    'Examples:',
    '  npm run dialogue:codex-claude -- --topic "How should we launch paid beta?" --cycles 1',
    '  npm run dialogue:codex-claude -- --verify-only',
  ].join('\n'));
}

function parseArgs(argv) {
  const args = {
    topic: DEFAULT_TOPIC,
    cycles: DEFAULT_CYCLES,
    codexModel: DEFAULT_CODEX_MODEL,
    claudeModel: DEFAULT_CLAUDE_MODEL,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    output: '',
    verifyOnly: false,
    includeFinal: true,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (arg === '--verify-only') {
      args.verifyOnly = true;
      continue;
    }
    if (arg === '--no-final') {
      args.includeFinal = false;
      continue;
    }
    if (arg === '--topic' && typeof next === 'string') {
      args.topic = next.trim() || DEFAULT_TOPIC;
      i += 1;
      continue;
    }
    if (arg === '--cycles' && typeof next === 'string') {
      const parsed = Number.parseInt(next, 10);
      if (Number.isFinite(parsed) && parsed > 0) args.cycles = parsed;
      i += 1;
      continue;
    }
    if (arg === '--codex-model' && typeof next === 'string') {
      args.codexModel = next.trim() || DEFAULT_CODEX_MODEL;
      i += 1;
      continue;
    }
    if (arg === '--claude-model' && typeof next === 'string') {
      args.claudeModel = next.trim() || DEFAULT_CLAUDE_MODEL;
      i += 1;
      continue;
    }
    if (arg === '--timeout-ms' && typeof next === 'string') {
      const parsed = Number.parseInt(next, 10);
      if (Number.isFinite(parsed) && parsed >= 10_000) args.timeoutMs = parsed;
      i += 1;
      continue;
    }
    if (arg === '--output' && typeof next === 'string') {
      args.output = next;
      i += 1;
      continue;
    }
  }

  return args;
}

function nowIsoSlug() {
  return new Date().toISOString().replace(/[:]/g, '-').replace(/\..+$/, 'Z');
}

function sanitizePathPart(value) {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 80);
}

function parseJsonObject(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function parseCodexOutput(stdout) {
  let lastMessage = '';
  const lines = stdout.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const payload = JSON.parse(trimmed);
      if (
        payload?.type === 'item.completed' &&
        payload?.item?.type === 'agent_message' &&
        typeof payload?.item?.text === 'string'
      ) {
        lastMessage = payload.item.text.trim();
      }
    } catch {
      // ignore non-json lines
    }
  }

  return lastMessage || stdout.trim();
}

function parseClaudeOutput(stdout) {
  const parsed = parseJsonObject(stdout);
  if (parsed && typeof parsed.result === 'string') {
    return parsed.result.trim();
  }
  return stdout.trim();
}

function runProcess(command, args, stdinInput, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: process.platform === 'win32',
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
          windowsHide: true,
          stdio: 'ignore',
        });
        killer.on('error', () => child.kill('SIGKILL'));
      } else {
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 1500);
      }
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf-8');
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error(`${command} timed out after ${Math.round(timeoutMs / 1000)}s`));
        return;
      }
      resolve({ stdout, stderr, code });
    });

    if (typeof stdinInput === 'string') {
      child.stdin.write(stdinInput);
    }
    child.stdin.end();
  });
}

async function runCodex(modelId, prompt, timeoutMs) {
  const command = process.platform === 'win32' ? 'codex.cmd' : 'codex';
  const args = [
    'exec',
    '--model',
    modelId,
    '--sandbox',
    'read-only',
    '--skip-git-repo-check',
    '--json',
    '-',
  ];

  const result = await runProcess(command, args, prompt, timeoutMs);
  if (result.code !== 0) {
    const details = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n');
    throw new Error(details || `codex exited with code ${result.code}`);
  }

  const output = parseCodexOutput(result.stdout);
  if (!output) {
    throw new Error('codex returned empty output');
  }
  return output;
}

async function runClaude(modelId, prompt, timeoutMs) {
  const command = process.platform === 'win32' ? 'claude' : 'claude';
  const args = [
    '--no-session-persistence',
    '-p',
    '--output-format',
    'json',
    '--model',
    modelId.replace(/\./g, '-'),
  ];

  const result = await runProcess(command, args, prompt, timeoutMs);
  if (result.code !== 0) {
    const details = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n');
    throw new Error(details || `claude exited with code ${result.code}`);
  }

  const output = parseClaudeOutput(result.stdout);
  if (!output) {
    throw new Error('claude returned empty output');
  }
  return output;
}

function buildTranscriptBlock(entries) {
  if (entries.length === 0) return '(no prior turns)';
  return entries
    .map((entry, index) => `Turn ${index + 1} (${entry.speaker}):\n${entry.text}`)
    .join('\n\n---\n\n');
}

function buildCodexPrompt(topic, entries, cycle, totalCycles) {
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

function buildClaudePrompt(topic, entries, cycle, totalCycles) {
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

function buildFinalSynthesisPrompt(topic, entries) {
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

function toMarkdown(topic, settings, entries, finalSynthesis, observations) {
  const lines = [];
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

  entries.forEach((entry, idx) => {
    lines.push(`### Turn ${idx + 1} - ${entry.speaker} (${entry.durationMs}ms)`);
    lines.push('');
    lines.push(entry.text);
    lines.push('');
  });

  if (Array.isArray(observations) && observations.length > 0) {
    lines.push('## Retrospective Signals');
    lines.push('');
    observations.forEach((item) => {
      lines.push(`- ${item}`);
    });
    lines.push('');
  }

  if (finalSynthesis) {
    lines.push('## Final Synthesis (Codex)');
    lines.push('');
    lines.push(finalSynthesis);
    lines.push('');
  }

  return lines.join('\n');
}

async function preflightChecks(settings) {
  console.log('[preflight] Checking CLI executables...');
  await runProcess(process.platform === 'win32' ? 'codex.cmd' : 'codex', ['--version'], undefined, 30_000);
  await runProcess(process.platform === 'win32' ? 'claude' : 'claude', ['--version'], undefined, 30_000);
  console.log('[preflight] Executables are available.');

  console.log('[preflight] Running smoke prompts...');
  const codexSmoke = await runCodex(
    settings.codexModel,
    'Reply with exactly: READY',
    Math.min(settings.timeoutMs, 90_000)
  );
  const claudeSmoke = await runClaude(
    settings.claudeModel,
    'Reply with exactly: READY',
    Math.min(settings.timeoutMs, 90_000)
  );

  if (!/ready/i.test(codexSmoke)) {
    throw new Error(`Codex smoke check failed. Output: ${codexSmoke.slice(0, 200)}`);
  }
  if (!/ready/i.test(claudeSmoke)) {
    throw new Error(`Claude smoke check failed. Output: ${claudeSmoke.slice(0, 200)}`);
  }
  console.log('[preflight] Smoke checks passed.');
}

async function main() {
  const settings = parseArgs(process.argv.slice(2));
  const observations = [];

  if (settings.help) {
    printUsage();
    return;
  }

  const preflightStart = Date.now();
  await preflightChecks(settings);
  observations.push(`Preflight completed in ${Date.now() - preflightStart}ms (executables + smoke checks).`);
  if (settings.verifyOnly) {
    console.log('[done] Verify-only mode complete.');
    return;
  }

  const entries = [];
  for (let cycle = 1; cycle <= settings.cycles; cycle += 1) {
    console.log(`[dialogue] Cycle ${cycle}/${settings.cycles}: Codex turn...`);
    const codexPrompt = buildCodexPrompt(settings.topic, entries, cycle, settings.cycles);
    const codexStartedAt = Date.now();
    const codexText = await runCodex(settings.codexModel, codexPrompt, settings.timeoutMs);
    const codexDurationMs = Date.now() - codexStartedAt;
    entries.push({ speaker: 'Codex', text: codexText, durationMs: codexDurationMs });
    observations.push(`Cycle ${cycle}: Codex response in ${codexDurationMs}ms.`);

    console.log(`[dialogue] Cycle ${cycle}/${settings.cycles}: Claude turn...`);
    const claudePrompt = buildClaudePrompt(settings.topic, entries, cycle, settings.cycles);
    const claudeStartedAt = Date.now();
    const claudeText = await runClaude(settings.claudeModel, claudePrompt, settings.timeoutMs);
    const claudeDurationMs = Date.now() - claudeStartedAt;
    entries.push({ speaker: 'Claude', text: claudeText, durationMs: claudeDurationMs });
    observations.push(`Cycle ${cycle}: Claude response in ${claudeDurationMs}ms.`);
  }

  let finalSynthesis = '';
  if (settings.includeFinal) {
    console.log('[dialogue] Running final Codex synthesis...');
    const finalPrompt = buildFinalSynthesisPrompt(settings.topic, entries);
    const finalStartedAt = Date.now();
    finalSynthesis = await runCodex(settings.codexModel, finalPrompt, settings.timeoutMs);
    const finalDurationMs = Date.now() - finalStartedAt;
    observations.push(`Final synthesis completed in ${finalDurationMs}ms.`);
  }

  const topicSlug = sanitizePathPart(settings.topic.toLowerCase().replace(/\s+/g, '-'));
  const outputPath =
    settings.output ||
    path.join(DEFAULT_OUTPUT_DIR, `${nowIsoSlug()}-${topicSlug || 'dialogue'}.md`);

  await mkdir(path.dirname(outputPath), { recursive: true });
  const markdown = toMarkdown(settings.topic, settings, entries, finalSynthesis, observations);
  await writeFile(outputPath, markdown, 'utf-8');

  console.log('[done] Dialogue complete.');
  console.log(`[done] Transcript: ${outputPath}`);
  if (finalSynthesis) {
    console.log('\n----- Final Synthesis -----\n');
    console.log(finalSynthesis);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[error] ${message}`);
  console.error('Hint: ensure both CLIs are authenticated (`codex login`, `claude login`).');
  process.exit(1);
});
