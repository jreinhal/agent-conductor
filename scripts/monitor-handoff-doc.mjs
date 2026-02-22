#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import crypto from 'crypto';

const DEFAULT_FILE = 'D:/Projects/mercenary/docs/evals/CLAUDE_CODEX_HANDOFF.md';
const DEFAULT_GUIDE_FILE = 'D:/Projects/Project Documentation/Mercenary/Operations/HANDOFF_PROTOCOL_IMPLEMENTATION_GUIDE.md';
const DEFAULT_OUTPUT = 'docs/evals/HANDOFF_MONITOR_NOTES.md';
const DEFAULT_FRESHNESS_TOKEN = '.tmp/handoff_freshness.json';
const DEFAULT_INTERVAL_SECONDS = 20;
const DEFAULT_DURATION_SECONDS = 180;
const CLOCK_SKEW_THRESHOLD_MS = 2 * 60 * 1000;
const MODERATION_RESPONSE_SLA_MS = 10 * 60 * 1000;
const NO_IDLE_GRACE_MS = 5 * 60 * 1000;
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

function hash(input) {
  return crypto.createHash('sha256').update(input, 'utf-8').digest('hex');
}

function hashMd5(input) {
  return crypto.createHash('md5').update(input, 'utf-8').digest('hex');
}

function formatNow() {
  return new Date().toISOString();
}

function parseTimestampMs(iso) {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseEntries(markdown) {
  const lines = markdown.split(/\r?\n/);
  const entries = [];
  let current = null;
  let inCodeBlock = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      continue;
    }

    const header = line.match(
      /^\[(?<timestamp>[^\]]+)\]\s+\[author:\s*(?<author>[^\]]+)\]\s+\[status:\s*(?<status>[^\]]+)\]$/
    );

    if (header?.groups) {
      const timestamp = header.groups.timestamp.trim();
      const hasPlaceholder = timestamp.includes('<') || timestamp.toLowerCase().includes('timestamp');
      if (hasPlaceholder || Number.isNaN(Date.parse(timestamp))) {
        continue;
      }

      if (current) {
        entries.push(current);
      }

      current = {
        header: line,
        timestamp,
        author: header.groups.author.trim(),
        status: header.groups.status.trim(),
        startLine: index + 1,
        fields: {},
        lines: [line],
      };
      continue;
    }

    if (!current) continue;

    if (line.trim() === '' && current.lines.length > 0) {
      current.lines.push(line);
      entries.push(current);
      current = null;
      continue;
    }

    current.lines.push(line);
    const field = line.match(/^([a-z_]+):\s*(.*)$/);
    if (field) {
      current.fields[field[1]] = field[2];
    }
  }

  if (current) {
    entries.push(current);
  }

  return entries;
}

