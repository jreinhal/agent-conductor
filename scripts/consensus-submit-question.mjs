#!/usr/bin/env node

import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_PROTOCOL_DIR = path.join(process.cwd(), '.data', 'consensus-bus');

function usage() {
  console.log([
    'Usage: node scripts/consensus-submit-question.mjs --question "<text>" [options]',
    '',
    'Options:',
    '  --question "<text>"       Question to submit (required)',
    '  --protocol-dir <path>     Protocol directory (default: .data/consensus-bus)',
    '  --help                    Show help',
    '',
    'Example:',
    '  npm run dialogue:consensus:ask -- --question "What should our pricing be?"',
  ].join('\n'));
}

function parseArgs(argv) {
  const args = {
    question: '',
    protocolDir: DEFAULT_PROTOCOL_DIR,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (arg === '--question' && typeof next === 'string') {
      args.question = next.trim();
      i += 1;
      continue;
    }
    if (arg === '--protocol-dir' && typeof next === 'string') {
      args.protocolDir = path.resolve(next.trim());
      i += 1;
      continue;
    }
  }

  return args;
}

function makeId() {
  return `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  if (!args.question) {
    usage();
    process.exit(1);
  }

  const questionsPath = path.join(args.protocolDir, 'questions.jsonl');
  await mkdir(args.protocolDir, { recursive: true });

  const questionEvent = {
    id: makeId(),
    question: args.question,
    submittedAt: new Date().toISOString(),
  };

  await appendFile(questionsPath, `${JSON.stringify(questionEvent)}\n`, 'utf-8');
  console.log(`Submitted question ${questionEvent.id}`);
  console.log(`questions file: ${questionsPath}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[error] ${message}`);
  process.exit(1);
});
