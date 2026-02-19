export interface AuditEvent {
    id: string;
    timestamp: number;
    type: 'PII_OVERRIDE' | 'WORKFLOW_CREATED' | 'SECURITY_SCAN';
    userId: string; // "local-user" for now
    details: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
}

const STORAGE_KEY = 'agent-conductor-audit-log';

export function logAuditEvent(type: AuditEvent['type'], details: string, severity: AuditEvent['severity']) {
    const event: AuditEvent = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        type,
        userId: 'local-user',
        details,
        severity
    };

    if (typeof window !== 'undefined') {
        const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        localStorage.setItem(STORAGE_KEY, JSON.stringify([event, ...existing].slice(0, 100))); // Keep last 100
        console.warn(`[AUDIT] ${type}: ${details}`);
    }
}

export function getAuditLogs(): AuditEvent[] {
    if (typeof window !== 'undefined') {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    }
    return [];
}
