import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const MERGE_GATES_SCHEMA = z.object({
    coreTestsAndE2E: z.boolean(),
    evalRegression: z.boolean(),
    latencySafetyCompliance: z.boolean(),
    failureDiagnostics: z.boolean(),
    trendArtifactUpdate: z.boolean(),
    manualUiNote: z.boolean(),
});

const DEVIATION_SCHEMA = z.object({
    changed: z.string(),
    reason: z.string(),
    risk: z.string(),
    gate: z.string(),
});

const CAPABILITY_GATE_SCHEMA = z.object({
    enabled: z.boolean().default(false),
    edition: z.enum(['gov', 'med', 'ent']).default('gov'),
    qualityDeltaPp: z.string().default(''),
    latencyP95Sec: z.string().default(''),
    citationRegressionPp: z.string().default(''),
    unauthorizedRetrievalEvents: z.string().default(''),
    ciChecksGreen: z.boolean().default(false),
    qualityLedgerLinked: z.boolean().default(false),
    concurrentExperiments: z.string().default(''),
});

const GOVERNANCE_ITEM_SCHEMA = z.object({
    id: z.string().min(1),
    itemId: z.string(),
    pr: z.string(),
    summary: z.string(),
    actionRequested: z.string(),
    evidence: z.string(),
    owner: z.enum(['codex', 'claude', 'gemini']),
    lane: z.enum(['claude-execution', 'gemini-intake', 'shared-by-codex-only']),
    scopeGuard: z.string(),
    appState: z.string(),
    versionGuard: z.string(),
    scopeDelta: z.string(),
    decision: z.enum(['accept', 'rework-with-alternative', 'hard-reject', 'n/a']).default('n/a'),
    sourceEditApproval: z.enum(['approved', 'not-approved', 'n/a']).default('n/a'),
    mutualApprovalRef: z.string().default('n/a'),
    blockerReason: z.string().default(''),
    blockerEta: z.string().default(''),
    capabilityGate: CAPABILITY_GATE_SCHEMA.default({
        enabled: false,
        edition: 'gov',
        qualityDeltaPp: '',
        latencyP95Sec: '',
        citationRegressionPp: '',
        unauthorizedRetrievalEvents: '',
        ciChecksGreen: false,
        qualityLedgerLinked: false,
        concurrentExperiments: '',
    }),
    status: z.enum(['open', 'in_progress', 'closed']),
    createdAt: z.string(),
    updatedAt: z.string(),
    mergeGates: MERGE_GATES_SCHEMA,
    deviation: DEVIATION_SCHEMA,
});

const PAYLOAD_SCHEMA = z.object({
    items: z.array(GOVERNANCE_ITEM_SCHEMA).max(500),
});

const STORE_PATH = process.env.PROTOCOL_BOARD_STORE_PATH
    ? path.resolve(process.env.PROTOCOL_BOARD_STORE_PATH)
    : path.join(process.cwd(), '.data', 'protocol-board.json');

export const dynamic = 'force-dynamic';

interface ProtocolBoardStore {
    items: z.infer<typeof GOVERNANCE_ITEM_SCHEMA>[];
    updatedAt: string;
}

function defaultStore(): ProtocolBoardStore {
    return {
        items: [],
        updatedAt: new Date().toISOString(),
    };
}

async function ensureStoreDirectory(): Promise<void> {
    await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
}

async function readStore(): Promise<ProtocolBoardStore> {
    try {
        const raw = await fs.readFile(STORE_PATH, 'utf-8');
        const parsed = JSON.parse(raw) as unknown;

        if (Array.isArray(parsed)) {
            const validated = PAYLOAD_SCHEMA.safeParse({ items: parsed });
            if (validated.success) {
                return {
                    items: validated.data.items,
                    updatedAt: new Date().toISOString(),
                };
            }
            return defaultStore();
        }

        const storeSchema = z.object({
            items: z.array(GOVERNANCE_ITEM_SCHEMA),
            updatedAt: z.string(),
        });

        const validated = storeSchema.safeParse(parsed);
        return validated.success ? validated.data : defaultStore();
    } catch {
        return defaultStore();
    }
}

async function writeStore(items: z.infer<typeof GOVERNANCE_ITEM_SCHEMA>[]): Promise<ProtocolBoardStore> {
    const store: ProtocolBoardStore = {
        items,
        updatedAt: new Date().toISOString(),
    };

    await ensureStoreDirectory();
    await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
    return store;
}

export async function GET() {
    const store = await readStore();
    return NextResponse.json(store);
}

export async function PUT(req: Request) {
    try {
        const body = (await req.json()) as unknown;
        const parsed = PAYLOAD_SCHEMA.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                {
                    error: 'Invalid protocol board payload.',
                    details: parsed.error.flatten(),
                },
                { status: 400 }
            );
        }

        const store = await writeStore(parsed.data.items);
        return NextResponse.json(store);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return NextResponse.json(
            { error: message || 'Failed to persist protocol board.' },
            { status: 500 }
        );
    }
}
