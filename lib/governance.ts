export type GovernanceStatus = 'open' | 'in_progress' | 'closed';
export type GovernanceOwner = 'codex' | 'claude' | 'gemini';
export type GovernanceDecision = 'accept' | 'rework-with-alternative' | 'hard-reject' | 'n/a';
export type SourceEditApproval = 'approved' | 'not-approved' | 'n/a';
export type CapabilityEdition = 'gov' | 'med' | 'ent';
export type GovernanceLane =
    | 'claude-execution'
    | 'gemini-intake'
    | 'shared-by-codex-only';

export const CLOCK_SKEW_THRESHOLD_MS = 2 * 60 * 1000;
export const NO_IDLE_DECISION_GRACE_MS = 5 * 60 * 1000;
export const MODERATION_RESPONSE_SLA_MS = 10 * 60 * 1000;
export const CAPABILITY_LATENCY_SLO_SEC: Record<CapabilityEdition, number> = {
    gov: 5,
    med: 4,
    ent: 3,
};

export interface MergeGateChecklist {
    coreTestsAndE2E: boolean;
    evalRegression: boolean;
    latencySafetyCompliance: boolean;
    failureDiagnostics: boolean;
    trendArtifactUpdate: boolean;
    manualUiNote: boolean;
}

export interface DeviationContract {
    changed: string;
    reason: string;
    risk: string;
    gate: string;
}

export interface GovernanceItem {
    id: string;
    itemId: string;
    pr: string;
    summary: string;
    actionRequested: string;
    evidence: string;
    owner: GovernanceOwner;
    lane: GovernanceLane;
    scopeGuard: string;
    appState: string;
    versionGuard: string;
    scopeDelta: string;
    decision: GovernanceDecision;
    sourceEditApproval: SourceEditApproval;
    mutualApprovalRef: string;
    blockerReason: string;
    blockerEta: string;
    capabilityGate: CapabilityGateState;
    status: GovernanceStatus;
    createdAt: string;
    updatedAt: string;
    mergeGates: MergeGateChecklist;
    deviation: DeviationContract;
}

export interface CapabilityGateState {
    enabled: boolean;
    edition: CapabilityEdition;
    qualityDeltaPp: string;
    latencyP95Sec: string;
    citationRegressionPp: string;
    unauthorizedRetrievalEvents: string;
    ciChecksGreen: boolean;
    qualityLedgerLinked: boolean;
    concurrentExperiments: string;
}

export interface CapabilityGateEvaluation {
    pass: boolean;
    failures: string[];
}

export const DEFAULT_MERGE_GATES: MergeGateChecklist = {
    coreTestsAndE2E: false,
    evalRegression: false,
    latencySafetyCompliance: false,
    failureDiagnostics: false,
    trendArtifactUpdate: false,
    manualUiNote: false,
};

export function createGovernanceItem(): GovernanceItem {
    const now = new Date().toISOString();
    return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        itemId: '',
        pr: 'n/a',
        summary: '',
        actionRequested: '',
        evidence: '',
        owner: 'codex',
        lane: 'shared-by-codex-only',
        scopeGuard: '',
        appState: '',
        versionGuard: '',
        scopeDelta: '',
        decision: 'n/a',
        sourceEditApproval: 'n/a',
        mutualApprovalRef: 'n/a',
        blockerReason: '',
        blockerEta: '',
        capabilityGate: {
            enabled: false,
            edition: 'gov',
            qualityDeltaPp: '',
            latencyP95Sec: '',
            citationRegressionPp: '',
            unauthorizedRetrievalEvents: '',
            ciChecksGreen: false,
            qualityLedgerLinked: false,
            concurrentExperiments: '',
        },
        status: 'open',
        createdAt: now,
        updatedAt: now,
        mergeGates: { ...DEFAULT_MERGE_GATES },
        deviation: {
            changed: '',
            reason: '',
            risk: '',
            gate: '',
        },
    };
}

export function hasRequiredPreflight(item: GovernanceItem): boolean {
    return Boolean(
        item.appState.trim() &&
        item.versionGuard.trim() &&
        item.scopeDelta.trim()
    );
}

export function hasCompletedCloseGates(item: GovernanceItem): boolean {
    return Object.values(item.mergeGates).every(Boolean) && Boolean(item.evidence.trim());
}

