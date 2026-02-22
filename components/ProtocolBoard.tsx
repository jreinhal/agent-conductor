'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    CAPABILITY_LATENCY_SLO_SEC,
    CLOCK_SKEW_THRESHOLD_MS,
    GovernanceItem,
    MergeGateChecklist,
    MODERATION_RESPONSE_SLA_MS,
    countActiveItems,
    createGovernanceItem,
    evaluateCapabilityGate,
    hasBlockerEta,
    hasCompletedCloseGates,
    hasFutureTimestampSkew,
    hasNoIdleDecisionBreach,
    hasRequiredDecision,
    hasRequiredPreflight,
    hasStaleModerationBreach,
    requiresImmediateDecisionAction,
    requiresModerationResponse,
} from '@/lib/governance';

const STORAGE_KEY = 'agent_conductor_protocol_board_v1';
const API_ENDPOINT = '/api/protocol-board';
const OWNER_DEFAULT_LANE: Record<GovernanceItem['owner'], GovernanceItem['lane']> = {
    codex: 'shared-by-codex-only',
    claude: 'claude-execution',
    gemini: 'gemini-intake',
};

interface ProtocolBoardProps {
    isOpen: boolean;
    onClose: () => void;
}

function readStoredItems(): GovernanceItem[] {
    if (typeof window === 'undefined') {
        return [];
    }

    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];

        const parsed = JSON.parse(raw) as unknown;
        return normalizeItems(parsed);
    } catch {
        return [];
    }
}

function normalizeItems(raw: unknown): GovernanceItem[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((item) => normalizeItem(item as Partial<GovernanceItem>));
}

function normalizeItem(raw: Partial<GovernanceItem>): GovernanceItem {
    const fallback = createGovernanceItem();
    return {
        ...fallback,
        ...raw,
        id: raw.id || fallback.id,
        decision: raw.decision || 'n/a',
        sourceEditApproval: raw.sourceEditApproval || 'n/a',
        mutualApprovalRef: raw.mutualApprovalRef || 'n/a',
        blockerReason: raw.blockerReason || '',
        blockerEta: raw.blockerEta || '',
        capabilityGate: {
            ...fallback.capabilityGate,
            ...(raw.capabilityGate || {}),
        },
        mergeGates: {
            ...fallback.mergeGates,
            ...(raw.mergeGates || {}),
        },
        deviation: {
            ...fallback.deviation,
            ...(raw.deviation || {}),
        },
    };
}

function formatDate(iso: string): string {
    try {
        return new Date(iso).toLocaleString();
    } catch {
        return iso;
    }
}

function statusClass(status: GovernanceItem['status']): string {
    if (status === 'closed') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300';
    if (status === 'in_progress') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
    return 'ac-badge';
}

