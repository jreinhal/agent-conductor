#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import {
  DEFAULT_PENDING_WINDOW,
  buildMonitorState,
  entrySignature,
  parseEntries,
} from './handoff-freshness-core.mjs';

const DEFAULT_FILE = 'D:/Projects/mercenary/docs/evals/CLAUDE_CODEX_HANDOFF.md';
const DEFAULT_GUIDE_FILE = 'D:/Projects/Project Documentation/Mercenary/Operations/HANDOFF_PROTOCOL_IMPLEMENTATION_GUIDE.md';
const DEFAULT_OUTPUT = 'docs/evals/HANDOFF_MONITOR_NOTES.md';
const DEFAULT_STATE_TOKEN = '.tmp/handoff_freshness.json';
const DEFAULT_INTERVAL_SECONDS = 120;
const DEFAULT_DURATION_SECONDS = 0;
const GUIDE_SYNC_MAX_LAG_MS = 5 * 60 * 1000;

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    args[key] = value;
  }
  return args;
}

function parseNumberArg(value, fallback, minimum = null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (minimum !== null && parsed < minimum) return fallback;
  return parsed;
}

function formatNow() {
  return new Date().toISOString();
}

function formatIndentedList(header, items) {
  return [header, ...items.map((item) => `  - ${item}`)].join('\n');
}

function formatPendingEntry(entry) {
  return `${entry.author}/${entry.status}/${entry.item_id}@L${entry.line}`;
}

function summarize(entries) {
  const counts = { open: 0, in_progress: 0, closed: 0, unknown: 0 };
  for (const entry of entries) {
    if (entry.status === 'open' || entry.status === 'in_progress' || entry.status === 'closed') {
      counts[entry.status] += 1;
    } else {
      counts.unknown += 1;
    }
  }
  return {
    entryCount: entries.length,
    counts,
    latest: entries[0] || null,
  };
}

async function writeState(tokenPath, token) {
  const absolute = path.resolve(tokenPath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, JSON.stringify(token, null, 2), 'utf-8');
}

