/**
 * Integration Storage Service
 * Handles CRUD operations for integrations, credentials, emails, and generated content
 */

import { getDatabase } from '../database/database';
import { encrypt, decrypt } from '../security/encryptionService';

// Simple UUID generator that works without native modules
function generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

// Types
export interface Integration {
    id: string;
    provider: 'gmail' | 'calendar' | 'github' | 'jules';
    name: string;
    enabled: boolean;
    accountEmail?: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface IntegrationCredentials {
    accessToken: string;
    refreshToken?: string;
    tokenExpiry?: Date;
}

export interface Email {
    id: string;
    integrationId: string;
    gmailId: string;
    threadId?: string;
    subject?: string;
    snippet?: string;
    fromEmail?: string;
    fromName?: string;
    toEmails?: string[];
    date?: Date;
    labels?: string[];
    bodyText?: string;
    bodyHtml?: string;
    isRead: boolean;
    fetchedAt: Date;
}

export interface GeneratedContent {
    id: string;
    integrationId: string;
    sourceType: string;
    sourceId: string;
    content: string;
    createdAt: Date;
}

export interface ExtractedEvent {
    id: string;
    sourceId: string;
    title: string;
    startDate: Date;
    endDate?: Date;
    location?: string;
    status: string;
    createdAt: Date;
}

export interface ExtractedTask {
    id: string;
    sourceId: string;
    title: string;
    dueDate?: Date;
    priority: string;
    isCompleted: boolean;
    createdAt: Date;
}

class IntegrationStorage {
    // ==================== Integration CRUD ====================