export function ProtocolBoard({ isOpen, onClose }: ProtocolBoardProps) {
    const [items, setItems] = useState<GovernanceItem[]>(() => readStoredItems());
    const [selectedId, setSelectedId] = useState<string | null>(() => {
        const seeded = readStoredItems();
        return seeded.length > 0 ? seeded[0].id : null;
    });
    const [notice, setNotice] = useState<string | null>(null);
    const [isSyncing, setIsSyncing] = useState(false);
    const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
    const [remoteBootstrapped, setRemoteBootstrapped] = useState(false);

    const pushItemsToServer = useCallback(async (nextItems: GovernanceItem[]) => {
        const response = await fetch(API_ENDPOINT, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: nextItems }),
        });

        if (!response.ok) {
            throw new Error(`Protocol sync failed (${response.status})`);
        }

        const payload = (await response.json()) as { updatedAt?: string };
        return typeof payload.updatedAt === 'string'
            ? payload.updatedAt
            : new Date().toISOString();
    }, []);

    const syncNow = useCallback(async (nextItems: GovernanceItem[], manual = false) => {
        setIsSyncing(true);
        try {
            const updatedAt = await pushItemsToServer(nextItems);
            setLastSyncedAt(updatedAt);
            if (manual) {
                setNotice('Protocol Board synced to server.');
            }
        } catch {
            if (manual) {
                setNotice('Protocol Board sync failed. Using local state until server is available.');
            }
        } finally {
            setIsSyncing(false);
        }
    }, [pushItemsToServer]);

    useEffect(() => {
        let cancelled = false;

        const bootstrap = async () => {
            setIsSyncing(true);
            try {
                const response = await fetch(API_ENDPOINT, { cache: 'no-store' });
                if (!response.ok) {
                    throw new Error(`Protocol fetch failed (${response.status})`);
                }

                const payload = (await response.json()) as {
                    items?: GovernanceItem[];
                    updatedAt?: string;
                };

                if (cancelled) return;

                const remoteItems = normalizeItems(payload.items);
                if (remoteItems.length > 0) {
                    setItems(remoteItems);
                    setSelectedId((current) => {
                        if (current && remoteItems.some((item) => item.id === current)) {
                            return current;
                        }
                        return remoteItems[0].id;
                    });
                    setLastSyncedAt(payload.updatedAt || new Date().toISOString());
                } else {
                    const localSeed = readStoredItems();
                    if (localSeed.length === 0) {
                        setLastSyncedAt(payload.updatedAt || new Date().toISOString());
                        return;
                    }

                    const updatedAt = await pushItemsToServer(localSeed);
                    if (!cancelled) {
                        setItems(localSeed);
                        setSelectedId((current) => current || localSeed[0]?.id || null);
                        setLastSyncedAt(updatedAt);
                    }
                    return;
                }
            } catch {
                if (!cancelled) {
                    setNotice('Protocol server sync unavailable. Running from local storage.');
                }
            } finally {
                if (!cancelled) {
                    setIsSyncing(false);
                    setRemoteBootstrapped(true);
                }
            }
        };

        void bootstrap();
        return () => {
            cancelled = true;
        };
    }, [pushItemsToServer]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    }, [items]);

    useEffect(() => {
        if (!remoteBootstrapped) return;
        const timeout = window.setTimeout(() => {
            void syncNow(items, false);
        }, 700);
        return () => window.clearTimeout(timeout);
    }, [items, remoteBootstrapped, syncNow]);

    const selectedItem = useMemo(
        () => items.find((item) => item.id === selectedId) || null,
        [items, selectedId]
    );
    const selectedCapabilityEvaluation = useMemo(
        () => (selectedItem ? evaluateCapabilityGate(selectedItem.capabilityGate) : null),
        [selectedItem]
    );
    const skewedItemIds = useMemo(
        () => new Set(items.filter((item) => hasFutureTimestampSkew(item)).map((item) => item.id)),
        [items]
    );
    const noIdleBreachItemIds = useMemo(
        () => new Set(items.filter((item) => hasNoIdleDecisionBreach(item)).map((item) => item.id)),
        [items]
    );
    const staleModerationItemIds = useMemo(
        () => new Set(items.filter((item) => hasStaleModerationBreach(item)).map((item) => item.id)),
        [items]
    );

    const mutateSelected = useCallback((mutator: (item: GovernanceItem) => GovernanceItem) => {
        if (!selectedId) return;

        setItems((prev) =>
            prev.map((item) =>
                item.id === selectedId
                    ? { ...mutator(item), updatedAt: new Date().toISOString() }
                    : item
            )
        );
    }, [selectedId]);

    const createItem = useCallback(() => {
        if (countActiveItems(items) > 0) {
            setNotice('WIP=1 enforced: close the active item before creating another.');
            return;
        }

        const item = createGovernanceItem();
        setItems((prev) => [item, ...prev]);
        setSelectedId(item.id);
        setNotice(null);
    }, [items]);

    const markInProgress = useCallback(() => {
        if (!selectedItem) return;

        if (!hasRequiredPreflight(selectedItem)) {
            setNotice('Preflight required: fill app_state, version_guard, and scope_delta first.');
            return;
        }

        if (
            selectedItem.sourceEditApproval === 'approved' &&
            (!selectedItem.mutualApprovalRef.trim() || selectedItem.mutualApprovalRef.trim() === 'n/a')
        ) {
            setNotice('Mutual approval reference is required when source_edit_approval=approved.');
            return;
        }

        if (countActiveItems(items, selectedItem.id) > 0) {
            setNotice('WIP=1 enforced: another item is already open/in progress.');
            return;
        }

        mutateSelected((item) => ({ ...item, status: 'in_progress' }));
        setNotice(null);
    }, [items, mutateSelected, selectedItem]);

    const markClosed = useCallback(() => {
        if (!selectedItem) return;

        if (!hasCompletedCloseGates(selectedItem)) {
            setNotice('Close gate failed: check all merge gates and include evidence.');
            return;
        }

        if (!hasRequiredDecision(selectedItem)) {
            setNotice('Codex-owned items require a decision before closure.');
            return;
        }

        const capabilityEval = evaluateCapabilityGate(selectedItem.capabilityGate);
        if (!capabilityEval.pass) {
            setNotice(`Capability gate failed: ${capabilityEval.failures[0]}`);
            return;
        }

        mutateSelected((item) => ({ ...item, status: 'closed' }));
        setNotice(null);
    }, [mutateSelected, selectedItem]);

    const copyRecoveryPing = useCallback(async () => {
        if (!selectedItem) return;

        const ping = `[${new Date().toISOString()}] [author: ${selectedItem.owner}] [status: in_progress]
item_id: process-reset-recovery
summary: recovered from freeze/reset + current blocker state + next action
action_requested: n/a
evidence: n/a
owner: ${selectedItem.owner}
lane: ${selectedItem.lane}
scope_guard: ${selectedItem.scopeGuard || 'n/a'}
app_state: ${selectedItem.appState || 'none'}
version_guard: ${selectedItem.versionGuard || 'none'}
scope_delta: ${selectedItem.scopeDelta || 'n/a'}
decision: ${selectedItem.decision || 'n/a'}
source_edit_approval: ${selectedItem.sourceEditApproval || 'n/a'}
mutual_approval_ref: ${selectedItem.mutualApprovalRef || 'n/a'}
blocker_reason: ${selectedItem.blockerReason || 'n/a'}
blocker_eta: ${selectedItem.blockerEta || 'n/a'}`;

        try {
            await navigator.clipboard.writeText(ping);
            setNotice('Recovery ping template copied to clipboard.');
        } catch {
            setNotice('Could not copy recovery ping template.');
        }
    }, [selectedItem]);

    const updateField = <K extends keyof GovernanceItem>(key: K, value: GovernanceItem[K]) => {
        mutateSelected((item) => ({ ...item, [key]: value }));
    };

    const updateDecision = (decision: GovernanceItem['decision']) => {
        if (!selectedItem) return;

        mutateSelected((item) => {
            const next: GovernanceItem = { ...item, decision };
            if (
                item.owner !== 'codex' &&
                decision !== 'n/a' &&
                item.status === 'open' &&
                hasRequiredPreflight(item) &&
                !hasBlockerEta(item)
            ) {
                next.status = 'in_progress';
            }
            return next;
        });

        if (selectedItem.owner !== 'codex' && decision !== 'n/a') {
            if (
                selectedItem.status === 'open' &&
                hasRequiredPreflight(selectedItem) &&
                !hasBlockerEta(selectedItem)
            ) {
                setNotice('No-idle rule applied: item moved to in_progress after decision.');
            } else if (selectedItem.status === 'open') {
                setNotice('Decision recorded. No-idle: fill preflight fields and move to in_progress immediately.');
            }
        }
    };

    const updateOwner = (owner: GovernanceItem['owner']) => {
        mutateSelected((item) => ({
            ...item,
            owner,
            lane: OWNER_DEFAULT_LANE[owner],
        }));
    };

    const updateCapabilityGateField = <K extends keyof GovernanceItem['capabilityGate']>(
        key: K,
        value: GovernanceItem['capabilityGate'][K]
    ) => {
        mutateSelected((item) => ({
            ...item,
            capabilityGate: {
                ...item.capabilityGate,
                [key]: value,
            },
        }));
    };

    const setBlockerEtaTemplate = useCallback(() => {
        const eta = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        mutateSelected((item) => ({
            ...item,
            blockerEta: eta,
            blockerReason: item.blockerReason.trim() || 'Blocked, waiting on dependency/user confirmation.',
        }));
        setNotice('Blocker + ETA template applied (+30m).');
    }, [mutateSelected]);

    const normalizeClockSkew = useCallback(() => {
        if (!selectedItem) return;

        const nowMs = Date.now();
        const nowIso = new Date(nowMs).toISOString();
        mutateSelected((item) => {
            const createdAtMs = Date.parse(item.createdAt);
            const updatedAtMs = Date.parse(item.updatedAt);
            return {
                ...item,
                createdAt: !Number.isNaN(createdAtMs) && createdAtMs > nowMs ? nowIso : item.createdAt,
                updatedAt: !Number.isNaN(updatedAtMs) && updatedAtMs > nowMs ? nowIso : item.updatedAt,
            };
        });
        setNotice('Clock-skew timestamps normalized to local UTC for selected item.');
    }, [mutateSelected, selectedItem]);

    const updateMergeGate = <K extends keyof MergeGateChecklist>(key: K, value: boolean) => {
        mutateSelected((item) => ({
            ...item,
            mergeGates: {
                ...item.mergeGates,
                [key]: value,
            },
        }));
    };

    if (!isOpen) return null;

    const activeCount = items.filter((item) => item.status !== 'closed').length;
    const skewedCount = skewedItemIds.size;
    const noIdleBreachCount = noIdleBreachItemIds.size;
    const staleModerationCount = staleModerationItemIds.size;
    const selectedHasClockSkew = selectedItem ? skewedItemIds.has(selectedItem.id) : false;
    const selectedHasNoIdleBreach = selectedItem ? noIdleBreachItemIds.has(selectedItem.id) : false;
    const selectedHasStaleModerationBreach = selectedItem ? staleModerationItemIds.has(selectedItem.id) : false;

    return (
        <div
            className="ac-overlay fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={onClose}
        >
            <div
                className="ac-modal-shell w-full max-w-6xl h-[88vh] rounded-2xl flex flex-col overflow-hidden"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="px-5 py-3 border-b border-[color:var(--ac-border-soft)] flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-semibold text-[color:var(--ac-text)]">Protocol Board</h2>
                        <p className="text-xs text-[color:var(--ac-text-dim)]">
                            WIP=1, preflight gate, close-evidence gate, and ownership lanes
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => void syncNow(items, true)}
                            disabled={isSyncing}
                            className="control-chip px-3 py-1.5 text-xs font-medium disabled:opacity-60"
                        >
                            {isSyncing ? 'Syncing...' : 'Sync Now'}
                        </button>
                        <span className="ac-badge px-2 py-1 rounded-md text-xs">
                            {activeCount} active / {items.length} total
                        </span>
                        {lastSyncedAt && (
                            <span className="text-[11px] text-[color:var(--ac-text-muted)]">
                                last sync {formatDate(lastSyncedAt)}
                            </span>
                        )}
                        <button
                            onClick={onClose}
                            className="control-chip p-2"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>

                {notice && (
                    <div className="px-5 py-2 text-xs border-b border-[color:var(--ac-border-soft)] text-[color:var(--ac-text-dim)] bg-[color:var(--ac-surface)]">
                        {notice}
                    </div>
                )}
                {(skewedCount > 0 || noIdleBreachCount > 0 || staleModerationCount > 0) && (
                    <div className="px-5 py-2 text-xs border-b border-[color:var(--ac-border-soft)] text-amber-300 bg-amber-900/18 flex flex-wrap items-center gap-3">
                        {skewedCount > 0 && (
                            <span>
                                {skewedCount} item(s) have future timestamps (&gt;
                                {Math.round(CLOCK_SKEW_THRESHOLD_MS / 60000)}m).
                            </span>
                        )}
                        {staleModerationCount > 0 && (
                            <span>
                                {staleModerationCount} item(s) exceeded moderation SLA (&gt;
                                {Math.round(MODERATION_RESPONSE_SLA_MS / 60000)}m).
                            </span>
                        )}
                        {noIdleBreachCount > 0 && (
                            <span>
                                {noIdleBreachCount} item(s) breach no-idle after decision and need immediate action.
                            </span>
                        )}
                    </div>
                )}

                <div className="flex-1 min-h-0 flex">
                    <aside className="w-80 border-r border-[color:var(--ac-border-soft)] p-3 flex flex-col gap-3 bg-[color:var(--ac-surface)]/55">
                        <button
                            onClick={createItem}
                            className="ac-btn-primary w-full px-3 py-2 rounded-lg text-sm font-medium transition-all"
                        >
                            New Governance Item
                        </button>

                        <div className="flex-1 overflow-y-auto space-y-2">
                            {items.length === 0 && (
                                <div className="text-xs text-[color:var(--ac-text-muted)] p-2">
                                    No items yet. Create one to start protocol tracking.
                                </div>
                            )}

                            {items.map((item) => (
                                <button
                                    key={item.id}
                                    onClick={() => setSelectedId(item.id)}
                                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                                        item.id === selectedId
                                            ? 'border-[color:var(--ac-accent)] bg-[color:var(--ac-surface-strong)]'
                                            : 'border-[color:var(--ac-border-soft)] bg-[color:var(--ac-surface)] hover:border-[color:var(--ac-border)]'
                                    }`}
                                >
                                    <div className="flex items-center justify-between gap-2 mb-1">
                                        <span className="text-sm font-medium text-[color:var(--ac-text)] truncate">
                                            {item.itemId || 'Untitled item'}
                                        </span>
                                        <span className={`px-2 py-0.5 text-[10px] rounded-full ${statusClass(item.status)}`}>
                                            {item.status.replace('_', ' ')}
                                        </span>
                                    </div>
                                    <div className="text-[11px] text-[color:var(--ac-text-dim)] line-clamp-2">
                                        {item.summary || 'No summary yet.'}
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-1">
                                        {skewedItemIds.has(item.id) && (
                                            <span className="px-1.5 py-0.5 text-[10px] rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                                                clock skew
                                            </span>
                                        )}
                                        {noIdleBreachItemIds.has(item.id) && (
                                            <span className="px-1.5 py-0.5 text-[10px] rounded bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
                                                no-idle breach
                                            </span>
                                        )}
                                        {staleModerationItemIds.has(item.id) && (
                                            <span className="px-1.5 py-0.5 text-[10px] rounded bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">
                                                moderation stale
                                            </span>
                                        )}
                                    </div>
                                    <div className="mt-2 flex items-center justify-between text-[10px] text-[color:var(--ac-text-muted)]">
                                        <span>{item.owner}</span>
                                        <span>{formatDate(item.updatedAt)}</span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </aside>

                    <section className="flex-1 min-h-0 overflow-y-auto p-5">
                        {!selectedItem && (
                            <div className="text-sm text-[color:var(--ac-text-muted)]">
                                Select an item to edit protocol details.
                            </div>
                        )}

                        {selectedItem && (
                            <div className="space-y-5">
                                {(selectedHasClockSkew || selectedHasNoIdleBreach || selectedHasStaleModerationBreach) && (
                                    <div className="rounded-lg border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                                        {selectedHasClockSkew && (
                                            <div>Timestamp warning: selected item is ahead of current UTC.</div>
                                        )}
                                        {selectedHasStaleModerationBreach && (
                                            <div>Moderation SLA warning: item has awaited codex response longer than 10 minutes.</div>
                                        )}
                                        {selectedHasNoIdleBreach && (
                                            <div>No-idle warning: decision exists while item is still open past grace window.</div>
                                        )}
                                    </div>
                                )}
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        onClick={markInProgress}
                                        disabled={selectedItem.status === 'in_progress' || selectedItem.status === 'closed'}
                                        className="px-3 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                                        style={{ background: 'color-mix(in srgb, var(--ac-accent-warm) 85%, #000 15%)' }}
                                    >
                                        Mark In Progress
                                    </button>
                                    <button
                                        onClick={markClosed}
                                        disabled={selectedItem.status === 'closed'}
                                        className="px-3 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                                        style={{ background: 'color-mix(in srgb, var(--ac-success) 85%, #000 15%)' }}
                                    >
                                        Mark Closed
                                    </button>
                                    <button
                                        onClick={copyRecoveryPing}
                                        className="control-chip px-3 py-1.5 rounded-lg text-sm font-medium"
                                    >
                                        Copy Recovery Ping
                                    </button>
                                    {selectedItem.owner !== 'codex' && (
                                        <button
                                            onClick={setBlockerEtaTemplate}
                                            className="px-3 py-1.5 rounded-lg text-sm font-medium"
                                            style={{
                                                border: '1px solid color-mix(in srgb, var(--ac-accent-warm) 65%, var(--ac-border))',
                                                background: 'color-mix(in srgb, var(--ac-accent-warm) 20%, transparent)',
                                                color: 'color-mix(in srgb, var(--ac-accent-warm) 88%, white 12%)',
                                            }}
                                        >
                                            Set Blocker + ETA
                                        </button>
                                    )}
                                    {selectedHasClockSkew && (
                                        <button
                                            onClick={normalizeClockSkew}
                                            className="px-3 py-1.5 rounded-lg text-sm font-medium"
                                            style={{
                                                border: '1px solid color-mix(in srgb, var(--ac-accent-warm) 65%, var(--ac-border))',
                                                background: 'color-mix(in srgb, var(--ac-accent-warm) 20%, transparent)',
                                                color: 'color-mix(in srgb, var(--ac-accent-warm) 88%, white 12%)',
                                            }}
                                        >
                                            Normalize Clock Skew
                                        </button>
                                    )}
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <Field label="item_id" value={selectedItem.itemId} onChange={(value) => updateField('itemId', value)} />
                                    <Field label="pr" value={selectedItem.pr} onChange={(value) => updateField('pr', value)} />
                                    <SelectField
                                        label="owner"
                                        value={selectedItem.owner}
                                        onChange={(value) => updateOwner(value as GovernanceItem['owner'])}
                                        options={['codex', 'claude', 'gemini']}
                                    />
                                    <SelectField
                                        label="lane"
                                        value={selectedItem.lane}
                                        onChange={(value) => updateField('lane', value as GovernanceItem['lane'])}
                                        options={['claude-execution', 'gemini-intake', 'shared-by-codex-only']}
                                    />
                                    <SelectField
                                        label="decision"
                                        value={selectedItem.decision}
                                        onChange={(value) => updateDecision(value as GovernanceItem['decision'])}
                                        options={['n/a', 'accept', 'rework-with-alternative', 'hard-reject']}
                                    />
                                    <SelectField
                                        label="source_edit_approval"
                                        value={selectedItem.sourceEditApproval}
                                        onChange={(value) => updateField('sourceEditApproval', value as GovernanceItem['sourceEditApproval'])}
                                        options={['n/a', 'approved', 'not-approved']}
                                    />
                                    <Field
                                        label="mutual_approval_ref"
                                        value={selectedItem.mutualApprovalRef}
                                        onChange={(value) => updateField('mutualApprovalRef', value)}
                                    />
                                </div>
                                {requiresImmediateDecisionAction(selectedItem) && !hasBlockerEta(selectedItem) && (
                                    <div className="text-xs text-rose-400">
                                        No-idle policy: this item must move out of open state immediately after decision.
                                    </div>
                                )}
                                {requiresImmediateDecisionAction(selectedItem) && hasBlockerEta(selectedItem) && (
                                    <div className="text-xs text-orange-300">
                                        Blocker/ETA recorded. Update when unblocked and move to in_progress.
                                    </div>
                                )}
                                {requiresModerationResponse(selectedItem) && (
                                    <div className="text-xs text-orange-300">
                                        Moderation SLA: codex response required within 10 minutes from latest update.
                                    </div>
                                )}

                                <TextAreaField
                                    label="summary"
                                    value={selectedItem.summary}
                                    onChange={(value) => updateField('summary', value)}
                                />
                                <TextAreaField
                                    label="action_requested"
                                    value={selectedItem.actionRequested}
                                    onChange={(value) => updateField('actionRequested', value)}
                                />
                                <TextAreaField
                                    label="scope_guard"
                                    value={selectedItem.scopeGuard}
                                    onChange={(value) => updateField('scopeGuard', value)}
                                />

                                <div className="ac-soft-surface rounded-lg p-4 space-y-3">
                                    <h3 className="text-sm font-semibold text-[color:var(--ac-text)]">Blocker / ETA (no-idle fallback)</h3>
                                    <TextAreaField
                                        label="blocker_reason"
                                        value={selectedItem.blockerReason}
                                        onChange={(value) => updateField('blockerReason', value)}
                                        placeholder="What is blocking execution?"
                                    />
                                    <Field
                                        label="blocker_eta"
                                        value={selectedItem.blockerEta}
                                        onChange={(value) => updateField('blockerEta', value)}
                                    />
                                </div>

                                <div className="ac-soft-surface rounded-lg p-4 space-y-3">
                                    <h3 className="text-sm font-semibold text-[color:var(--ac-text)]">Preflight Snapshot (required before in_progress)</h3>
                                    <TextAreaField
                                        label="app_state"
                                        value={selectedItem.appState}
                                        onChange={(value) => updateField('appState', value)}
                                    />
                                    <Field
                                        label="version_guard"
                                        value={selectedItem.versionGuard}
                                        onChange={(value) => updateField('versionGuard', value)}
                                    />
                                    <TextAreaField
                                        label="scope_delta"
                                        value={selectedItem.scopeDelta}
                                        onChange={(value) => updateField('scopeDelta', value)}
                                    />
                                </div>

                                <div className="ac-soft-surface rounded-lg p-4 space-y-3">
                                    <div className="flex items-center justify-between gap-3">
                                        <h3 className="text-sm font-semibold text-[color:var(--ac-text)]">
                                            Capability Promotion Gate (OFF-&gt;ON)
                                        </h3>
                                        <label className="flex items-center gap-2 text-xs text-[color:var(--ac-text-dim)]">
                                            <input
                                                type="checkbox"
                                                checked={selectedItem.capabilityGate.enabled}
                                                onChange={(event) => updateCapabilityGateField('enabled', event.target.checked)}
                                                className="rounded border-gray-300 dark:border-gray-600"
                                            />
                                            enable gate
                                        </label>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <SelectField
                                            label="edition"
                                            value={selectedItem.capabilityGate.edition}
                                            onChange={(value) => updateCapabilityGateField('edition', value as GovernanceItem['capabilityGate']['edition'])}
                                            options={['gov', 'med', 'ent']}
                                        />
                                        <Field
                                            label="quality_delta_pp (>= 0)"
                                            value={selectedItem.capabilityGate.qualityDeltaPp}
                                            onChange={(value) => updateCapabilityGateField('qualityDeltaPp', value)}
                                        />
                                        <Field
                                            label={`latency_p95_sec (<= ${CAPABILITY_LATENCY_SLO_SEC[selectedItem.capabilityGate.edition]} for ${selectedItem.capabilityGate.edition.toUpperCase()})`}
                                            value={selectedItem.capabilityGate.latencyP95Sec}
                                            onChange={(value) => updateCapabilityGateField('latencyP95Sec', value)}
                                        />
                                        <Field
                                            label="citation_regression_pp (<= 0.5)"
                                            value={selectedItem.capabilityGate.citationRegressionPp}
                                            onChange={(value) => updateCapabilityGateField('citationRegressionPp', value)}
                                        />
                                        <Field
                                            label="unauthorized_retrieval_events (= 0)"
                                            value={selectedItem.capabilityGate.unauthorizedRetrievalEvents}
                                            onChange={(value) => updateCapabilityGateField('unauthorizedRetrievalEvents', value)}
                                        />
                                        <Field
                                            label="concurrent_experiments (0..2)"
                                            value={selectedItem.capabilityGate.concurrentExperiments}
                                            onChange={(value) => updateCapabilityGateField('concurrentExperiments', value)}
                                        />
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <label className="flex items-center gap-2 text-sm text-[color:var(--ac-text-dim)]">
                                            <input
                                                type="checkbox"
                                                checked={selectedItem.capabilityGate.ciChecksGreen}
                                                onChange={(event) => updateCapabilityGateField('ciChecksGreen', event.target.checked)}
                                                className="rounded border-gray-300 dark:border-gray-600"
                                            />
                                            <span>all CI checks green</span>
                                        </label>
                                        <label className="flex items-center gap-2 text-sm text-[color:var(--ac-text-dim)]">
                                            <input
                                                type="checkbox"
                                                checked={selectedItem.capabilityGate.qualityLedgerLinked}
                                                onChange={(event) => updateCapabilityGateField('qualityLedgerLinked', event.target.checked)}
                                                className="rounded border-gray-300 dark:border-gray-600"
                                            />
                                            <span>quality ledger evidence linked</span>
                                        </label>
                                    </div>

                                    {selectedCapabilityEvaluation && selectedItem.capabilityGate.enabled && (
                                        <div
                                            className={`text-xs rounded-lg px-3 py-2 border ${
                                                selectedCapabilityEvaluation.pass
                                                    ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                                                    : 'bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300'
                                            }`}
                                        >
                                            {selectedCapabilityEvaluation.pass
                                                ? 'Capability gate pass.'
                                                : `Capability gate fail: ${selectedCapabilityEvaluation.failures.join(' ')}`}
                                        </div>
                                    )}
                                </div>

                                <div className="ac-soft-surface rounded-lg p-4 space-y-3">
                                    <h3 className="text-sm font-semibold text-[color:var(--ac-text)]">Deviation Contract (optional)</h3>
                                    <TextAreaField
                                        label="changed"
                                        value={selectedItem.deviation.changed}
                                        onChange={(value) => mutateSelected((item) => ({
                                            ...item,
                                            deviation: { ...item.deviation, changed: value },
                                        }))}
                                    />
                                    <TextAreaField
                                        label="reason"
                                        value={selectedItem.deviation.reason}
                                        onChange={(value) => mutateSelected((item) => ({
                                            ...item,
                                            deviation: { ...item.deviation, reason: value },
                                        }))}
                                    />
                                    <TextAreaField
                                        label="risk"
                                        value={selectedItem.deviation.risk}
                                        onChange={(value) => mutateSelected((item) => ({
                                            ...item,
                                            deviation: { ...item.deviation, risk: value },
                                        }))}
                                    />
                                    <TextAreaField
                                        label="gate"
                                        value={selectedItem.deviation.gate}
                                        onChange={(value) => mutateSelected((item) => ({
                                            ...item,
                                            deviation: { ...item.deviation, gate: value },
                                        }))}
                                    />
                                </div>

                                <div className="ac-soft-surface rounded-lg p-4 space-y-3">
                                    <h3 className="text-sm font-semibold text-[color:var(--ac-text)]">Close Gate Checklist</h3>
                                    <GateRow
                                        label="core tests + E2E"
                                        checked={selectedItem.mergeGates.coreTestsAndE2E}
                                        onChange={(value) => updateMergeGate('coreTestsAndE2E', value)}
                                    />
                                    <GateRow
                                        label="eval regression gate (or waiver)"
                                        checked={selectedItem.mergeGates.evalRegression}
                                        onChange={(value) => updateMergeGate('evalRegression', value)}
                                    />
                                    <GateRow
                                        label="latency/safety/compliance checks"
                                        checked={selectedItem.mergeGates.latencySafetyCompliance}
                                        onChange={(value) => updateMergeGate('latencySafetyCompliance', value)}
                                    />
                                    <GateRow
                                        label="eval failure diagnostics linked"
                                        checked={selectedItem.mergeGates.failureDiagnostics}
                                        onChange={(value) => updateMergeGate('failureDiagnostics', value)}
                                    />
                                    <GateRow
                                        label="trend artifact updated"
                                        checked={selectedItem.mergeGates.trendArtifactUpdate}
                                        onChange={(value) => updateMergeGate('trendArtifactUpdate', value)}
                                    />
                                    <GateRow
                                        label="manual UI exploratory note"
                                        checked={selectedItem.mergeGates.manualUiNote}
                                        onChange={(value) => updateMergeGate('manualUiNote', value)}
                                    />

                                    <TextAreaField
                                        label="evidence"
                                        value={selectedItem.evidence}
                                        onChange={(value) => updateField('evidence', value)}
                                        placeholder="Commit/PR/artifact paths"
                                    />
                                </div>

                                <div className="text-xs text-[color:var(--ac-text-muted)]">
                                    Created: {formatDate(selectedItem.createdAt)} | Updated: {formatDate(selectedItem.updatedAt)}
                                </div>
                            </div>
                        )}
                    </section>
                </div>
            </div>
        </div>
    );
}

function Field({
    label,
    value,
    onChange,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <label className="block text-xs">
            <span className="text-[color:var(--ac-text-muted)]">{label}</span>
            <input
                value={value}
                onChange={(event) => onChange(event.target.value)}
                className="ac-input mt-1 px-3 py-2 text-sm"
            />
        </label>
    );
}

function SelectField({
    label,
    value,
    onChange,
    options,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: string[];
}) {
    return (
        <label className="block text-xs">
            <span className="text-[color:var(--ac-text-muted)]">{label}</span>
            <select
                value={value}
                onChange={(event) => onChange(event.target.value)}
                className="ac-input mt-1 px-3 py-2 text-sm"
            >
                {options.map((option) => (
                    <option key={option} value={option}>
                        {option}
                    </option>
                ))}
            </select>
        </label>
    );
}

function TextAreaField({
    label,
    value,
    onChange,
    placeholder,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
}) {
    return (
        <label className="block text-xs">
            <span className="text-[color:var(--ac-text-muted)]">{label}</span>
            <textarea
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
                rows={3}
                className="ac-input mt-1 px-3 py-2 text-sm resize-y"
            />
        </label>
    );
}

function GateRow({
    label,
    checked,
    onChange,
}: {
    label: string;
    checked: boolean;
    onChange: (value: boolean) => void;
}) {
    return (
        <label className="flex items-center gap-2 text-sm text-[color:var(--ac-text-dim)]">
            <input
                type="checkbox"
                checked={checked}
                onChange={(event) => onChange(event.target.checked)}
                className="rounded border-gray-300 dark:border-gray-600"
            />
            <span>{label}</span>
        </label>
    );
}
