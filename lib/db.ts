// Database layer for persistent storage
// Uses SQLite for Electron, localStorage fallback for browser

import { Session, SessionWithMessages } from './types';
import { Workflow } from './workflows';
// UIMessage type imported via SessionWithMessages from types

// Type for stored session data
interface StoredSession {
    id: string;
    modelId: string;
    title: string;
    systemPrompt: string | null;
    isPersona: boolean;
    messages: string; // JSON serialized
    createdAt: string;
    updatedAt: string;
}

interface StoredWorkflow {
    id: string;
    name: string;
    description: string;
    steps: string; // JSON serialized
    createdAt: string;
}

// Check if we're in Electron environment
const isElectron = typeof window !== 'undefined' &&
    (window as any).electronAPI?.isElectron === true;

// Database interface
interface DatabaseInterface {
    // Sessions
    getSessions(): SessionWithMessages[];
    getSession(id: string): SessionWithMessages | null;
    saveSession(session: SessionWithMessages): void;
    deleteSession(id: string): void;
    clearSessions(): void;

    // Workflows
    getWorkflows(): Workflow[];
    saveWorkflow(workflow: Workflow): void;
    deleteWorkflow(id: string): void;

    // Context
    getSharedContext(): string;
    saveSharedContext(context: string): void;

    // Audit log
    getAuditLogs(limit?: number): any[];
    saveAuditLog(entry: any): void;
}

// LocalStorage implementation (browser fallback)
class LocalStorageDB implements DatabaseInterface {
    private prefix = 'agent-conductor-';

    getSessions(): SessionWithMessages[] {
        const data = localStorage.getItem(`${this.prefix}sessions`);
        if (!data) return [];
        try {
            return JSON.parse(data);
        } catch {
            return [];
        }
    }

    getSession(id: string): SessionWithMessages | null {
        const sessions = this.getSessions();
        return sessions.find(s => s.id === id) || null;
    }

    saveSession(session: SessionWithMessages): void {
        const sessions = this.getSessions();
        const index = sessions.findIndex(s => s.id === session.id);
        if (index >= 0) {
            sessions[index] = session;
        } else {
            sessions.push(session);
        }
        localStorage.setItem(`${this.prefix}sessions`, JSON.stringify(sessions));
    }

    deleteSession(id: string): void {
        const sessions = this.getSessions().filter(s => s.id !== id);
        localStorage.setItem(`${this.prefix}sessions`, JSON.stringify(sessions));
    }

    clearSessions(): void {
        localStorage.setItem(`${this.prefix}sessions`, JSON.stringify([]));
    }

    getWorkflows(): Workflow[] {
        const data = localStorage.getItem(`${this.prefix}workflows`);
        if (!data) return [];
        try {
            return JSON.parse(data);
        } catch {
            return [];
        }
    }

    saveWorkflow(workflow: Workflow): void {
        const workflows = this.getWorkflows();
        const index = workflows.findIndex(w => w.id === workflow.id);
        if (index >= 0) {
            workflows[index] = workflow;
        } else {
            workflows.push(workflow);
        }
        localStorage.setItem(`${this.prefix}workflows`, JSON.stringify(workflows));
    }

    deleteWorkflow(id: string): void {
        const workflows = this.getWorkflows().filter(w => w.id !== id);
        localStorage.setItem(`${this.prefix}workflows`, JSON.stringify(workflows));
    }

    getSharedContext(): string {
        return localStorage.getItem(`${this.prefix}context`) || '';
    }

    saveSharedContext(context: string): void {
        localStorage.setItem(`${this.prefix}context`, context);
    }

    getAuditLogs(limit = 100): any[] {
        const data = localStorage.getItem(`${this.prefix}audit-log`);
        if (!data) return [];
        try {
            const logs = JSON.parse(data);
            return logs.slice(-limit);
        } catch {
            return [];
        }
    }

    saveAuditLog(entry: any): void {
        const logs = this.getAuditLogs(99); // Keep last 99 + new one
        logs.push(entry);
        localStorage.setItem(`${this.prefix}audit-log`, JSON.stringify(logs));
    }
}

// SQLite implementation (Electron)
class SQLiteDB implements DatabaseInterface {
    private db: any;

    constructor() {
        // Dynamic import for Electron environment
        try {
            const Database = require('better-sqlite3');
            const path = require('path');
            const { app } = require('electron');

            const dbPath = path.join(app.getPath('userData'), 'agent-conductor.db');
            this.db = new Database(dbPath);
            this.initSchema();
        } catch (e) {
            console.error('SQLite initialization failed, falling back to localStorage');
            throw e;
        }
    }

