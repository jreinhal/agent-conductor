#!/usr/bin/env node

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import process from 'process';

const DEFAULT_FILE = 'D:/Projects/mercenary/docs/evals/CLAUDE_CODEX_HANDOFF.md';
const DEFAULT_TOKEN = '.tmp/handoff_freshness.json';
const DEFAULT_MAX_AGE_SECONDS = 60;
const MODERATION_RESPONSE_SLA_MS = 10 * 60 * 1000;

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

function toBoolean(value, defaultValue = false) {
  if (value === undefined) return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function sha256(input) {
  return crypto.createHash('sha256').update(input, 'utf-8').digest('hex');
}

function md5(input) {
  return crypto.createHash('md5').update(input, 'utf-8').digest('hex');
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
    if (inCodeBlock) continue;

    const header = line.match(
      /^\[(?<timestamp>[^\]]+)\]\s+\[author:\s*(?<author>[^\]]+)\]\s+\[status:\s*(?<status>[^\]]+)\]$/
    );

    if (header?.groups) {
      const timestamp = header.groups.timestamp.trim();
      if (timestamp.includes('<') || Number.isNaN(Date.parse(timestamp))) {
        continue;
      }
      if (current) entries.push(current);

      current = {
        timestamp,
        author: header.groups.author.trim(),
        status: header.groups.status.trim(),
        fields: {},
      };
      continue;
    }

    if (!current) continue;

    if (line.trim() === '') {
      entries.push(current);
      current = null;
      continue;
    }

    const field = line.match(/^([a-z_]+):\s*(.*)$/);
    if (field) {
      current.fields[field[1]] = field[2];
    }
  }

  if (current) entries.push(current);
  return entries;
}

function normalizeFieldValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeItemId(entry) {
  const itemId = normalizeFieldValue(entry.fields?.item_id || '');
  return itemId || 'n/a';
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
  if (resolveOwner(entry) === 'codex') return false;

  const needsResponse = normalizeFieldValue(entry.fields?.needs_codex_response || '').toLowerCase();
  if (needsResponse === 'yes') return true;
  if (needsResponse === 'no') return false;

  const decision = normalizeFieldValue(entry.fields?.decision || '').toLowerCase();
  return !decision || decision === 'n/a';
}

function summarizeEntries(entries) {
  const counts = { open: 0, in_progress: 0, closed: 0 };
  for (const entry of entries) {
    if (entry.status === 'open' || entry.status === 'in_progress' || entry.status === 'closed') {
      counts[entry.status] += 1;
    }
  }
  return {
    entryCount: entries.length,
    counts,
    latest: entries[0] || null,
  };
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
      const prev = newestClosedByItem.get(itemId);
      if (typeof prev !== 'number' || timestampMs > prev) {
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

function buildFreshnessToken(resolvedFile, markdown) {
  const entries = parseEntries(markdown);
  const summary = summarizeEntries(entries);
  const metrics = computeFreshnessMetrics(entries, Date.now());
  const nowIso = new Date().toISOString();

  return {
    poll_utc: nowIso,
    file: resolvedFile,
    hash_sha256: sha256(markdown),
    hash_md5: md5(markdown),
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
      }
      : null,
  };
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw);
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

async function main() {
  const args = parseArgs(process.argv);
  const resolvedFile = path.resolve(args.file || process.env.HANDOFF_DOC_PATH || DEFAULT_FILE);
  const tokenPath = path.resolve(args.token || DEFAULT_TOKEN);
  const maxAgeSeconds = Number(args.maxAge || DEFAULT_MAX_AGE_SECONDS);
  const allowOverdue = toBoolean(args.allowOverdue, false);
  const allowStale = toBoolean(args.allowStale, false);
  const requireClearQueue = toBoolean(args.requireClearQueue, false);
  const refresh = toBoolean(args.refresh, true);
  const jsonOutput = toBoolean(args.json, false);

  let token;
  if (refresh) {
    const markdown = await fs.readFile(resolvedFile, 'utf-8');
    token = buildFreshnessToken(resolvedFile, markdown);
    await writeJson(tokenPath, token);
  } else {
    token = await readJson(tokenPath);
  }

  const failures = [];
  const nowMs = Date.now();
  const pollMs = parseTimestampMs(token.poll_utc || '');

  if (pollMs === null) {
    failures.push('Token is missing a valid poll_utc timestamp.');
  } else {
    const ageMs = nowMs - pollMs;
    if (ageMs > maxAgeSeconds * 1000) {
      failures.push(`Token is stale (${Math.round(ageMs / 1000)}s old; max ${maxAgeSeconds}s).`);
    }
  }

  const markdown = await fs.readFile(resolvedFile, 'utf-8');
  const currentSha = sha256(markdown);
  const currentMd5 = md5(markdown);
  if (token.hash_sha256 !== currentSha || token.hash_md5 !== currentMd5) {
    failures.push('Token hash does not match current handoff file content.');
  }

  if (!allowOverdue && Number(token.pending_codex_overdue_count || 0) > 0) {
    failures.push(`pending_codex_overdue_count=${token.pending_codex_overdue_count} (must be 0).`);
  }

  if (!allowStale && Number(token.stale_nonterminal_count || 0) > 0) {
    failures.push(`stale_nonterminal_count=${token.stale_nonterminal_count} (must be 0).`);
  }

  if (requireClearQueue && Number(token.pending_codex_count || 0) > 0) {
    failures.push(`pending_codex_count=${token.pending_codex_count} (must be 0 when requireClearQueue=true).`);
  }

  const tuple = {
    poll_utc: token.poll_utc,
    pending_codex: Number(token.pending_codex_count || 0),
    overdue: Number(token.pending_codex_overdue_count || 0),
    stale_nonterminal: Number(token.stale_nonterminal_count || 0),
  };

  if (jsonOutput) {
    console.log(JSON.stringify({
      ok: failures.length === 0,
      tuple,
      tokenPath,
      file: resolvedFile,
      failures,
    }, null, 2));
  } else {
    console.log(
      `[freshness] poll_utc=${tuple.poll_utc} pending_codex=${tuple.pending_codex} overdue=${tuple.overdue} stale_nonterminal=${tuple.stale_nonterminal}`
    );
    if (failures.length > 0) {
      for (const failure of failures) {
        console.error(`[freshness] fail: ${failure}`);
      }
    } else {
      console.log('[freshness] pass');
    }
  }

  process.exit(failures.length === 0 ? 0 : 2);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[freshness] fatal: ${message}`);
  process.exit(1);
});
