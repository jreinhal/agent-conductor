export const DEFAULT_PENDING_WINDOW = 100;

const ENTRY_HEADER_RE =
  /^\[(?<timestamp>[^\]]+)\]\s+\[author:\s*(?<author>[^\]]+)\]\s+\[status:\s*(?<status>[^\]]+)\]$/;
const FIELD_RE = /^([a-z_]+):\s*(.*)$/;

export function parseTimestampMs(value) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function normalizeFieldValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeItemId(entry) {
  const itemId = normalizeFieldValue(entry?.fields?.item_id || '');
  return itemId || 'n/a';
}

function isCodeFence(line) {
  return line.trim().startsWith('```');
}

function buildEntryFromHeader(line, lineIndex) {
  const header = line.match(ENTRY_HEADER_RE);
  if (!header?.groups) return null;

  const timestamp = header.groups.timestamp.trim();
  const hasPlaceholder = timestamp.includes('<') || timestamp.toLowerCase().includes('timestamp');
  if (hasPlaceholder || parseTimestampMs(timestamp) === null) {
    return null;
  }

  return {
    timestamp,
    author: header.groups.author.trim(),
    status: header.groups.status.trim(),
    startLine: lineIndex + 1,
    fields: {},
  };
}

function addFieldToEntry(entry, line) {
  if (!entry) return entry;

  const field = line.match(FIELD_RE);
  if (!field) return entry;

  const key = field[1];
  if (!(key in entry.fields)) {
    entry.fields[key] = field[2];
  }
  return entry;
}

export function parseEntries(markdown) {
  const lines = markdown.split(/\r?\n/);
  const dividerIndex = lines.indexOf('---');
  const startIndex = dividerIndex >= 0 ? dividerIndex + 1 : 0;

  const entries = [];
  let current = null;
  let inCodeBlock = false;
  const pushCurrent = () => {
    if (!current) return;
    entries.push(current);
    current = null;
  };

  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    if (isCodeFence(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const nextEntry = buildEntryFromHeader(line, index);
    if (nextEntry) {
      pushCurrent();
      current = nextEntry;
      continue;
    }

    current = addFieldToEntry(current, line);
  }

  pushCurrent();

  return entries;
}

export function entrySignature(entry) {
  if (!entry) return 'none';
  return `${entry.timestamp}|${entry.author}|${entry.status}|${normalizeItemId(entry)}`;
}

export function isPendingForCodex(entry) {
  if (!entry) return false;
  if (entry.author.toLowerCase() === 'codex') return false;
  if (entry.status !== 'open' && entry.status !== 'in_progress') return false;

  const explicit = normalizeFieldValue(entry.fields?.needs_codex_response || '').toLowerCase();
  if (explicit === 'yes') return true;
  if (explicit === 'no') return false;

  return entry.status === 'open';
}

export function collectPending(entries, pendingWindow = DEFAULT_PENDING_WINDOW) {
  const windowSize = Math.max(1, Number(pendingWindow) || DEFAULT_PENDING_WINDOW);
  const scan = entries.slice(0, windowSize);
  return scan.filter((entry) => isPendingForCodex(entry));
}

export function buildMonitorState({
  resolvedFile,
  entries,
  pendingWindow = DEFAULT_PENDING_WINDOW,
  nowMs = Date.now(),
}) {
  const topEntry = entries[0] || null;
  const pending = collectPending(entries, pendingWindow);
  return {
    poll_utc: new Date(nowMs).toISOString(),
    file: resolvedFile,
    top_signature: entrySignature(topEntry),
    top_entry: topEntry
      ? {
        timestamp: topEntry.timestamp,
        author: topEntry.author,
        status: topEntry.status,
        item_id: normalizeItemId(topEntry),
        line: topEntry.startLine,
      }
      : null,
    pending_codex_count: pending.length,
    pending_codex: pending.slice(0, 20).map((entry) => ({
      timestamp: entry.timestamp,
      author: entry.author,
      status: entry.status,
      item_id: normalizeItemId(entry),
      line: entry.startLine,
    })),
    active_window_entries: Math.min(Math.max(1, Number(pendingWindow) || DEFAULT_PENDING_WINDOW), entries.length),
  };
}