    async createIntegration(
        integration: Omit<Integration, 'id' | 'createdAt' | 'updatedAt'>,
        credentials: IntegrationCredentials
    ): Promise<Integration> {
        const db = getDatabase();
        const id = generateUUID();
        const now = Date.now();

        // Insert integration
        await db.runAsync(
            `INSERT INTO integrations (id, provider, name, enabled, account_email, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, integration.provider, integration.name, integration.enabled ? 1 : 0, integration.accountEmail ?? null, now, now]
        );

        // Insert encrypted credentials
        const encryptedAccess = await encrypt(credentials.accessToken);
        const encryptedRefresh = credentials.refreshToken ? await encrypt(credentials.refreshToken) : null;
        const expiry = credentials.tokenExpiry ? credentials.tokenExpiry.getTime() : null;

        await db.runAsync(
            `INSERT INTO integration_credentials (integration_id, access_token, refresh_token, token_expiry)
             VALUES (?, ?, ?, ?)`,
            [id, encryptedAccess, encryptedRefresh, expiry]
        );

        return {
            id,
            provider: integration.provider,
            name: integration.name,
            enabled: integration.enabled,
            accountEmail: integration.accountEmail,
            createdAt: new Date(now),
            updatedAt: new Date(now),
        };
    }

    async getIntegrations(): Promise<Integration[]> {
        const db = getDatabase();
        const rows = await db.getAllAsync<{
            id: string;
            provider: string;
            name: string;
            enabled: number;
            account_email: string | null;
            created_at: number;
            updated_at: number;
        }>('SELECT * FROM integrations ORDER BY created_at DESC');

        return rows.map(row => ({
            id: row.id,
            provider: row.provider as Integration['provider'],
            name: row.name,
            enabled: row.enabled === 1,
            accountEmail: row.account_email ?? undefined,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
        }));
    }

    async getIntegration(id: string): Promise<Integration | null> {
        const db = getDatabase();
        const row = await db.getFirstAsync<{
            id: string;
            provider: string;
            name: string;
            enabled: number;
            account_email: string | null;
            created_at: number;
            updated_at: number;
        }>('SELECT * FROM integrations WHERE id = ?', [id]);

        if (!row) return null;

        return {
            id: row.id,
            provider: row.provider as Integration['provider'],
            name: row.name,
            enabled: row.enabled === 1,
            accountEmail: row.account_email ?? undefined,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
        };
    }

    async updateIntegration(id: string, updates: Partial<Pick<Integration, 'name' | 'enabled'>>): Promise<void> {
        const db = getDatabase();
        const now = Date.now();

        const fields: string[] = ['updated_at = ?'];
        const values: any[] = [now];

        if (updates.name !== undefined) {
            fields.push('name = ?');
            values.push(updates.name);
        }
        if (updates.enabled !== undefined) {
            fields.push('enabled = ?');
            values.push(updates.enabled ? 1 : 0);
        }

        values.push(id);
        await db.runAsync(`UPDATE integrations SET ${fields.join(', ')} WHERE id = ?`, values);
    }

    async deleteIntegration(id: string): Promise<void> {
        const db = getDatabase();
        // Cascading delete will handle credentials, emails, and content
        await db.runAsync('DELETE FROM integrations WHERE id = ?', [id]);
    }

    // ==================== Credentials ====================

    async getCredentials(integrationId: string): Promise<IntegrationCredentials | null> {
        const db = getDatabase();
        const row = await db.getFirstAsync<{
            access_token: string;
            refresh_token: string | null;
            token_expiry: number | null;
        }>('SELECT * FROM integration_credentials WHERE integration_id = ?', [integrationId]);

        if (!row) return null;

        const accessToken = await decrypt(row.access_token);
        const refreshToken = row.refresh_token ? await decrypt(row.refresh_token) : undefined;

        return {
            accessToken,
            refreshToken,
            tokenExpiry: row.token_expiry ? new Date(row.token_expiry) : undefined,
        };
    }

    async updateCredentials(integrationId: string, credentials: Partial<IntegrationCredentials>): Promise<void> {
        const db = getDatabase();

        const fields: string[] = [];
        const values: any[] = [];

        if (credentials.accessToken !== undefined) {
            fields.push('access_token = ?');
            values.push(await encrypt(credentials.accessToken));
        }
        if (credentials.refreshToken !== undefined) {
            fields.push('refresh_token = ?');
            values.push(credentials.refreshToken ? await encrypt(credentials.refreshToken) : null);
        }
        if (credentials.tokenExpiry !== undefined) {
            fields.push('token_expiry = ?');
            values.push(credentials.tokenExpiry ? credentials.tokenExpiry.getTime() : null);
        }

        if (fields.length === 0) return;

        values.push(integrationId);
        await db.runAsync(
            `UPDATE integration_credentials SET ${fields.join(', ')} WHERE integration_id = ?`,
            values
        );
    }

    // ==================== Email Cache ====================

    async cacheEmails(integrationId: string, emails: Omit<Email, 'id' | 'integrationId' | 'fetchedAt'>[]): Promise<void> {
        const db = getDatabase();
        const now = Date.now();

        for (const email of emails) {
            const id = generateUUID();
            await db.runAsync(
                `INSERT OR REPLACE INTO emails 
                 (id, integration_id, gmail_id, thread_id, subject, snippet, from_email, from_name, 
                  to_emails, date, labels, body_text, body_html, is_read, fetched_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    id,
                    integrationId,
                    email.gmailId,
                    email.threadId ?? null,
                    email.subject ?? null,
                    email.snippet ?? null,
                    email.fromEmail ?? null,
                    email.fromName ?? null,
                    email.toEmails ? JSON.stringify(email.toEmails) : null,
                    email.date ? email.date.getTime() : null,
                    email.labels ? JSON.stringify(email.labels) : null,
                    email.bodyText ?? null,
                    email.bodyHtml ?? null,
                    email.isRead ? 1 : 0,
                    now,
                ]
            );
        }
    }

    async getCachedEmails(integrationId: string, limit: number = 50): Promise<Email[]> {
        const db = getDatabase();
        const rows = await db.getAllAsync<{
            id: string;
            integration_id: string;
            gmail_id: string;
            thread_id: string | null;
            subject: string | null;
            snippet: string | null;
            from_email: string | null;
            from_name: string | null;
            to_emails: string | null;
            date: number | null;
            labels: string | null;
            body_text: string | null;
            body_html: string | null;
            is_read: number;
            fetched_at: number;
        }>(
            'SELECT * FROM emails WHERE integration_id = ? ORDER BY date DESC LIMIT ?',
            [integrationId, limit]
        );

        return rows.map(row => ({
            id: row.id,
            integrationId: row.integration_id,
            gmailId: row.gmail_id,
            threadId: row.thread_id ?? undefined,
            subject: row.subject ?? undefined,
            snippet: row.snippet ?? undefined,
            fromEmail: row.from_email ?? undefined,
            fromName: row.from_name ?? undefined,
            toEmails: row.to_emails ? JSON.parse(row.to_emails) : undefined,
            date: row.date ? new Date(row.date) : undefined,
            labels: row.labels ? JSON.parse(row.labels) : undefined,
            bodyText: row.body_text ?? undefined,
            bodyHtml: row.body_html ?? undefined,
            isRead: row.is_read === 1,
            fetchedAt: new Date(row.fetched_at),
        }));
    }