async function appendOutput(outPath, content) {
  const absolute = path.resolve(outPath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.appendFile(absolute, content, 'utf-8');
}

async function readText(filePath) {
  return fs.readFile(path.resolve(filePath), 'utf-8');
}

async function getFileStats(filePath) {
  return fs.stat(path.resolve(filePath));
}

async function runAudit({ filePath, guidePath, outputPath, pendingWindow }) {
  const resolvedFile = path.resolve(filePath);
  const resolvedGuide = path.resolve(guidePath);
  const handoffMarkdown = await readText(resolvedFile);
  const guideMarkdown = await readText(resolvedGuide);
  const sourceStats = await getFileStats(resolvedFile);
  const guideStats = await getFileStats(resolvedGuide);

  const entries = parseEntries(handoffMarkdown);
  const summary = summarize(entries);
  const state = buildMonitorState({
    resolvedFile,
    entries,
    pendingWindow,
    nowMs: Date.now(),
  });

  const syncNotes = [];
  const generatedMatch = guideMarkdown.match(/^\- Generated \(UTC\):\s*(.+)$/m);
  const generatedUtc = generatedMatch?.[1]?.trim() || '';
  const generatedMs = generatedUtc ? Date.parse(generatedUtc) : Number.NaN;
  if (!generatedUtc || Number.isNaN(generatedMs)) {
    syncNotes.push('Guide missing valid "Generated (UTC)" marker.');
  }
  if (guideStats.mtimeMs + GUIDE_SYNC_MAX_LAG_MS < sourceStats.mtimeMs) {
    syncNotes.push('Guide appears older than handoff beyond sync lag threshold.');
  }
  const guideSyncFindings =
    syncNotes.length > 0
      ? formatIndentedList('- guide-sync-findings:', syncNotes)
      : '- guide-sync-findings:\n  - in-sync';

  const latest = summary.latest;
  const body = [
    `\n\n## Audit Run ${formatNow()}`,
    `- file: ${resolvedFile}`,
    `- guide: ${resolvedGuide}`,
    `- entry-count: ${summary.entryCount} (open=${summary.counts.open}, in_progress=${summary.counts.in_progress}, closed=${summary.counts.closed})`,
    latest
      ? `- latest: [${latest.timestamp}] ${latest.author} ${latest.status} item_id=${latest.fields.item_id || 'n/a'}`
      : '- latest: none',
    `- top-signature: ${state.top_signature}`,
    `- pending-codex: ${state.pending_codex_count}`,
    guideSyncFindings,
    '',
  ].join('\n');

  await appendOutput(outputPath, body);
  console.log(`[audit] entries=${summary.entryCount} pending_codex=${state.pending_codex_count}`);
  if (syncNotes.length > 0) {
    for (const note of syncNotes) {
      console.log(`[audit] sync-finding: ${note}`);
    }
  } else {
    console.log('[audit] guide is in sync');
  }
}

async function monitor({
  filePath,
  outputPath,
  intervalSeconds,
  durationSeconds,
  tokenPath,
  pendingWindow,
}) {
  const resolvedFile = path.resolve(filePath);
  const intervalMs = Math.max(1, Number(intervalSeconds)) * 1000;
  const parsedDurationSeconds = Number(durationSeconds);
  const durationMs =
    Number.isFinite(parsedDurationSeconds) && parsedDurationSeconds > 0
      ? parsedDurationSeconds * 1000
      : null;

  const initialMarkdown = await readText(resolvedFile);
  const initialEntries = parseEntries(initialMarkdown);
  const initialSummary = summarize(initialEntries);
  let previousTopSignature = entrySignature(initialSummary.latest);
  const initialState = buildMonitorState({
    resolvedFile,
    entries: initialEntries,
    pendingWindow,
    nowMs: Date.now(),
  });
  await writeState(tokenPath, initialState);

  const durationLabel = durationMs === null ? 'continuous' : `${durationSeconds}s`;
  await appendOutput(
    outputPath,
    [
      `\n\n## Monitor Run ${formatNow()}`,
      `- file: ${resolvedFile}`,
      `- interval: ${intervalSeconds}s`,
      `- duration: ${durationLabel}`,
      `- pending-window: ${pendingWindow}`,
      `- baseline entries: ${initialSummary.entryCount} (open=${initialSummary.counts.open}, in_progress=${initialSummary.counts.in_progress}, closed=${initialSummary.counts.closed})`,
      `- baseline top-signature: ${previousTopSignature}`,
      '',
    ].join('\n')
  );

  console.log(`[monitor] baseline loaded: ${initialSummary.entryCount} entries`);
  console.log(`[monitor] loop: sleep ${intervalSeconds}s -> read -> compare top entry -> act -> repeat (${durationLabel})`);

  const startedAt = Date.now();
  while (true) {
    if (durationMs !== null && Date.now() - startedAt >= durationMs) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));

    let markdown;
    try {
      markdown = await readText(resolvedFile);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`[monitor] read error: ${message}`);
      continue;
    }

    const entries = parseEntries(markdown);
    const summary = summarize(entries);
    const state = buildMonitorState({
      resolvedFile,
      entries,
      pendingWindow,
      nowMs: Date.now(),
    });
    await writeState(tokenPath, state);

    const tuple = `poll_utc=${state.poll_utc} pending_codex=${state.pending_codex_count}`;
    if (state.top_signature === previousTopSignature) {
      console.log(`[monitor] heartbeat ${tuple} changed=false`);
      continue;
    }

    const latest = summary.latest;
    const lines = [
      `\n### Change ${formatNow()}`,
      `- top-signature: ${previousTopSignature} -> ${state.top_signature}`,
      latest
        ? `- latest: [${latest.timestamp}] ${latest.author} ${latest.status} item_id=${latest.fields.item_id || 'n/a'}`
        : '- latest: none',
      `- pending-codex: ${state.pending_codex_count}`,
    ];
    if (state.pending_codex.length > 0) {
      const pendingSample = state.pending_codex.map((entry) => formatPendingEntry(entry)).join(', ');
      lines.push(`- pending-sample: ${pendingSample}`);
    }
    lines.push('');

    await appendOutput(outputPath, lines.join('\n'));
    console.log(`[monitor] change detected ${tuple} changed=true`);
    previousTopSignature = state.top_signature;
  }

  await appendOutput(outputPath, `- run-finished: ${formatNow()}\n`);
  console.log('[monitor] finished');
}

async function main() {
  const args = parseArgs(process.argv);
  const filePath = args.file || process.env.HANDOFF_DOC_PATH || DEFAULT_FILE;
  const guidePath = args.guide || process.env.HANDOFF_GUIDE_PATH || DEFAULT_GUIDE_FILE;
  const outputPath = args.out || DEFAULT_OUTPUT;
  const tokenPath = args.token || DEFAULT_STATE_TOKEN;
  const intervalSeconds = parseNumberArg(args.interval, DEFAULT_INTERVAL_SECONDS, 1);
  const durationSeconds = parseNumberArg(args.duration, DEFAULT_DURATION_SECONDS, 0);
  const pendingWindow = parseNumberArg(args.pendingWindow, DEFAULT_PENDING_WINDOW, 1);
  const auditMode = args.audit === 'true' || args.mode === 'audit';

  if (auditMode) {
    await runAudit({ filePath, guidePath, outputPath, pendingWindow });
    return;
  }

  await monitor({
    filePath,
    outputPath,
    intervalSeconds,
    durationSeconds,
    tokenPath,
    pendingWindow,
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[monitor] fatal: ${message}`);
  process.exit(1);
});