    private initSchema(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                modelId TEXT NOT NULL,
                title TEXT NOT NULL,
                systemPrompt TEXT,
                isPersona INTEGER DEFAULT 0,
                messages TEXT DEFAULT '[]',
                createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
                updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS workflows (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                steps TEXT NOT NULL,
                createdAt TEXT DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS context (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                content TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL,
                details TEXT,
                severity TEXT DEFAULT 'low',
                timestamp TEXT DEFAULT CURRENT_TIMESTAMP
            );

            INSERT OR IGNORE INTO context (id, content) VALUES (1, '');
        `);
    }

    getSessions(): SessionWithMessages[] {
        const rows = this.db.prepare('SELECT * FROM sessions ORDER BY createdAt DESC').all();
        return rows.map((row: StoredSession) => ({
            id: row.id,
            modelId: row.modelId,
            title: row.title,
            systemPrompt: row.systemPrompt || undefined,
            isPersona: Boolean(row.isPersona),
            messages: JSON.parse(row.messages)
        }));
    }

    getSession(id: string): SessionWithMessages | null {
        const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as StoredSession | undefined;
        if (!row) return null;
        return {
            id: row.id,
            modelId: row.modelId,
            title: row.title,
            systemPrompt: row.systemPrompt || undefined,
            isPersona: Boolean(row.isPersona),
            messages: JSON.parse(row.messages)
        };
    }

    saveSession(session: SessionWithMessages): void {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO sessions (id, modelId, title, systemPrompt, isPersona, messages, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        stmt.run(
            session.id,
            session.modelId,
            session.title,
            session.systemPrompt || null,
            session.isPersona ? 1 : 0,
            JSON.stringify(session.messages)
        );
    }

    deleteSession(id: string): void {
        this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    }

    clearSessions(): void {
        this.db.prepare('DELETE FROM sessions').run();
    }

    getWorkflows(): Workflow[] {
        const rows = this.db.prepare('SELECT * FROM workflows ORDER BY createdAt DESC').all();
        return rows.map((row: StoredWorkflow) => ({
            id: row.id,
            name: row.name,
            description: row.description,
            steps: JSON.parse(row.steps)
        }));
    }

    saveWorkflow(workflow: Workflow): void {
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO workflows (id, name, description, steps)
            VALUES (?, ?, ?, ?)
        `);
        stmt.run(
            workflow.id,
            workflow.name,
            workflow.description,
            JSON.stringify(workflow.steps)
        );
    }

    deleteWorkflow(id: string): void {
        this.db.prepare('DELETE FROM workflows WHERE id = ?').run(id);
    }

    getSharedContext(): string {
        const row = this.db.prepare('SELECT content FROM context WHERE id = 1').get() as { content: string } | undefined;
        return row?.content || '';
    }

    saveSharedContext(context: string): void {
        this.db.prepare('UPDATE context SET content = ? WHERE id = 1').run(context);
    }

    getAuditLogs(limit = 100): any[] {
        return this.db.prepare('SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?').all(limit);
    }

    saveAuditLog(entry: any): void {
        const stmt = this.db.prepare(`
            INSERT INTO audit_log (type, details, severity)
            VALUES (?, ?, ?)
        `);
        stmt.run(entry.type, entry.details, entry.severity || 'low');
    }
}

// Create and export the database instance
let db: DatabaseInterface;

export function getDatabase(): DatabaseInterface {
    if (!db) {
        // Try SQLite first (Electron), fall back to localStorage
        if (isElectron) {
            try {
                db = new SQLiteDB();
            } catch (e) {
                console.warn('SQLite not available, using localStorage');
                db = new LocalStorageDB();
            }
        } else {
            db = new LocalStorageDB();
        }
    }
    return db;
}

// Convenience exports
export const database = {
    get sessions() {
        return {
            getAll: () => getDatabase().getSessions(),
            get: (id: string) => getDatabase().getSession(id),
            save: (session: SessionWithMessages) => getDatabase().saveSession(session),
            delete: (id: string) => getDatabase().deleteSession(id),
            clear: () => getDatabase().clearSessions()
        };
    },

    get workflows() {
        return {
            getAll: () => getDatabase().getWorkflows(),
            save: (workflow: Workflow) => getDatabase().saveWorkflow(workflow),
            delete: (id: string) => getDatabase().deleteWorkflow(id)
        };
    },

    get context() {
        return {
            get: () => getDatabase().getSharedContext(),
            save: (context: string) => getDatabase().saveSharedContext(context)
        };
    },

    get audit() {
        return {
            getAll: (limit?: number) => getDatabase().getAuditLogs(limit),
            log: (entry: any) => getDatabase().saveAuditLog(entry)
        };
    }
};