export function hasRequiredDecision(item: GovernanceItem): boolean {
    if (item.owner !== 'codex') {
        return true;
    }
    return item.decision !== 'n/a';
}

function parseMetricNumber(value: string): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

export function evaluateCapabilityGate(gate: CapabilityGateState): CapabilityGateEvaluation {
    if (!gate.enabled) {
        return { pass: true, failures: [] };
    }

    const failures: string[] = [];
    const qualityDelta = parseMetricNumber(gate.qualityDeltaPp);
    const latency = parseMetricNumber(gate.latencyP95Sec);
    const citation = parseMetricNumber(gate.citationRegressionPp);
    const unauthorizedEvents = parseMetricNumber(gate.unauthorizedRetrievalEvents);
    const experiments = parseMetricNumber(gate.concurrentExperiments);
    const latencySlo = CAPABILITY_LATENCY_SLO_SEC[gate.edition];

    if (qualityDelta === null || qualityDelta < 0) {
        failures.push('Quality delta must be >= 0pp.');
    }
    if (latency === null || latency > latencySlo) {
        failures.push(`Latency p95 must be <= ${latencySlo}s for ${gate.edition.toUpperCase()}.`);
    }
    if (citation === null || citation > 0.5) {
        failures.push('Citation precision regression must be <= 0.5pp.');
    }
    if (unauthorizedEvents === null || unauthorizedEvents !== 0) {
        failures.push('Unauthorized retrieval events must be 0.');
    }
    if (!gate.ciChecksGreen) {
        failures.push('All CI checks must be green.');
    }
    if (!gate.qualityLedgerLinked) {
        failures.push('Quality ledger evidence must be linked.');
    }
    if (experiments === null || experiments < 0 || experiments > 2) {
        failures.push('Concurrent experiments must be between 0 and 2.');
    }

    return {
        pass: failures.length === 0,
        failures,
    };
}

export function hasBlockerEta(item: GovernanceItem): boolean {
    return Boolean(item.blockerReason.trim() && item.blockerEta.trim());
}

function parseTimestamp(iso: string): number | null {
    const parsed = Date.parse(iso);
    return Number.isNaN(parsed) ? null : parsed;
}

export function getFutureTimestampSkewMs(item: GovernanceItem, nowMs = Date.now()): number {
    const createdAtMs = parseTimestamp(item.createdAt);
    const updatedAtMs = parseTimestamp(item.updatedAt);

    const futureCreated = createdAtMs ? Math.max(0, createdAtMs - nowMs) : 0;
    const futureUpdated = updatedAtMs ? Math.max(0, updatedAtMs - nowMs) : 0;
    return Math.max(futureCreated, futureUpdated);
}

export function hasFutureTimestampSkew(
    item: GovernanceItem,
    nowMs = Date.now(),
    thresholdMs = CLOCK_SKEW_THRESHOLD_MS
): boolean {
    return getFutureTimestampSkewMs(item, nowMs) > thresholdMs;
}

export function requiresImmediateDecisionAction(item: GovernanceItem): boolean {
    return item.owner !== 'codex' && item.status === 'open' && item.decision !== 'n/a';
}

export function hasNoIdleDecisionBreach(
    item: GovernanceItem,
    nowMs = Date.now(),
    graceMs = NO_IDLE_DECISION_GRACE_MS
): boolean {
    if (!requiresImmediateDecisionAction(item)) {
        return false;
    }

    if (hasBlockerEta(item)) {
        return false;
    }

    const updatedAtMs = parseTimestamp(item.updatedAt);
    if (!updatedAtMs) {
        return true;
    }

    return nowMs - updatedAtMs > graceMs;
}

export function requiresModerationResponse(item: GovernanceItem): boolean {
    return (
        item.owner !== 'codex' &&
        item.decision === 'n/a' &&
        (item.status === 'open' || item.status === 'in_progress')
    );
}

export function hasStaleModerationBreach(
    item: GovernanceItem,
    nowMs = Date.now(),
    slaMs = MODERATION_RESPONSE_SLA_MS
): boolean {
    if (!requiresModerationResponse(item)) {
        return false;
    }

    const updatedAtMs = parseTimestamp(item.updatedAt);
    if (!updatedAtMs) {
        return true;
    }

    return nowMs - updatedAtMs > slaMs;
}

export function countActiveItems(items: GovernanceItem[], excludeId?: string): number {
    return items.filter((item) => item.id !== excludeId && item.status !== 'closed').length;
}