    async getEmail(id: string): Promise<Email | null> {
        const db = getDatabase();
        const row = await db.getFirstAsync<any>('SELECT * FROM emails WHERE id = ?', [id]);
        if (!row) return null;

        return {
            id: row.id,
            integrationId: row.integration_id,
            gmailId: row.gmail_id,
            threadId: row.thread_id ?? undefined,
            subject: row.subject ?? undefined,
            snippet: row.snippet ?? undefined,
            fromEmail: row.from_email ?? undefined,
            fromName: row.from_name ?? undefined,
            toEmails: row.to_emails ? JSON.parse(row.to_emails) : undefined,
            date: row.date ? new Date(row.date) : undefined,
            labels: row.labels ? JSON.parse(row.labels) : undefined,
            bodyText: row.body_text ?? undefined,
            bodyHtml: row.body_html ?? undefined,
            isRead: row.is_read === 1,
            fetchedAt: new Date(row.fetched_at),
        };
    }

    // ==================== Generated Content ====================

    async cacheGeneratedContent(
        integrationId: string,
        sourceType: string,
        sourceId: string,
        content: string
    ): Promise<void> {
        const db = getDatabase();
        const id = generateUUID();
        const now = Date.now();

        await db.runAsync(
            `INSERT OR REPLACE INTO generated_content 
             (id, integration_id, source_type, source_id, content, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [id, integrationId, sourceType, sourceId, content, now]
        );
    }

    async getGeneratedContent(sourceType: string, sourceId: string): Promise<string | null> {
        const db = getDatabase();
        const row = await db.getFirstAsync<{ content: string }>(
            'SELECT content FROM generated_content WHERE source_type = ? AND source_id = ?',
            [sourceType, sourceId]
        );
        return row?.content ?? null;
    }

    async clearEmailCache(integrationId: string): Promise<void> {
        const db = getDatabase();
        await db.runAsync('DELETE FROM emails WHERE integration_id = ?', [integrationId]);
    }

    // ==================== Analysis & Extraction ====================

    async getUnanalyzedEmails(limit: number = 10): Promise<Email[]> {
        const db = getDatabase();
        const rows = await db.getAllAsync<any>(
            'SELECT * FROM emails WHERE analyzed_at IS NULL ORDER BY date DESC LIMIT ?',
            [limit]
        );

        return rows.map(row => ({
            id: row.id,
            integrationId: row.integration_id,
            gmailId: row.gmail_id,
            threadId: row.thread_id ?? undefined,
            subject: row.subject ?? undefined,
            snippet: row.snippet ?? undefined,
            fromEmail: row.from_email ?? undefined,
            fromName: row.from_name ?? undefined,
            toEmails: row.to_emails ? JSON.parse(row.to_emails) : undefined,
            date: row.date ? new Date(row.date) : undefined,
            labels: row.labels ? JSON.parse(row.labels) : undefined,
            bodyText: row.body_text ?? undefined,
            bodyHtml: row.body_html ?? undefined,
            isRead: row.is_read === 1,
            fetchedAt: new Date(row.fetched_at),
        }));
    }

    async saveExtractedData(
        sourceId: string,
        events: Partial<ExtractedEvent>[],
        tasks: Partial<ExtractedTask>[]
    ): Promise<void> {
        const db = getDatabase();
        const now = Date.now();

        for (const event of events) {
            const id = generateUUID();
            await db.runAsync(
                `INSERT INTO events (id, source_id, title, start_date, end_date, location, status, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    id,
                    sourceId,
                    event.title!,
                    new Date(event.startDate!).getTime(),
                    event.endDate ? new Date(event.endDate).getTime() : null,
                    event.location ?? null,
                    event.status ?? 'confirmed',
                    now
                ]
            );
        }

        for (const task of tasks) {
            const id = generateUUID();
            await db.runAsync(
                `INSERT INTO tasks (id, source_id, title, due_date, priority, is_completed, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    id,
                    sourceId,
                    task.title!,
                    task.dueDate ? new Date(task.dueDate).getTime() : null,
                    task.priority ?? 'normal',
                    0,
                    now
                ]
            );
        }
    }

    async markAnalyzed(emailId: string): Promise<void> {
        const db = getDatabase();
        await db.runAsync('UPDATE emails SET analyzed_at = ? WHERE id = ?', [Date.now(), emailId]);
    }
}

// Singleton instance
export const integrationStorage = new IntegrationStorage();
