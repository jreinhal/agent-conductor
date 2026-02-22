#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import {
  DEFAULT_PENDING_WINDOW,
  buildMonitorState,
  parseEntries,
  parseTimestampMs,
} from './handoff-freshness-core.mjs';

const DEFAULT_FILE = 'D:/Projects/mercenary/docs/evals/CLAUDE_CODEX_HANDOFF.md';
const DEFAULT_TOKEN = '.tmp/handoff_freshness.json';
const DEFAULT_MAX_AGE_SECONDS = 300;

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

function parseNumberArg(value, fallback, minimum = null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (minimum !== null && parsed < minimum) return fallback;
  return parsed;
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw);
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

async function buildStateFromFile(resolvedFile, pendingWindow) {
  const markdown = await fs.readFile(resolvedFile, 'utf-8');
  const entries = parseEntries(markdown);
  return buildMonitorState({
    resolvedFile,
    entries,
    pendingWindow,
    nowMs: Date.now(),
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const resolvedFile = path.resolve(args.file || process.env.HANDOFF_DOC_PATH || DEFAULT_FILE);
  const tokenPath = path.resolve(args.token || DEFAULT_TOKEN);
  const maxAgeSeconds = parseNumberArg(args.maxAge, DEFAULT_MAX_AGE_SECONDS, 1);
  const pendingWindow = parseNumberArg(args.pendingWindow, DEFAULT_PENDING_WINDOW, 1);
  const requireClearQueue = toBoolean(args.requireClearQueue, false);
  const refresh = toBoolean(args.refresh, true);
  const jsonOutput = toBoolean(args.json, false);

  let state;
  if (refresh) {
    state = await buildStateFromFile(resolvedFile, pendingWindow);
    await writeJson(tokenPath, state);
  } else {
    state = await readJson(tokenPath);
  }

  const failures = [];
  const pollMs = parseTimestampMs(String(state.poll_utc || ''));
  const nowMs = Date.now();

  if (pollMs === null) {
    failures.push('State token is missing a valid poll_utc timestamp.');
  } else {
    const ageMs = nowMs - pollMs;
    if (ageMs < -5000) {
      failures.push(`State token timestamp is in the future by ${Math.round(Math.abs(ageMs) / 1000)}s.`);
    } else if (ageMs > maxAgeSeconds * 1000) {
      failures.push(`State token is stale (${Math.round(ageMs / 1000)}s old; max ${maxAgeSeconds}s).`);
    }
  }

  if (requireClearQueue && Number(state.pending_codex_count || 0) > 0) {
    failures.push(`pending_codex_count=${state.pending_codex_count} (must be 0 when requireClearQueue=true).`);
  }

  const tuple = {
    poll_utc: state.poll_utc || null,
    pending_codex: Number(state.pending_codex_count || 0),
    top_signature: state.top_signature || 'none',
  };

  if (jsonOutput) {
    console.log(JSON.stringify({
      ok: failures.length === 0,
      tuple,
      tokenPath,
      file: resolvedFile,
      refreshed: refresh,
      failures,
    }, null, 2));
  } else {
    console.log(`[freshness] poll_utc=${tuple.poll_utc} pending_codex=${tuple.pending_codex} top_signature=${tuple.top_signature}`);
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
