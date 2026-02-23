#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const DEFAULT_CODEX_MODEL = 'gpt-5.3-codex';
const DEFAULT_CLAUDE_MODEL = 'claude-opus-4.6';
const DEFAULT_TIMEOUT_MS = Number(process.env.AC_CLI_TIMEOUT_MS || 180_000);
const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), 'output', 'dialogues');
const DEFAULT_PROTOCOL_DIR = path.join(process.cwd(), '.data', 'consensus-bus');
const DEFAULT_MEMORY_COMPACT_INTERVAL = Number(process.env.AC_MEMORY_COMPACT_INTERVAL || 4);
const DEFAULT_MEMORY_MAX_CHARS = Number(process.env.AC_MEMORY_MAX_CHARS || 7000);
const DEFAULT_CLAUDE_INIT_TIMEOUT_MS = Number(process.env.AC_CLAUDE_INIT_TIMEOUT_MS || 420_000);

function printUsage() {
  console.log([
    'Usage: node scripts/dual-research-consensus.mjs [options]',
    '',
    'Options:',
    '  --question "<text>"         Run one question non-interactively',
    '  --codex-model <id>          Codex model id (default: gpt-5.3-codex)',
    '  --claude-model <id>         Claude model id (default: claude-opus-4.6)',
    '  --timeout-ms <n>            Per-step timeout (default: AC_CLI_TIMEOUT_MS or 180000)',
    '  --output <path>             Output markdown path',
    '  --protocol-dir <path>       Run as file-protocol broker (polling questions.jsonl)',
    '  --poll-ms <n>               Poll interval for broker mode (default: 1000)',
    `  --memory-compact-interval <n>  Rounds between memory compaction (default: ${DEFAULT_MEMORY_COMPACT_INTERVAL})`,
    `  --memory-max-chars <n>         Trigger compaction when history exceeds chars (default: ${DEFAULT_MEMORY_MAX_CHARS})`,
    `  --claude-init-timeout-ms <n>   Timeout for initial Claude /init (default: ${DEFAULT_CLAUDE_INIT_TIMEOUT_MS})`,
    '  --no-claude-init            Skip initial Claude /init action',
    '  --no-preflight              Skip smoke checks',
    '  --verify-only               Run preflight only',
    '  --help                      Show this help',
    '',
    'Interactive commands:',
    '  :q / quit / exit            Exit',
    '  :status                     Show run status',
    '  :help                       Show commands',
    '',
    'Example:',
    '  npm run dialogue:consensus -- --question "What pricing model should we launch with?"',
  ].join('\n'));
}