function summarizeEntries(entries) {
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

function recommendations(entry) {
  if (!entry) return [];

  const notes = [];
  const fields = entry.fields || {};
  const owner = fields.owner;
  const lane = fields.lane;
  const status = entry.status;
  const entryMs = parseTimestampMs(entry.timestamp);

  if (entryMs !== null) {
    const skewMs = entryMs - Date.now();
    if (skewMs > CLOCK_SKEW_THRESHOLD_MS) {
      notes.push(
        `Clock-skew detected: timestamp is ${Math.round(skewMs / 60000)} minute(s) ahead of current UTC.`
      );
    }

    const ageMs = Date.now() - entryMs;
    if (owner && owner !== 'codex' && (status === 'open' || status === 'in_progress') && (!fields.decision || fields.decision === 'n/a') && ageMs > MODERATION_RESPONSE_SLA_MS) {
      notes.push('Moderation SLA risk: non-Codex item is awaiting decision beyond 10 minutes.');
    }
    if (owner && owner !== 'codex' && status === 'open' && fields.decision && fields.decision !== 'n/a' && ageMs > NO_IDLE_GRACE_MS) {
      const hasBlockerEta = Boolean(fields.blocker_reason && fields.blocker_eta && fields.blocker_reason !== 'n/a' && fields.blocker_eta !== 'n/a');
      if (!hasBlockerEta) {
        notes.push('No-idle breach: decision exists >5 minutes without execution or blocker+ETA.');
      }
    }
  }

  if (status === 'in_progress') {
    if (!fields.app_state || !fields.version_guard || !fields.scope_delta) {
      notes.push('Require preflight snapshot before keeping status=in_progress.');
    }
  }

  if (status === 'open' && owner && owner !== 'codex' && fields.decision && fields.decision !== 'n/a') {
    notes.push('No-idle breach risk: non-Codex item is still open after a decision was posted.');
  }

  if (owner && owner !== 'codex' && (status === 'in_progress' || status === 'closed')) {
    const sourceApproval = fields.source_edit_approval || 'n/a';
    const mutualRef = fields.mutual_approval_ref || 'n/a';
    if (sourceApproval === 'approved' && mutualRef === 'n/a') {
      notes.push('Mutual approval reference missing while source_edit_approval=approved.');
    }
  }

  if (status === 'closed') {
    if (!fields.evidence || fields.evidence === 'n/a') {
      notes.push('Closed entries should include concrete evidence artifact links.');
    }
    if (owner === 'codex' && (!fields.decision || fields.decision === 'n/a')) {
      notes.push('Codex decision entries should set decision=accept|rework-with-alternative|hard-reject.');
    }
  }

  if (owner === 'claude' && lane && lane !== 'claude-execution') {
    notes.push('Owner/lane mismatch: Claude should default to claude-execution unless reassigned.');
  }
  if (owner === 'gemini' && lane && lane !== 'gemini-intake') {
    notes.push('Owner/lane mismatch: Gemini should default to gemini-intake unless reassigned.');
  }
  if (owner === 'codex' && lane && lane !== 'shared-by-codex-only') {
    notes.push('Owner/lane mismatch: Codex should default to shared-by-codex-only.');
  }

  return notes;
}

function normalizeFieldValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeItemId(entry) {
  const itemId = normalizeFieldValue(entry.fields?.item_id || '');
  return itemId || 'n/a';
}

function dedupe(items) {
  return [...new Set(items)];
}

function resolveOwner(entry) {
  const owner = normalizeFieldValue(entry.fields?.owner || '').toLowerCase();
  if (owner) return owner;
  return normalizeFieldValue(entry.author || '').toLowerCase();
}

function isActiveEntry(entry) {
  return entry.status === 'open' || entry.status === 'in_progress';
}

function requiresCodexResponse(entry) {
  if (!isActiveEntry(entry)) return false;

  const owner = resolveOwner(entry);
  if (owner === 'codex') return false;

  const needsResponse = normalizeFieldValue(entry.fields?.needs_codex_response || '').toLowerCase();
  if (needsResponse === 'yes') return true;
  if (needsResponse === 'no') return false;

  const decision = normalizeFieldValue(entry.fields?.decision || '').toLowerCase();
  return !decision || decision === 'n/a';
}

function computeFreshnessMetrics(entries, nowMs = Date.now()) {
  const newestClosedByItem = new Map();
  const activeByItem = new Map();
  let pendingCodex = 0;
  let pendingOverdue = 0;

  for (const entry of entries) {
    const itemId = normalizeItemId(entry);
    const timestampMs = parseTimestampMs(entry.timestamp);

    if (entry.status === 'closed' && itemId !== 'n/a' && timestampMs !== null) {
      const previousMs = newestClosedByItem.get(itemId);
      if (typeof previousMs !== 'number' || timestampMs > previousMs) {
        newestClosedByItem.set(itemId, timestampMs);
      }
    }

    if (isActiveEntry(entry) && itemId !== 'n/a') {
      const list = activeByItem.get(itemId) || [];
      list.push(entry);
      activeByItem.set(itemId, list);
    }

    if (requiresCodexResponse(entry)) {
      pendingCodex += 1;
      if (timestampMs !== null && nowMs - timestampMs > MODERATION_RESPONSE_SLA_MS) {
        pendingOverdue += 1;
      }
    }
  }

  let staleNonterminal = 0;
  for (const entry of entries) {
    if (!isActiveEntry(entry)) continue;

    const itemId = normalizeItemId(entry);
    const timestampMs = parseTimestampMs(entry.timestamp);
    const newestClosedMs = newestClosedByItem.get(itemId);

    if (itemId !== 'n/a' && timestampMs !== null && typeof newestClosedMs === 'number' && newestClosedMs > timestampMs) {
      staleNonterminal += 1;
    }
  }

  for (const [, activeEntries] of activeByItem.entries()) {
    if (activeEntries.length > 1) {
      staleNonterminal += activeEntries.length - 1;
    }
  }

  return {
    pendingCodex,
    pendingOverdue,
    staleNonterminal,
  };
}

function buildFreshnessToken({
  resolvedFile,
  markdown,
  entries,
  summary,
}) {
  const nowIso = formatNow();
  const nowMs = Date.parse(nowIso);
  const metrics = computeFreshnessMetrics(entries, nowMs);

  return {
    poll_utc: nowIso,
    file: resolvedFile,
    hash_sha256: hash(markdown),
    hash_md5: hashMd5(markdown),
    entry_count: summary.entryCount,
    open_count: summary.counts.open,
    in_progress_count: summary.counts.in_progress,
    closed_count: summary.counts.closed,
    pending_codex_count: metrics.pendingCodex,
    pending_codex_overdue_count: metrics.pendingOverdue,
    stale_nonterminal_count: metrics.staleNonterminal,
    latest_entry: summary.latest
      ? {
        timestamp: summary.latest.timestamp,
        author: summary.latest.author,
        status: summary.latest.status,
        item_id: summary.latest.fields?.item_id || 'n/a',
        line: summary.latest.startLine,
      }
      : null,
  };
}

async function writeFreshnessToken(tokenPath, token) {
  const absolute = path.resolve(tokenPath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, JSON.stringify(token, null, 2), 'utf-8');
}

function crossEntryRecommendations(entries) {
  const notes = [];
  const newestClosedByItem = new Map();
  const activeByItem = new Map();

  for (const entry of entries) {
    const itemId = normalizeItemId(entry);
    const timestampMs = parseTimestampMs(entry.timestamp);
    const needsResponse = normalizeFieldValue(entry.fields?.needs_codex_response || '').toLowerCase();

    if (entry.status === 'closed' && needsResponse === 'yes') {
      notes.push(
        `Closed entry has needs_codex_response=yes at line ${entry.startLine} (item_id=${itemId}).`
      );
    }

    if (entry.status === 'closed' && itemId !== 'n/a' && timestampMs !== null) {
      const previousMs = newestClosedByItem.get(itemId);
      if (typeof previousMs !== 'number' || timestampMs > previousMs) {
        newestClosedByItem.set(itemId, timestampMs);
      }
    }

    if ((entry.status === 'open' || entry.status === 'in_progress') && itemId !== 'n/a') {
      const list = activeByItem.get(itemId) || [];
      list.push(entry);
      activeByItem.set(itemId, list);
    }
  }

  for (const entry of entries) {
    if (entry.status !== 'open' && entry.status !== 'in_progress') continue;

    const itemId = normalizeItemId(entry);
    const timestampMs = parseTimestampMs(entry.timestamp);
    const newestClosedMs = newestClosedByItem.get(itemId);

    if (itemId !== 'n/a' && timestampMs !== null && typeof newestClosedMs === 'number' && newestClosedMs > timestampMs) {
      notes.push(
        `Superseded non-closed entry at line ${entry.startLine} (item_id=${itemId}); newer closed entry exists.`
      );
    }

    if (entry.author === 'codex' && entry.status === 'in_progress' && timestampMs !== null) {
      const ageMs = Date.now() - timestampMs;
      if (ageMs > 24 * 60 * 60 * 1000) {
        notes.push(
          `Potential stale Codex in_progress older than 24h at line ${entry.startLine} (item_id=${itemId}).`
        );
      }
    }
  }

  for (const [itemId, activeEntries] of activeByItem.entries()) {
    if (activeEntries.length > 1) {
      const lines = activeEntries.map((entry) => entry.startLine).join(', ');
      notes.push(`Multiple active entries for item_id=${itemId} at lines ${lines}.`);
    }
  }

  return dedupe(notes);
}

function guideSyncRecommendations(sourceStats, guideStats, guideMarkdown) {
  const notes = [];
  const generatedMatch = guideMarkdown.match(/^\- Generated \(UTC\):\s*(.+)$/m);
  const generatedUtc = generatedMatch?.[1]?.trim() || '';
  const generatedMs = generatedUtc ? parseTimestampMs(generatedUtc) : null;
  const sourceWriteMs = sourceStats?.mtimeMs;
  const guideWriteMs = guideStats?.mtimeMs;

  if (!generatedUtc || generatedMs === null) {
    notes.push('Guide missing valid "Generated (UTC)" marker.');
  }

  if (typeof sourceWriteMs === 'number' && typeof guideWriteMs === 'number') {
    if (guideWriteMs + GUIDE_SYNC_MAX_LAG_MS < sourceWriteMs) {
      notes.push('Guide file appears older than source handoff file beyond sync lag threshold.');
    }
  }

  if (typeof sourceWriteMs === 'number' && generatedMs !== null) {
    if (generatedMs + GUIDE_SYNC_MAX_LAG_MS < sourceWriteMs) {
      notes.push('Guide generated timestamp lags source handoff update beyond sync threshold.');
    }
  }

  return dedupe(notes);
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

async function runAudit({ filePath, guidePath, outputPath }) {
  const resolvedFile = path.resolve(filePath);
  const resolvedGuide = path.resolve(guidePath);
  const handoffMarkdown = await readText(resolvedFile);
  const guideMarkdown = await readText(resolvedGuide);
  const sourceStats = await getFileStats(resolvedFile);
  const guideStats = await getFileStats(resolvedGuide);

  const entries = parseEntries(handoffMarkdown);
  const summary = summarizeEntries(entries);
  const latest = summary.latest;
  const latestNotes = recommendations(latest);
  const crossNotes = crossEntryRecommendations(entries);
  const syncNotes = guideSyncRecommendations(sourceStats, guideStats, guideMarkdown);

  const runHeader = `\n\n## Audit Run ${formatNow()}\n- file: ${resolvedFile}\n- guide: ${resolvedGuide}\n- entry-count: ${summary.entryCount} (open=${summary.counts.open}, in_progress=${summary.counts.in_progress}, closed=${summary.counts.closed})\n`;
  const latestLine = latest
    ? `- latest: [${latest.timestamp}] ${latest.author} ${latest.status} item_id=${latest.fields.item_id || 'n/a'}\n`
    : '- latest: none\n';
  const latestBlock = latestNotes.length
    ? `- latest-entry-recommendations:\n${latestNotes.map((note) => `  - ${note}`).join('\n')}\n`
    : '- latest-entry-recommendations:\n  - none\n';
  const crossBlock = crossNotes.length
    ? `- cross-entry-findings:\n${crossNotes.map((note) => `  - ${note}`).join('\n')}\n`
    : '- cross-entry-findings:\n  - none\n';
  const syncBlock = syncNotes.length
    ? `- guide-sync-findings:\n${syncNotes.map((note) => `  - ${note}`).join('\n')}\n`
    : '- guide-sync-findings:\n  - in-sync\n';

  await appendOutput(outputPath, runHeader + latestLine + latestBlock + crossBlock + syncBlock);

  console.log(`[audit] entries=${summary.entryCount} open=${summary.counts.open} in_progress=${summary.counts.in_progress} closed=${summary.counts.closed}`);
  if (crossNotes.length) {
    for (const note of crossNotes) {
      console.log(`[audit] finding: ${note}`);
    }
  } else {
    console.log('[audit] no cross-entry hygiene findings');
  }
  if (syncNotes.length) {
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
}) {
  const resolvedFile = path.resolve(filePath);
  const intervalMs = Math.max(1, Number(intervalSeconds)) * 1000;
  const durationMs = Math.max(1, Number(durationSeconds)) * 1000;

  const initial = await readText(resolvedFile);
  const initialEntries = parseEntries(initial);
  let previousHash = hash(initial);
  let previousSummary = summarizeEntries(initialEntries);

  const initialToken = buildFreshnessToken({
    resolvedFile,
    markdown: initial,
    entries: initialEntries,
    summary: previousSummary,
  });
  await writeFreshnessToken(tokenPath, initialToken);

  const header = `\n\n## Monitor Run ${formatNow()}\n- file: ${resolvedFile}\n- interval: ${intervalSeconds}s\n- duration: ${durationSeconds}s\n- baseline entries: ${previousSummary.entryCount} (open=${previousSummary.counts.open}, in_progress=${previousSummary.counts.in_progress}, closed=${previousSummary.counts.closed})\n`;
  await appendOutput(outputPath, header);

  console.log(`[monitor] baseline loaded: ${previousSummary.entryCount} entries`);
  console.log(`[monitor] watching ${resolvedFile} every ${intervalSeconds}s for ${durationSeconds}s`);

  const startedAt = Date.now();
  while (Date.now() - startedAt < durationMs) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));

    let content;
    try {
      content = await readText(resolvedFile);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`[monitor] read error: ${message}`);
      continue;
    }

    const currentHash = hash(content);
    const currentEntries = parseEntries(content);
    const currentSummary = summarizeEntries(currentEntries);

    const freshnessToken = buildFreshnessToken({
      resolvedFile,
      markdown: content,
      entries: currentEntries,
      summary: currentSummary,
    });
    await writeFreshnessToken(tokenPath, freshnessToken);

    if (currentHash === previousHash) {
      continue;
    }

    const latest = currentSummary.latest;
    const notes = recommendations(latest);

    const deltaLine = `\n### Change ${formatNow()}\n- entries: ${previousSummary.entryCount} -> ${currentSummary.entryCount}\n- open: ${previousSummary.counts.open} -> ${currentSummary.counts.open}\n- in_progress: ${previousSummary.counts.in_progress} -> ${currentSummary.counts.in_progress}\n- closed: ${previousSummary.counts.closed} -> ${currentSummary.counts.closed}\n`;
    const latestLine = latest
      ? `- latest: [${latest.timestamp}] ${latest.author} ${latest.status} item_id=${latest.fields.item_id || 'n/a'}\n- summary: ${latest.fields.summary || 'n/a'}\n`
      : '- latest: none\n';
    const recommendationLines = notes.length > 0
      ? `- recommendations:\n${notes.map((note) => `  - ${note}`).join('\n')}\n`
      : '- recommendations:\n  - No immediate governance gaps detected in latest entry.\n';

    await appendOutput(outputPath, deltaLine + latestLine + recommendationLines);

    console.log(`[monitor] change detected @ ${formatNow()}`);
    if (latest) {
      console.log(`[monitor] latest ${latest.author}/${latest.status} item=${latest.fields.item_id || 'n/a'}`);
    }
    for (const note of notes) {
      console.log(`[monitor] recommendation: ${note}`);
    }

    previousHash = currentHash;
    previousSummary = currentSummary;
  }

  const footer = `\n- run-finished: ${formatNow()}\n`;
  await appendOutput(outputPath, footer);
  console.log('[monitor] finished');
}

async function main() {
  const args = parseArgs(process.argv);

  const filePath = args.file || process.env.HANDOFF_DOC_PATH || DEFAULT_FILE;
  const guidePath = args.guide || process.env.HANDOFF_GUIDE_PATH || DEFAULT_GUIDE_FILE;
  const outputPath = args.out || DEFAULT_OUTPUT;
  const tokenPath = args.token || DEFAULT_FRESHNESS_TOKEN;
  const intervalSeconds = Number(args.interval || DEFAULT_INTERVAL_SECONDS);
  const durationSeconds = Number(args.duration || DEFAULT_DURATION_SECONDS);
  const auditMode = args.audit === 'true' || args.mode === 'audit';

  if (auditMode) {
    await runAudit({
      filePath,
      guidePath,
      outputPath,
    });
    return;
  }

  await monitor({
    filePath,
    outputPath,
    intervalSeconds,
    durationSeconds,
    tokenPath,
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[monitor] fatal: ${message}`);
  process.exit(1);
});