function parseArgs(argv) {
  const args = {
    question: '',
    codexModel: DEFAULT_CODEX_MODEL,
    claudeModel: DEFAULT_CLAUDE_MODEL,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    output: '',
    protocolDir: '',
    pollMs: 1000,
    memoryCompactInterval: DEFAULT_MEMORY_COMPACT_INTERVAL,
    memoryMaxChars: DEFAULT_MEMORY_MAX_CHARS,
    claudeInit: true,
    claudeInitTimeoutMs: DEFAULT_CLAUDE_INIT_TIMEOUT_MS,
    runPreflight: true,
    verifyOnly: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (arg === '--no-preflight') {
      args.runPreflight = false;
      continue;
    }
    if (arg === '--no-claude-init') {
      args.claudeInit = false;
      continue;
    }
    if (arg === '--verify-only') {
      args.verifyOnly = true;
      continue;
    }
    if (arg === '--question' && typeof next === 'string') {
      args.question = next.trim();
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
    if (arg === '--protocol-dir' && typeof next === 'string') {
      args.protocolDir = next.trim();
      i += 1;
      continue;
    }
    if (arg === '--poll-ms' && typeof next === 'string') {
      const parsed = Number.parseInt(next, 10);
      if (Number.isFinite(parsed) && parsed >= 250) args.pollMs = parsed;
      i += 1;
      continue;
    }
    if (arg === '--memory-compact-interval' && typeof next === 'string') {
      const parsed = Number.parseInt(next, 10);
      if (Number.isFinite(parsed) && parsed >= 1) args.memoryCompactInterval = parsed;
      i += 1;
      continue;
    }
    if (arg === '--memory-max-chars' && typeof next === 'string') {
      const parsed = Number.parseInt(next, 10);
      if (Number.isFinite(parsed) && parsed >= 1200) args.memoryMaxChars = parsed;
      i += 1;
      continue;
    }
    if (arg === '--claude-init-timeout-ms' && typeof next === 'string') {
      const parsed = Number.parseInt(next, 10);
      if (Number.isFinite(parsed) && parsed >= 60_000) args.claudeInitTimeoutMs = parsed;
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

function compact(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldAnimateActivity() {
  return Boolean(process.stdout.isTTY) && process.env.CI !== 'true';
}

function formatActivityBar(tick, width = 14) {
  const safeWidth = Math.max(8, width);
  const pos = tick % safeWidth;
  let bar = '';
  for (let i = 0; i < safeWidth; i += 1) {
    bar += i === pos ? '#' : '.';
  }
  return `[${bar}]`;
}

async function withActivity(label, task) {
  const startedAt = Date.now();
  if (!shouldAnimateActivity()) {
    console.log(`[activity] ${label}...`);
    const result = await task();
    const elapsed = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    console.log(`[activity] ${label} done (${elapsed}s)`);
    return result;
  }

  const spinner = ['|', '/', '-', '\\'];
  let tick = 0;
  const interval = setInterval(() => {
    tick += 1;
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    const spin = spinner[tick % spinner.length];
    const bar = formatActivityBar(tick);
    process.stdout.write(`\r[activity] ${label} ${spin} ${bar} ${elapsed}s`);
  }, 220);

  try {
    const result = await task();
    clearInterval(interval);
    const elapsed = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    process.stdout.write(`\r[activity] ${label} done ${formatActivityBar(tick)} ${elapsed}s\n`);
    return result;
  } catch (error) {
    clearInterval(interval);
    const elapsed = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    process.stdout.write(`\r[activity] ${label} failed ${formatActivityBar(tick)} ${elapsed}s\n`);
    throw error;
  }
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

    if (typeof stdinInput === 'string') child.stdin.write(stdinInput);
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
  if (!output) throw new Error('codex returned empty output');
  return output;
}

async function runClaude(modelId, prompt, timeoutMs, activityLabel = 'Claude') {
  const command = process.platform === 'win32' ? 'claude' : 'claude';
  const args = [
    '--no-session-persistence',
    '-p',
    '--output-format',
    'json',
    '--model',
    modelId.replace(/\./g, '-'),
  ];
  const result = await withActivity(activityLabel, () => runProcess(command, args, prompt, timeoutMs));
  if (result.code !== 0) {
    const details = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n');
    throw new Error(details || `claude exited with code ${result.code}`);
  }
  const output = parseClaudeOutput(result.stdout);
  if (!output) throw new Error('claude returned empty output');
  return output;
}

function parseStatusLine(text) {
  const firstLine = text.split(/\r?\n/)[0] || '';
  if (/status:\s*approved/i.test(firstLine)) return 'approved';
  if (/status:\s*revise/i.test(firstLine)) return 'revise';
  return 'unknown';
}

function stripStatusLine(text) {
  return text.replace(/^status:\s*(approved|revise)\s*\r?\n?/i, '').trim();
}

function buildHistoryContext(session, maxRounds = 5) {
  const rounds = session.rounds || [];
  const memory = session.memory?.compacted?.trim() || '';
  if (rounds.length === 0 && !memory) return 'No prior questions yet.';

  const blocks = [];
  if (memory) {
    blocks.push(`Compacted memory v${session.memory?.version || 1}:\n${memory}`);
  }

  const recentRoundWindow = memory ? Math.min(3, maxRounds) : maxRounds;
  const recent = rounds.slice(-recentRoundWindow);
  if (recent.length > 0) {
    const recentBlock = recent
      .map((round, idx) => {
        const number = rounds.length - recent.length + idx + 1;
        return [
          `Q${number}: ${round.question}`,
          `Consensus: ${compact(round.finalConsensus).slice(0, 520)}`,
        ].join('\n');
      })
      .join('\n\n---\n\n');
    blocks.push(recentBlock);
  }

  return blocks.join('\n\n---\n\n');
}

function estimateContextChars(session) {
  const recentRounds = session.rounds.slice(-10);
  const recentChars = recentRounds
    .map((round) => `${round.question}\n${round.finalConsensus}`)
    .join('\n')
    .length;
  const memoryChars = (session.memory?.compacted || '').length;
  return recentChars + memoryChars;
}

function getCompactionTrigger(session, settings) {
  if (session.rounds.length === 0) return '';
  const last = session.memory?.lastCompactedRound || 0;
  const roundsSinceCompaction = session.rounds.length - last;
  if (roundsSinceCompaction >= settings.memoryCompactInterval) return 'interval';
  if (estimateContextChars(session) >= settings.memoryMaxChars) return 'size';
  return '';
}

function buildMemorySourceContext(session, maxRounds = 8) {
  const rounds = session.rounds.slice(-maxRounds);
  if (rounds.length === 0) return 'No rounds yet.';
  return rounds
    .map((round, idx) => {
      const number = session.rounds.length - rounds.length + idx + 1;
      return [
        `Q${number}: ${round.question}`,
        `Final consensus: ${compact(round.finalConsensus).slice(0, 700)}`,
      ].join('\n');
    })
    .join('\n\n---\n\n');
}

function buildMemoryDraftPrompt(session) {
  const priorMemory = session.memory?.compacted?.trim()
    ? session.memory.compacted.trim()
    : 'No prior compacted memory.';
  return [
    'You are Codex maintaining long-running shared memory for an indefinite multi-question dialogue.',
    'Goal: compact context while preserving decisions, constraints, unresolved questions, and user preferences.',
    '',
    `Existing compacted memory:\n${priorMemory}`,
    '',
    `Recent rounds to compress:\n${buildMemorySourceContext(session)}`,
    '',
    'Instructions:',
    '- Do not reveal hidden internal chain-of-thought. Use concise public summaries only.',
    '- Remove stale or redundant details.',
    '- Preserve only information likely needed for future questions.',
    '- Return exactly this markdown shape:',
    '  1) Durable Decisions:',
    '  2) User Preferences / Constraints:',
    '  3) Open Threads:',
    '  4) Evidence to Re-check Later:',
    '  5) Dropped As Low Value:',
    '- Keep under 420 words.',
  ].join('\n');
}

function buildMemoryReviewPrompt(draft) {
  return [
    'You are Claude reviewing a proposed shared-memory compaction draft.',
    '',
    `Draft memory:\n${draft}`,
    '',
    'Return exactly one status line first:',
    '- STATUS: APPROVED',
    'or',
    '- STATUS: REVISE',
    '',
    'Then provide the final memory block in the same shape:',
    '1) Durable Decisions:',
    '2) User Preferences / Constraints:',
    '3) Open Threads:',
    '4) Evidence to Re-check Later:',
    '5) Dropped As Low Value:',
    'Do not reveal hidden internal chain-of-thought.',
    'Keep under 420 words.',
  ].join('\n');
}

function buildMemoryFinalMergePrompt(draft, claudeReview) {
  return [
    'You are Codex finalizing shared-memory compaction with Claude feedback.',
    '',
    `Codex draft:\n${draft}`,
    '',
    `Claude review:\n${claudeReview}`,
    '',
    'Produce final compacted memory in this exact shape:',
    '1) Durable Decisions:',
    '2) User Preferences / Constraints:',
    '3) Open Threads:',
    '4) Evidence to Re-check Later:',
    '5) Dropped As Low Value:',
    'Do not reveal hidden internal chain-of-thought.',
    'Keep under 420 words.',
  ].join('\n');
}

async function runMemoryCompaction(session, settings, trigger) {
  const startedAt = Date.now();
  const metrics = {
    codexDraftMs: 0,
    claudeReviewMs: 0,
    codexFinalMs: 0,
    totalMs: 0,
    claudeStatus: 'unknown',
  };

  let t = Date.now();
  const codexDraft = await runCodex(
    settings.codexModel,
    buildMemoryDraftPrompt(session),
    settings.timeoutMs
  );
  metrics.codexDraftMs = Date.now() - t;

  t = Date.now();
  const claudeReview = await runClaude(
    settings.claudeModel,
    buildMemoryReviewPrompt(codexDraft),
    settings.timeoutMs,
    'Claude memory review'
  );
  metrics.claudeReviewMs = Date.now() - t;
  metrics.claudeStatus = parseStatusLine(claudeReview);

  let finalMemory = stripStatusLine(claudeReview);
  if (metrics.claudeStatus !== 'approved') {
    t = Date.now();
    finalMemory = await runCodex(
      settings.codexModel,
      buildMemoryFinalMergePrompt(codexDraft, claudeReview),
      settings.timeoutMs
    );
    metrics.codexFinalMs = Date.now() - t;
  }

  metrics.totalMs = Date.now() - startedAt;
  const nextVersion = (session.memory?.version || 0) + 1;
  const compacted = compact(finalMemory).slice(0, 8000);
  const at = new Date().toISOString();

  session.memory.version = nextVersion;
  session.memory.compacted = compacted;
  session.memory.lastCompactedRound = session.rounds.length;
  session.memory.updatedAt = at;
  if (!Array.isArray(session.memory.updates)) session.memory.updates = [];
  session.memory.updates.push({
    version: nextVersion,
    trigger,
    at,
    sourceRounds: session.rounds.length,
    metrics,
  });
  if (session.memory.updates.length > 20) {
    session.memory.updates = session.memory.updates.slice(-20);
  }

  return {
    version: nextVersion,
    trigger,
    at,
    sourceRounds: session.rounds.length,
    codexDraft,
    claudeReview,
    finalMemory: compacted,
    metrics,
  };
}

async function maybeCompactSessionMemory(session, settings) {
  const trigger = getCompactionTrigger(session, settings);
  if (!trigger) return { status: 'skipped' };

  console.log(`[memory] Compaction triggered (${trigger}) at round ${session.rounds.length}...`);
  try {
    const update = await runMemoryCompaction(session, settings, trigger);
    return { status: 'compacted', update };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'failed', trigger, error: message || 'Unknown compaction error' };
  }
}

function buildInitialPrompt(modelName, question, historyContext) {
  return [
    `You are ${modelName} in a two-CLI collaboration with another model.`,
    'Goal: answer the user question independently before reconciliation.',
    '',
    `User question:\n${question}`,
    '',
    `Prior accepted consensus context:\n${historyContext}`,
    '',
    'Instructions:',
    '- If tooling/web access is available, do lightweight research. If not, state that briefly.',
    '- Do not reveal hidden internal chain-of-thought. Provide a concise public reasoning summary only.',
    '- Return exactly this markdown shape:',
    '  1) Answer:',
    '  2) Reasoning Summary:',
    '  3) Evidence:',
    '  4) Assumptions:',
    '  5) Risks/Unknowns:',
    '  6) Team Delegations (optional):',
    '  7) Confidence: X/100',
    '- You may spawn a specialist team internally at any time (for example: Research, Product, Engineering, Risk) and summarize each sub-agent in one line.',
    '- Keep total response under 320 words.',
  ].join('\n');
}

function buildComparePrompt(modelName, question, ownAnswer, peerLabel, peerAnswer) {
  return [
    `You are ${modelName}.`,
    'Now compare your answer with the other model and revise.',
    '',
    `Question:\n${question}`,
    '',
    `Your prior answer:\n${ownAnswer}`,
    '',
    `${peerLabel} answer:\n${peerAnswer}`,
    '',
    'Instructions:',
    '- Do not reveal hidden internal chain-of-thought. Provide a concise public reasoning summary only.',
    '- Briefly compare/contrast top agreements and disagreements.',
    '- Produce a revised answer incorporating the best points from both.',
    '- Return exactly this markdown shape:',
    '  1) Agreements:',
    '  2) Disagreements:',
    '  3) Revised Answer:',
    '  4) Reasoning Summary:',
    '  5) Evidence:',
    '  6) Change from Prior: <one sentence>',
    '  7) Team Delegations (optional):',
    '  8) Confidence: X/100',
    '- You may spawn a specialist team internally at any time and include concise sub-agent outputs.',
    '- Keep total response under 340 words.',
  ].join('\n');
}

function buildConsensusDraftPrompt(question, codexRevised, claudeRevised) {
  return [
    'You are Codex preparing a joint consensus draft with Claude.',
    `Question:\n${question}`,
    '',
    `Codex revised answer:\n${codexRevised}`,
    '',
    `Claude revised answer:\n${claudeRevised}`,
    '',
    'Output format:',
    '1) Consensus Answer:',
    '2) Agreements:',
    '3) Key Tradeoffs:',
    '4) Remaining Uncertainty:',
    '5) Rationale Summary:',
    '6) Team Delegations Used (optional):',
    '7) Confidence: X/100',
    '',
    'Do not reveal hidden internal chain-of-thought. Use concise public rationale only.',
    'Keep under 340 words.',
  ].join('\n');
}

function buildClaudeReviewPrompt(question, draft) {
  return [
    'You are Claude reviewing a joint consensus draft from Codex.',
    `Question:\n${question}`,
    '',
    `Consensus draft:\n${draft}`,
    '',
    'Return exactly one status line first:',
    '- STATUS: APPROVED',
    'or',
    '- STATUS: REVISE',
    '',
    'Then provide the final consensus wording in this shape:',
    '1) Final Consensus Answer:',
    '2) What Changed (if any):',
    '3) Rationale Summary:',
    '4) Team Delegations Used (optional):',
    '5) Confidence: X/100',
    'If REVISE, include the corrected final wording directly (not just comments).',
    'Do not reveal hidden internal chain-of-thought. Use concise public rationale only.',
    'Keep under 280 words.',
  ].join('\n');
}

function buildFinalMergePrompt(question, draft, claudeReview) {
  return [
    'You are Codex finalizing consensus with Claude.',
    `Question:\n${question}`,
    '',
    `Current draft:\n${draft}`,
    '',
    `Claude review:\n${claudeReview}`,
    '',
    'Produce the final agreed consensus in this shape:',
    '1) Final Consensus Answer:',
    '2) Rationale Summary:',
    '3) Evidence/References:',
    '4) Remaining Uncertainty:',
    '5) Team Delegations Used (optional):',
    '6) Confidence: X/100',
    'Do not reveal hidden internal chain-of-thought. Use concise public rationale only.',
    'Keep under 300 words.',
  ].join('\n');
}

function isApprovedByClaude(text) {
  return parseStatusLine(text) === 'approved';
}

function jaccardSimilarity(a, b) {
  const tokenize = (value) =>
    new Set(
      value
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((token) => token.length >= 3)
    );
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  const intersection = [...setA].filter((token) => setB.has(token)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

function buildRoundMarkdown(round, idx) {
  const number = idx + 1;
  const lines = [];
  lines.push(`## Question ${number}`);
  lines.push('');
  lines.push(`### User Question`);
  lines.push(round.question);
  lines.push('');
  lines.push(`### Codex Initial (${round.metrics.codexInitialMs}ms)`);
  lines.push(round.codexInitial);
  lines.push('');
  lines.push(`### Claude Initial (${round.metrics.claudeInitialMs}ms)`);
  lines.push(round.claudeInitial);
  lines.push('');
  lines.push(`### Codex Revised (${round.metrics.codexCompareMs}ms)`);
  lines.push(round.codexRevised);
  lines.push('');
  lines.push(`### Claude Revised (${round.metrics.claudeCompareMs}ms)`);
  lines.push(round.claudeRevised);
  lines.push('');
  lines.push(`### Consensus Draft (${round.metrics.consensusDraftMs}ms)`);
  lines.push(round.consensusDraft);
  lines.push('');
  lines.push(`### Claude Review (${round.metrics.claudeReviewMs}ms)`);
  lines.push(round.claudeReview);
  lines.push('');
  lines.push(`### Final Consensus (${round.metrics.finalMergeMs}ms)`);
  lines.push(round.finalConsensus);
  lines.push('');
  lines.push('### Retrospective Signals');
  lines.push(`- Codex initial latency: ${round.metrics.codexInitialMs}ms`);
  lines.push(`- Claude initial latency: ${round.metrics.claudeInitialMs}ms`);
  lines.push(`- Codex revised latency: ${round.metrics.codexCompareMs}ms`);
  lines.push(`- Claude revised latency: ${round.metrics.claudeCompareMs}ms`);
  lines.push(`- Consensus alignment score (Jaccard): ${round.metrics.alignmentScore.toFixed(2)}`);
  lines.push(`- Claude status: ${round.metrics.claudeStatus}`);
  lines.push(`- Total question duration: ${round.metrics.totalMs}ms`);
  if (round.memoryCompaction?.status === 'compacted') {
    lines.push(`- Memory compaction: v${round.memoryCompaction.update.version} (${round.memoryCompaction.update.trigger})`);
    lines.push(`- Memory compaction latency: ${round.memoryCompaction.update.metrics.totalMs}ms`);
  } else if (round.memoryCompaction?.status === 'failed') {
    lines.push(`- Memory compaction: failed (${round.memoryCompaction.trigger})`);
    lines.push(`- Memory compaction error: ${round.memoryCompaction.error}`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderSessionMarkdown(session) {
  const lines = [];
  lines.push('# Dual-CLI Research Consensus Session');
  lines.push('');
  lines.push(`- started_at: ${session.startedAt}`);
  lines.push(`- codex_model: ${session.codexModel}`);
  lines.push(`- claude_model: ${session.claudeModel}`);
  lines.push(`- rounds: ${session.rounds.length}`);
  lines.push(`- memory_compaction_interval: ${session.memoryCompactInterval}`);
  lines.push(`- memory_max_chars: ${session.memoryMaxChars}`);
  lines.push('');
  if (session.memory?.compacted) {
    lines.push('## Compacted Context Memory');
    lines.push('');
    lines.push(`- version: ${session.memory.version}`);
    lines.push(`- updated_at: ${session.memory.updatedAt}`);
    lines.push(`- source_round: ${session.memory.lastCompactedRound}`);
    lines.push('');
    lines.push(session.memory.compacted);
    lines.push('');
  }
  session.rounds.forEach((round, idx) => {
    lines.push(buildRoundMarkdown(round, idx));
  });
  return lines.join('\n');
}

async function runClaudeInit(settings) {
  if (!settings.claudeInit) return;
  console.log('[init] Running Claude /init in current working directory...');
  try {
    const result = await withActivity(
      'Claude /init',
      () => runProcess(
        process.platform === 'win32' ? 'claude' : 'claude',
        ['-p', '/init'],
        undefined,
        settings.claudeInitTimeoutMs
      )
    );
    if (result.code !== 0) {
      const details = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n');
      throw new Error(details || `claude /init exited with code ${result.code}`);
    }
    console.log('[init] Claude /init complete.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/timed out/i.test(message)) {
      console.warn(
        `[warn] Claude /init timed out after ${Math.round(settings.claudeInitTimeoutMs / 1000)}s. Continuing.`
      );
      return;
    }
    throw error;
  }
}

async function preflight(settings) {
  console.log('[preflight] Checking executables...');
  await runProcess(process.platform === 'win32' ? 'codex.cmd' : 'codex', ['--version'], undefined, 30_000);
  await runProcess(process.platform === 'win32' ? 'claude' : 'claude', ['--version'], undefined, 30_000);
  console.log('[preflight] Running smoke checks...');
  const codexSmoke = await runCodex(settings.codexModel, 'Reply with exactly: READY', 90_000);
  const claudeSmoke = await runClaude(
    settings.claudeModel,
    'Reply with exactly: READY',
    90_000,
    'Claude smoke check'
  );
  if (!/ready/i.test(codexSmoke)) throw new Error(`Codex smoke failed: ${codexSmoke.slice(0, 140)}`);
  if (!/ready/i.test(claudeSmoke)) throw new Error(`Claude smoke failed: ${claudeSmoke.slice(0, 140)}`);
  console.log('[preflight] Passed.');
}

async function runOneQuestion(question, session, settings) {
  const startedAt = Date.now();
  const historyContext = buildHistoryContext(session);
  const metrics = {
    codexInitialMs: 0,
    claudeInitialMs: 0,
    codexCompareMs: 0,
    claudeCompareMs: 0,
    consensusDraftMs: 0,
    claudeReviewMs: 0,
    finalMergeMs: 0,
    alignmentScore: 0,
    claudeStatus: 'unknown',
    totalMs: 0,
  };

  console.log('[run] Codex initial...');
  let t = Date.now();
  const codexInitial = await runCodex(
    settings.codexModel,
    buildInitialPrompt('Codex', question, historyContext),
    settings.timeoutMs
  );
  metrics.codexInitialMs = Date.now() - t;

  console.log('[run] Claude initial...');
  t = Date.now();
  const claudeInitial = await runClaude(
    settings.claudeModel,
    buildInitialPrompt('Claude', question, historyContext),
    settings.timeoutMs,
    'Claude initial'
  );
  metrics.claudeInitialMs = Date.now() - t;
  metrics.alignmentScore = jaccardSimilarity(codexInitial, claudeInitial);

  console.log('[run] Codex compare/revise...');
  t = Date.now();
  const codexRevised = await runCodex(
    settings.codexModel,
    buildComparePrompt('Codex', question, codexInitial, 'Claude', claudeInitial),
    settings.timeoutMs
  );
  metrics.codexCompareMs = Date.now() - t;

  console.log('[run] Claude compare/revise...');
  t = Date.now();
  const claudeRevised = await runClaude(
    settings.claudeModel,
    buildComparePrompt('Claude', question, claudeInitial, 'Codex', codexInitial),
    settings.timeoutMs,
    'Claude compare/revise'
  );
  metrics.claudeCompareMs = Date.now() - t;

  console.log('[run] Codex consensus draft...');
  t = Date.now();
  const consensusDraft = await runCodex(
    settings.codexModel,
    buildConsensusDraftPrompt(question, codexRevised, claudeRevised),
    settings.timeoutMs
  );
  metrics.consensusDraftMs = Date.now() - t;

  console.log('[run] Claude consensus review...');
  t = Date.now();
  const claudeReview = await runClaude(
    settings.claudeModel,
    buildClaudeReviewPrompt(question, consensusDraft),
    settings.timeoutMs,
    'Claude consensus review'
  );
  metrics.claudeReviewMs = Date.now() - t;
  metrics.claudeStatus = isApprovedByClaude(claudeReview) ? 'approved' : 'revise';

  let finalConsensus = stripStatusLine(claudeReview);
  if (!isApprovedByClaude(claudeReview)) {
    console.log('[run] Codex final merge...');
    t = Date.now();
    finalConsensus = await runCodex(
      settings.codexModel,
      buildFinalMergePrompt(question, consensusDraft, claudeReview),
      settings.timeoutMs
    );
    metrics.finalMergeMs = Date.now() - t;
  } else {
    metrics.finalMergeMs = 0;
  }

  metrics.totalMs = Date.now() - startedAt;

  return {
    question,
    codexInitial,
    claudeInitial,
    codexRevised,
    claudeRevised,
    consensusDraft,
    claudeReview,
    finalConsensus,
    metrics,
    finishedAt: new Date().toISOString(),
  };
}

async function saveSessionMarkdown(session, outputPath) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const markdown = renderSessionMarkdown(session);
  await writeFile(outputPath, markdown, 'utf-8');
}

function getProtocolPaths(protocolDir) {
  const root = path.resolve(protocolDir || DEFAULT_PROTOCOL_DIR);
  return {
    root,
    questionsPath: path.join(root, 'questions.jsonl'),
    eventsPath: path.join(root, 'events.jsonl'),
    statePath: path.join(root, 'state.json'),
    transcriptPath: path.join(root, 'transcript.md'),
  };
}

async function ensureProtocolFiles(paths) {
  await mkdir(paths.root, { recursive: true });

  try {
    await readFile(paths.questionsPath, 'utf-8');
  } catch {
    await writeFile(paths.questionsPath, '', 'utf-8');
  }

  try {
    await readFile(paths.eventsPath, 'utf-8');
  } catch {
    await writeFile(paths.eventsPath, '', 'utf-8');
  }

  try {
    await readFile(paths.statePath, 'utf-8');
  } catch {
    await writeFile(
      paths.statePath,
      JSON.stringify({ processedQuestionIds: [], updatedAt: new Date().toISOString() }, null, 2),
      'utf-8'
    );
  }
}

async function readProtocolState(paths) {
  try {
    const raw = await readFile(paths.statePath, 'utf-8');
    const parsed = JSON.parse(raw);
    const ids = Array.isArray(parsed?.processedQuestionIds)
      ? parsed.processedQuestionIds.filter((id) => typeof id === 'string')
      : [];
    return { processedQuestionIds: ids };
  } catch {
    return { processedQuestionIds: [] };
  }
}

async function writeProtocolState(paths, idsSet) {
  const state = {
    processedQuestionIds: [...idsSet],
    updatedAt: new Date().toISOString(),
  };
  await writeFile(paths.statePath, JSON.stringify(state, null, 2), 'utf-8');
}

async function appendProtocolEvent(paths, event) {
  const payload = {
    ...event,
    at: new Date().toISOString(),
  };
  await appendFile(paths.eventsPath, `${JSON.stringify(payload)}\n`, 'utf-8');
}

function parseQuestionLine(line) {
  if (!line.trim()) return null;
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }

  const id =
    typeof parsed?.id === 'string' && parsed.id.trim()
      ? parsed.id.trim()
      : '';
  const question =
    typeof parsed?.question === 'string'
      ? parsed.question
      : typeof parsed?.payload?.question === 'string'
      ? parsed.payload.question
      : '';

  if (!id || !question.trim()) return null;
  return {
    id,
    question: question.trim(),
    submittedAt:
      typeof parsed?.submittedAt === 'string' && parsed.submittedAt.trim()
        ? parsed.submittedAt
        : new Date().toISOString(),
  };
}

async function readQueuedQuestions(paths) {
  try {
    const raw = await readFile(paths.questionsPath, 'utf-8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const items = [];
    for (const line of lines) {
      const event = parseQuestionLine(line);
      if (event) items.push(event);
    }
    return items;
  } catch {
    return [];
  }
}

async function runProtocolBroker(session, settings, outputPath, protocolPaths) {
  await ensureProtocolFiles(protocolPaths);
  const state = await readProtocolState(protocolPaths);
  const processedQuestionIds = new Set(state.processedQuestionIds);

  await appendProtocolEvent(protocolPaths, {
    type: 'BROKER_STARTED',
    codexModel: settings.codexModel,
    claudeModel: settings.claudeModel,
    memoryCompactInterval: settings.memoryCompactInterval,
    memoryMaxChars: settings.memoryMaxChars,
    outputPath,
  });

  console.log('Consensus broker started.');
  console.log(`Protocol dir: ${protocolPaths.root}`);
  console.log(`Questions file: ${protocolPaths.questionsPath}`);
  console.log(`Events file: ${protocolPaths.eventsPath}`);
  console.log(`Transcript: ${outputPath}`);
  console.log('Append JSON lines to questions.jsonl to submit questions.');

  let stopRequested = false;
  const stop = () => {
    stopRequested = true;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  try {
    while (!stopRequested) {
      const queued = await readQueuedQuestions(protocolPaths);
      const pending = queued.filter((item) => !processedQuestionIds.has(item.id));

      for (const item of pending) {
        if (stopRequested) break;
        processedQuestionIds.add(item.id);

        await appendProtocolEvent(protocolPaths, {
          type: 'QUESTION_STARTED',
          questionId: item.id,
          question: item.question,
          submittedAt: item.submittedAt,
        });

        try {
          const round = await runOneQuestion(item.question, session, settings);
          session.rounds.push(round);
          const memoryResult = await maybeCompactSessionMemory(session, settings);
          if (memoryResult.status !== 'skipped') {
            round.memoryCompaction = memoryResult;
          }
          await saveSessionMarkdown(session, outputPath);
          await writeFile(protocolPaths.transcriptPath, renderSessionMarkdown(session), 'utf-8');

          if (memoryResult.status === 'compacted') {
            await appendProtocolEvent(protocolPaths, {
              type: 'MEMORY_COMPACTED',
              questionId: item.id,
              version: memoryResult.update.version,
              trigger: memoryResult.update.trigger,
              metrics: memoryResult.update.metrics,
            });
          } else if (memoryResult.status === 'failed') {
            await appendProtocolEvent(protocolPaths, {
              type: 'MEMORY_COMPACTION_FAILED',
              questionId: item.id,
              trigger: memoryResult.trigger,
              error: memoryResult.error,
            });
          }

          await appendProtocolEvent(protocolPaths, {
            type: 'QUESTION_COMPLETED',
            questionId: item.id,
            finalConsensus: round.finalConsensus,
            metrics: round.metrics,
            roundsCompleted: session.rounds.length,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await appendProtocolEvent(protocolPaths, {
            type: 'QUESTION_FAILED',
            questionId: item.id,
            error: message || 'Unknown error',
          });
        }

        await writeProtocolState(protocolPaths, processedQuestionIds);
      }

      await sleep(settings.pollMs);
    }
  } finally {
    await writeProtocolState(protocolPaths, processedQuestionIds);
    await appendProtocolEvent(protocolPaths, {
      type: 'BROKER_STOPPED',
      roundsCompleted: session.rounds.length,
    });
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    console.log('\n[done] Broker stopped.');
  }
}

function defaultOutputPath(questionSeed = 'interactive') {
  const slug = sanitizePathPart(compact(questionSeed).toLowerCase().replace(/\s+/g, '-')) || 'interactive';
  return path.join(DEFAULT_OUTPUT_DIR, `${nowIsoSlug()}-consensus-${slug}.md`);
}

async function main() {
  const settings = parseArgs(process.argv.slice(2));
  if (settings.help) {
    printUsage();
    return;
  }

  const protocolPaths = settings.protocolDir ? getProtocolPaths(settings.protocolDir) : null;
  const outputPath = settings.output
    || (protocolPaths ? protocolPaths.transcriptPath : defaultOutputPath(settings.question || 'interactive'));
  const session = {
    startedAt: new Date().toISOString(),
    codexModel: settings.codexModel,
    claudeModel: settings.claudeModel,
    memoryCompactInterval: settings.memoryCompactInterval,
    memoryMaxChars: settings.memoryMaxChars,
    memory: {
      version: 0,
      compacted: '',
      lastCompactedRound: 0,
      updatedAt: '',
      updates: [],
    },
    rounds: [],
  };

  if (settings.claudeInit) {
    await runClaudeInit(settings);
  }

  if (settings.runPreflight || settings.verifyOnly) {
    await preflight(settings);
  }
  if (settings.verifyOnly) {
    console.log('[done] Verify-only complete.');
    return;
  }

  if (settings.question) {
    const round = await runOneQuestion(settings.question, session, settings);
    session.rounds.push(round);
    const memoryResult = await maybeCompactSessionMemory(session, settings);
    if (memoryResult.status !== 'skipped') round.memoryCompaction = memoryResult;
    await saveSessionMarkdown(session, outputPath);
    console.log('\n=== Final Consensus ===\n');
    console.log(round.finalConsensus);
    console.log(`\n[done] Transcript: ${outputPath}`);
    return;
  }

  if (protocolPaths) {
    await runProtocolBroker(session, settings, outputPath, protocolPaths);
    return;
  }

  const rl = readline.createInterface({ input, output });
  console.log('Dual-CLI consensus loop started.');
  console.log('Ask a question. Commands: :help, :status, :q');
  console.log(`Transcript: ${outputPath}`);

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const raw = await rl.question('\nYou> ');
      const question = raw.trim();
      if (!question) continue;

      if (question === ':q' || question === 'quit' || question === 'exit') {
        break;
      }
      if (question === ':help') {
        console.log('Commands: :help, :status, :q');
        continue;
      }
      if (question === ':status') {
        console.log(`Rounds completed: ${session.rounds.length}`);
        console.log(`Memory version: ${session.memory.version} (last compacted round ${session.memory.lastCompactedRound})`);
        if (session.rounds.length > 0) {
          const last = session.rounds[session.rounds.length - 1];
          console.log(`Last duration: ${last.metrics.totalMs}ms, Claude status: ${last.metrics.claudeStatus}`);
        }
        continue;
      }

      console.log('\n[workflow] Running dual research + compare + consensus...\n');
      const round = await runOneQuestion(question, session, settings);
      session.rounds.push(round);
      const memoryResult = await maybeCompactSessionMemory(session, settings);
      if (memoryResult.status !== 'skipped') round.memoryCompaction = memoryResult;
      await saveSessionMarkdown(session, outputPath);

      console.log('\n=== Final Consensus ===\n');
      console.log(round.finalConsensus);
      console.log('\n--- Metrics ---');
      console.log(`Codex initial: ${round.metrics.codexInitialMs}ms`);
      console.log(`Claude initial: ${round.metrics.claudeInitialMs}ms`);
      console.log(`Codex revised: ${round.metrics.codexCompareMs}ms`);
      console.log(`Claude revised: ${round.metrics.claudeCompareMs}ms`);
      console.log(`Alignment score: ${round.metrics.alignmentScore.toFixed(2)}`);
      console.log(`Claude status: ${round.metrics.claudeStatus}`);
      console.log(`Total: ${round.metrics.totalMs}ms`);
      if (round.memoryCompaction?.status === 'compacted') {
        console.log(
          `Memory compacted: v${round.memoryCompaction.update.version} (${round.memoryCompaction.update.trigger})`
        );
      } else if (round.memoryCompaction?.status === 'failed') {
        console.log(`Memory compaction failed: ${round.memoryCompaction.error}`);
      }
      console.log(`Transcript updated: ${outputPath}`);
    }
  } finally {
    rl.close();
    await saveSessionMarkdown(session, outputPath);
    console.log(`\n[done] Session ended. Transcript: ${outputPath}`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[error] ${message}`);
  console.error('Hint: authenticate both CLIs first (`codex login`, `claude login`).');
  process.exit(1);
});
