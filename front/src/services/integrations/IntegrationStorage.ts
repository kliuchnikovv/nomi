/**
 * Integration Storage Service
 * Handles CRUD operations for integrations, credentials, emails, and generated content
 */

import { getDatabase } from '../database/database';
import { encrypt, decrypt } from '../security/encryptionService';

// Simple UUID generator that works without native modules
function generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

// Types
export type StorageType = 'client' | 'server' | 'hybrid';

export interface Integration {
    id: string;
    provider: string;
    name: string;
    enabled: boolean;
    accountEmail?: string;
    storageType?: StorageType; // Data storage type
    supportsBackgroundTasks?: boolean; // Whether background processes are supported
    systemEventListeners?: string[]; // List of system events
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
    externalId?: string;
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

// V3: Briefing System Types
export interface AnalyzedEmail {
    id: string;
    emailId: string;
    urgency: 'asap' | 'high' | 'normal' | 'low';
    connections: string[];
    timeFrame?: string;
    targetDate?: string; // YYYY-MM-DD
    isCompleted: boolean;
    completedAt?: Date;
    analyzedAt: Date;
}

export interface Briefing {
    id: string;
    date: string; // YYYY-MM-DD
    headline?: string;
    summary?: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface BriefingItem {
    id: string;
    briefingId: string;
    sourceType: 'email' | 'event' | 'task';
    sourceId: string;
    title: string;
    description?: string;
    priority: 'asap' | 'high' | 'normal' | 'low';
    isCompleted: boolean;
    completedAt?: Date;
    displayOrder: number;
    suggestedActions?: SuggestedAction[];
}

export interface SuggestedAction {
    id: string;
    briefingItemId: string;
    actionType:
        | 'reply'
        | 'forward'
        | 'schedule'
        | 'delegate'
        | 'archive'
        | 'followup';
    label: string;
    params?: Record<string, any>;
    displayOrder: number;
}

class IntegrationStorage {
    private currentUserId: string | null = null;

    setCurrentUserId(userId: string | null): void {
        this.currentUserId = userId;
    }

    private requireUserId(): string {
        if (!this.currentUserId) {
            throw new Error('IntegrationStorage: no current user set');
        }
        return this.currentUserId;
    }

    // ==================== Integration CRUD ====================

    async createIntegration(
        integration: Omit<Integration, 'id' | 'createdAt' | 'updatedAt'>,
        credentials: IntegrationCredentials,
    ): Promise<Integration> {
        const userId = this.requireUserId();
        const db = getDatabase();
        const id = generateUUID();
        const now = Date.now();

        // Check if user_id column exists (for backwards compatibility)
        let hasUserIdColumn = false;
        try {
            const columns = await db.getAllAsync<{ name: string }>(
                `PRAGMA table_info(integrations)`,
            );
            hasUserIdColumn = columns.some(col => col.name === 'user_id');
        } catch (e) {
            // If PRAGMA fails, assume column doesn't exist
            console.warn('[IntegrationStorage] Failed to check columns:', e);
        }

        // Insert integration with or without user_id based on schema version
        if (hasUserIdColumn) {
            await db.runAsync(
                `INSERT INTO integrations (id, provider, name, enabled, account_email, user_id, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    id,
                    integration.provider,
                    integration.name,
                    integration.enabled ? 1 : 0,
                    integration.accountEmail ?? null,
                    userId,
                    now,
                    now,
                ],
            );
        } else {
            await db.runAsync(
                `INSERT INTO integrations (id, provider, name, enabled, account_email, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    id,
                    integration.provider,
                    integration.name,
                    integration.enabled ? 1 : 0,
                    integration.accountEmail ?? null,
                    now,
                    now,
                ],
            );
        }

        // Insert encrypted credentials
        const encryptedAccess = await encrypt(credentials.accessToken);
        const encryptedRefresh = credentials.refreshToken
            ? await encrypt(credentials.refreshToken)
            : null;
        const expiry = credentials.tokenExpiry
            ? credentials.tokenExpiry.getTime()
            : null;

        await db.runAsync(
            `INSERT INTO integration_credentials (integration_id, access_token, refresh_token, token_expiry)
             VALUES (?, ?, ?, ?)`,
            [id, encryptedAccess, encryptedRefresh, expiry],
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
        const userId = this.requireUserId();
        const db = getDatabase();
        const rows = await db.getAllAsync<{
            id: string;
            provider: string;
            name: string;
            enabled: number;
            account_email: string | null;
            created_at: number;
            updated_at: number;
        }>(
            'SELECT * FROM integrations WHERE user_id = ? ORDER BY created_at DESC',
            [userId],
        );

        return rows.map(row => ({
            id: row.id,
            provider: row.provider,
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
            provider: row.provider,
            name: row.name,
            enabled: row.enabled === 1,
            accountEmail: row.account_email ?? undefined,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
        };
    }

    async getIntegrationByEmail(
        provider: string,
        email: string,
    ): Promise<Integration | null> {
        const userId = this.requireUserId();
        const db = getDatabase();
        const row = await db.getFirstAsync<{
            id: string;
            provider: string;
            name: string;
            enabled: number;
            account_email: string | null;
            created_at: number;
            updated_at: number;
        }>(
            'SELECT * FROM integrations WHERE provider = ? AND account_email = ? AND user_id = ?',
            [provider, email, userId],
        );

        if (!row) return null;

        return {
            id: row.id,
            provider: row.provider,
            name: row.name,
            enabled: row.enabled === 1,
            accountEmail: row.account_email ?? undefined,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
        };
    }

    async updateIntegration(
        id: string,
        updates: Partial<Pick<Integration, 'name' | 'enabled'>>,
    ): Promise<void> {
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
        await db.runAsync(
            `UPDATE integrations SET ${fields.join(', ')} WHERE id = ?`,
            values,
        );
    }

    async deleteIntegration(id: string): Promise<void> {
        const db = getDatabase();
        // Clean up events and tasks that reference this integration as source_id
        await db.runAsync('DELETE FROM events WHERE source_id = ?', [id]);
        await db.runAsync('DELETE FROM tasks WHERE source_id = ?', [id]);
        // Cascading delete will handle credentials, emails, and content
        await db.runAsync('DELETE FROM integrations WHERE id = ?', [id]);
    }

    // ==================== Credentials ====================

    async getCredentials(
        integrationId: string,
    ): Promise<IntegrationCredentials | null> {
        const db = getDatabase();
        const row = await db.getFirstAsync<{
            access_token: string;
            refresh_token: string | null;
            token_expiry: number | null;
        }>('SELECT * FROM integration_credentials WHERE integration_id = ?', [
            integrationId,
        ]);

        if (!row) return null;

        const accessToken = await decrypt(row.access_token);
        const refreshToken = row.refresh_token
            ? await decrypt(row.refresh_token)
            : undefined;

        return {
            accessToken,
            refreshToken,
            tokenExpiry: row.token_expiry
                ? new Date(row.token_expiry)
                : undefined,
        };
    }

    async updateCredentials(
        integrationId: string,
        credentials: Partial<IntegrationCredentials>,
    ): Promise<void> {
        const db = getDatabase();

        const fields: string[] = [];
        const values: any[] = [];

        if (credentials.accessToken !== undefined) {
            fields.push('access_token = ?');
            values.push(await encrypt(credentials.accessToken));
        }
        if (credentials.refreshToken !== undefined) {
            fields.push('refresh_token = ?');
            values.push(
                credentials.refreshToken
                    ? await encrypt(credentials.refreshToken)
                    : null,
            );
        }
        if (credentials.tokenExpiry !== undefined) {
            fields.push('token_expiry = ?');
            values.push(
                credentials.tokenExpiry
                    ? credentials.tokenExpiry.getTime()
                    : null,
            );
        }

        if (fields.length === 0) return;

        values.push(integrationId);
        await db.runAsync(
            `UPDATE integration_credentials SET ${fields.join(
                ', ',
            )} WHERE integration_id = ?`,
            values,
        );
    }

    // ==================== Email Cache ====================

    async cacheEmails(
        integrationId: string,
        emails: Omit<Email, 'id' | 'integrationId' | 'fetchedAt'>[],
    ): Promise<void> {
        const db = getDatabase();
        const now = Date.now();

        for (const email of emails) {
            // Check if email already exists
            const existing = await db.getFirstAsync<{ id: string }>(
                'SELECT id FROM emails WHERE integration_id = ? AND gmail_id = ?',
                [integrationId, email.gmailId],
            );

            if (existing) {
                // Update existing email
                await db.runAsync(
                    `UPDATE emails SET
                     thread_id = ?, subject = ?, snippet = ?, from_email = ?, from_name = ?,
                     to_emails = ?, date = ?, labels = ?, body_text = ?, body_html = ?,
                     is_read = ?, fetched_at = ?
                     WHERE id = ?`,
                    [
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
                        existing.id,
                    ],
                );
            } else {
                // Insert new email
                const id = generateUUID();
                await db.runAsync(
                    `INSERT INTO emails
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
                    ],
                );
            }
        }
    }

    async getCachedEmails(
        integrationId: string,
        limit: number = 50,
    ): Promise<Email[]> {
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
            [integrationId, limit],
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
        const row = await db.getFirstAsync<any>(
            'SELECT * FROM emails WHERE id = ?',
            [id],
        );
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
        content: string,
    ): Promise<void> {
        const db = getDatabase();
        const id = generateUUID();
        const now = Date.now();

        await db.runAsync(
            `INSERT OR REPLACE INTO generated_content
             (id, integration_id, source_type, source_id, content, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [id, integrationId, sourceType, sourceId, content, now],
        );
    }

    async getGeneratedContent(
        sourceType: string,
        sourceId: string,
    ): Promise<string | null> {
        const db = getDatabase();
        const row = await db.getFirstAsync<{ content: string }>(
            'SELECT content FROM generated_content WHERE source_type = ? AND source_id = ?',
            [sourceType, sourceId],
        );
        return row?.content ?? null;
    }

    async clearEmailCache(integrationId: string): Promise<void> {
        const db = getDatabase();
        await db.runAsync('DELETE FROM emails WHERE integration_id = ?', [
            integrationId,
        ]);
    }

    // ==================== Analysis & Extraction ====================

    async getUnanalyzedEmails(
        limit: number = 10,
        integrationId?: string,
    ): Promise<Email[]> {
        const db = getDatabase();
        const rows = await db.getAllAsync<any>(
            integrationId
                ? 'SELECT * FROM emails WHERE analyzed_at IS NULL AND integration_id = ? ORDER BY date DESC LIMIT ?'
                : 'SELECT * FROM emails WHERE analyzed_at IS NULL ORDER BY date DESC LIMIT ?',
            integrationId ? [integrationId, limit] : [limit],
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
        tasks: Partial<ExtractedTask>[],
    ): Promise<void> {
        const db = getDatabase();
        const now = Date.now();

        for (const event of events) {
            let existingId: string | null = null;

            // Check if already exists by external_id
            if (event.externalId) {
                const existing = await db.getFirstAsync<{ id: string }>(
                    'SELECT id FROM events WHERE source_id = ? AND external_id = ?',
                    [sourceId, event.externalId],
                );
                existingId = existing?.id ?? null;
            }

            if (existingId) {
                // Update existing event
                await db.runAsync(
                    `UPDATE events SET
                     title = ?, start_date = ?, end_date = ?, location = ?, status = ?
                     WHERE id = ?`,
                    [
                        event.title!,
                        new Date(event.startDate!).getTime(),
                        event.endDate
                            ? new Date(event.endDate).getTime()
                            : null,
                        event.location ?? null,
                        event.status ?? 'confirmed',
                        existingId,
                    ],
                );
            } else {
                // Insert new event
                const id = generateUUID();
                await db.runAsync(
                    `INSERT INTO events (id, source_id, title, start_date, end_date, location, status, external_id, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        id,
                        sourceId,
                        event.title!,
                        new Date(event.startDate!).getTime(),
                        event.endDate
                            ? new Date(event.endDate).getTime()
                            : null,
                        event.location ?? null,
                        event.status ?? 'confirmed',
                        event.externalId ?? null,
                        now,
                    ],
                );
            }
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
                    now,
                ],
            );
        }
    }

    async markAnalyzed(emailId: string): Promise<void> {
        const db = getDatabase();
        await db.runAsync('UPDATE emails SET analyzed_at = ? WHERE id = ?', [
            Date.now(),
            emailId,
        ]);
    }

    async getEventsForDate(
        date: Date,
        integrationId?: string,
    ): Promise<ExtractedEvent[]> {
        const db = getDatabase();
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);

        const whereClause = integrationId ? 'AND source_id = ?' : '';
        const params = integrationId
            ? [startOfDay.getTime(), endOfDay.getTime(), integrationId]
            : [startOfDay.getTime(), endOfDay.getTime()];

        const rows = await db.getAllAsync<any>(
            `SELECT * FROM events WHERE start_date >= ? AND start_date <= ? ${whereClause} ORDER BY start_date ASC`,
            params,
        );

        return rows.map(row => ({
            id: row.id,
            sourceId: row.source_id,
            title: row.title,
            startDate: new Date(row.start_date),
            endDate: row.end_date ? new Date(row.end_date) : undefined,
            location: row.location ?? undefined,
            status: row.status,
            externalId: row.external_id ?? undefined,
            createdAt: new Date(row.created_at),
        }));
    }

    async getEventsRange(
        startDate: Date,
        endDate: Date,
        integrationId?: string,
    ): Promise<ExtractedEvent[]> {
        const db = getDatabase();

        const whereClause = integrationId ? 'AND source_id = ?' : '';
        const params = integrationId
            ? [startDate.getTime(), endDate.getTime(), integrationId]
            : [startDate.getTime(), endDate.getTime()];

        const rows = await db.getAllAsync<any>(
            `SELECT * FROM events WHERE start_date >= ? AND start_date <= ? ${whereClause} ORDER BY start_date ASC`,
            params,
        );

        return rows.map(row => ({
            id: row.id,
            sourceId: row.source_id,
            title: row.title,
            startDate: new Date(row.start_date),
            endDate: row.end_date ? new Date(row.end_date) : undefined,
            location: row.location ?? undefined,
            status: row.status,
            externalId: row.external_id ?? undefined,
            createdAt: new Date(row.created_at),
        }));
    }

    async getPendingTasks(): Promise<ExtractedTask[]> {
        const db = getDatabase();
        const rows = await db.getAllAsync<any>(
            `SELECT * FROM tasks WHERE is_completed = 0 ORDER BY priority DESC, due_date ASC`,
        );
        return rows.map(row => ({
            id: row.id,
            sourceId: row.source_id,
            title: row.title,
            dueDate: row.due_date ? new Date(row.due_date) : undefined,
            priority: row.priority,
            isCompleted: row.is_completed === 1,
            createdAt: new Date(row.created_at),
        }));
    }

    // ==================== V3: Email Analysis ====================

    /**
     * Helper to ensure database schema columns exist
     */
    private async _ensureColumnsExist(db: any): Promise<void> {
        try {
            await db.runAsync(
                'ALTER TABLE analyzed_emails ADD COLUMN target_date TEXT',
            );
        } catch (e) {
            /* ignore if exists */
        }
        try {
            await db.runAsync(
                'ALTER TABLE analyzed_emails ADD COLUMN is_completed INTEGER DEFAULT 0',
            );
        } catch (e) {
            /* ignore if exists */
        }
        try {
            await db.runAsync(
                'ALTER TABLE analyzed_emails ADD COLUMN completed_at INTEGER',
            );
        } catch (e) {
            /* ignore if exists */
        }
    }

    async saveEmailAnalysis(
        emailId: string,
        analysis: {
            urgency: string;
            connections: string[];
            timeFrame?: string;
            targetDate?: string;
        },
    ): Promise<AnalyzedEmail> {
        const db = getDatabase();
        await this._ensureColumnsExist(db);

        // Check if analysis already exists for this email
        const existing = await db.getFirstAsync<any>(
            'SELECT * FROM analyzed_emails WHERE email_id = ?',
            [emailId],
        );

        const id = existing?.id || generateUUID();
        const now = Date.now();

        // Preserve existing completion status
        const isCompleted = existing?.is_completed ?? 0;
        const completedAt = existing?.completed_at ?? null;

        await db.runAsync(
            `INSERT OR REPLACE INTO analyzed_emails (id, email_id, urgency, connections, time_frame, target_date, is_completed, completed_at, analyzed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                emailId,
                analysis.urgency,
                JSON.stringify(analysis.connections),
                analysis.timeFrame ?? null,
                analysis.targetDate ?? null,
                isCompleted,
                completedAt,
                now,
            ],
        );

        return {
            id,
            emailId,
            urgency: analysis.urgency as AnalyzedEmail['urgency'],
            connections: analysis.connections,
            timeFrame: analysis.timeFrame,
            targetDate: analysis.targetDate,
            isCompleted: isCompleted === 1,
            completedAt: completedAt ? new Date(completedAt) : undefined,
            analyzedAt: new Date(now),
        };
    }

    async getEmailAnalysis(emailId: string): Promise<AnalyzedEmail | null> {
        const db = getDatabase();
        const row = await db.getFirstAsync<any>(
            'SELECT * FROM analyzed_emails WHERE email_id = ?',
            [emailId],
        );

        if (!row) return null;

        return {
            id: row.id,
            emailId: row.email_id,
            urgency: row.urgency,
            connections: row.connections ? JSON.parse(row.connections) : [],
            timeFrame: row.time_frame ?? undefined,
            targetDate: row.target_date ?? undefined,
            isCompleted: row.is_completed === 1,
            completedAt: row.completed_at
                ? new Date(row.completed_at)
                : undefined,
            analyzedAt: new Date(row.analyzed_at),
        };
    }

    async getAsapEmails(): Promise<AnalyzedEmail[]> {
        const db = getDatabase();
        await this._ensureColumnsExist(db);

        const rows = await db.getAllAsync<any>(
            `SELECT * FROM analyzed_emails
             WHERE urgency IN ('asap', 'high')
             GROUP BY email_id
             ORDER BY
             CASE urgency WHEN 'asap' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
             analyzed_at DESC`,
        );

        return rows.map(row => ({
            id: row.id,
            emailId: row.email_id,
            urgency: row.urgency,
            connections: row.connections ? JSON.parse(row.connections) : [],
            timeFrame: row.time_frame ?? undefined,
            targetDate: row.target_date ?? undefined,
            isCompleted: row.is_completed === 1,
            completedAt: row.completed_at
                ? new Date(row.completed_at)
                : undefined,
            analyzedAt: new Date(row.analyzed_at),
        }));
    }

    // Get emails relevant for a specific date (accumulated + overdue)
    async getBriefingEmails(date: string): Promise<AnalyzedEmail[]> {
        const db = getDatabase();
        await this._ensureColumnsExist(db);

        // Logic:
        // 1. Emails specifically targeting this date
        // 2. Emails from past dates that are NOT completed (overdue)
        // 3. ASAP/High urgency emails without a target date (fallback) created in last 24h

        const rows = await db.getAllAsync<any>(
            `SELECT * FROM analyzed_emails
             WHERE
                (target_date = ?) OR
                (target_date < ? AND is_completed = 0) OR
                (target_date IS NULL AND urgency IN ('asap', 'high') AND analyzed_at > ?)
             GROUP BY email_id
             ORDER BY target_date ASC, urgency DESC`,
            [date, date, Date.now() - 86400000], // Last 24h for fallback
        );

        return rows.map(row => ({
            id: row.id,
            emailId: row.email_id,
            urgency: row.urgency,
            connections: row.connections ? JSON.parse(row.connections) : [],
            timeFrame: row.time_frame ?? undefined,
            targetDate: row.target_date ?? undefined,
            isCompleted: row.is_completed === 1,
            completedAt: row.completed_at
                ? new Date(row.completed_at)
                : undefined,
            analyzedAt: new Date(row.analyzed_at),
        }));
    }

    // ==================== V3: Briefings ====================

    async createBriefing(
        date: string,
        headline?: string,
        summary?: string,
    ): Promise<Briefing> {
        const userId = this.requireUserId();
        const db = getDatabase();
        const id = generateUUID();
        const now = Date.now();

        await db.runAsync(
            `INSERT OR REPLACE INTO briefings (id, date, user_id, headline, summary, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, date, userId, headline ?? null, summary ?? null, now, now],
        );

        return {
            id,
            date,
            headline,
            summary,
            createdAt: new Date(now),
            updatedAt: new Date(now),
        };
    }

    async getBriefingForDate(date: string): Promise<Briefing | null> {
        const userId = this.requireUserId();
        const db = getDatabase();
        const row = await db.getFirstAsync<any>(
            'SELECT * FROM briefings WHERE date = ? AND user_id = ?',
            [date, userId],
        );

        if (!row) return null;

        return {
            id: row.id,
            date: row.date,
            headline: row.headline ?? undefined,
            summary: row.summary ?? undefined,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
        };
    }

    async updateBriefing(
        id: string,
        updates: Partial<Pick<Briefing, 'headline' | 'summary'>>,
    ): Promise<void> {
        const db = getDatabase();
        const now = Date.now();
        const fields: string[] = ['updated_at = ?'];
        const values: any[] = [now];

        if (updates.headline !== undefined) {
            fields.push('headline = ?');
            values.push(updates.headline);
        }
        if (updates.summary !== undefined) {
            fields.push('summary = ?');
            values.push(updates.summary);
        }

        values.push(id);
        await db.runAsync(
            `UPDATE briefings SET ${fields.join(', ')} WHERE id = ?`,
            values,
        );
    }

    // ==================== V3: Briefing Items ====================

    async clearBriefingItems(briefingId: string): Promise<void> {
        const db = getDatabase();
        // First delete suggested actions for all items in this briefing
        await db.runAsync(
            `DELETE FROM suggested_actions WHERE briefing_item_id IN
             (SELECT id FROM briefing_items WHERE briefing_id = ?)`,
            [briefingId],
        );
        // Then delete the items
        await db.runAsync('DELETE FROM briefing_items WHERE briefing_id = ?', [
            briefingId,
        ]);
    }

    async addBriefingItem(
        briefingId: string,
        item: Omit<
            BriefingItem,
            'id' | 'briefingId' | 'completedAt' | 'suggestedActions'
        > & { isCompleted?: boolean },
    ): Promise<BriefingItem> {
        const db = getDatabase();
        const id = generateUUID();
        const isCompleted = item.isCompleted ? 1 : 0;

        await db.runAsync(
            `INSERT INTO briefing_items (id, briefing_id, source_type, source_id, title, description, priority, is_completed, display_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                briefingId,
                item.sourceType,
                item.sourceId,
                item.title,
                item.description ?? null,
                item.priority,
                isCompleted,
                item.displayOrder,
            ],
        );

        return {
            id,
            briefingId,
            ...item,
            isCompleted: false,
        };
    }

    async getBriefingItems(briefingId: string): Promise<BriefingItem[]> {
        const db = getDatabase();
        const rows = await db.getAllAsync<any>(
            'SELECT * FROM briefing_items WHERE briefing_id = ? ORDER BY display_order ASC',
            [briefingId],
        );

        const items: BriefingItem[] = [];
        for (const row of rows) {
            const actions = await this.getSuggestedActions(row.id);
            items.push({
                id: row.id,
                briefingId: row.briefing_id,
                sourceType: row.source_type,
                sourceId: row.source_id,
                title: row.title,
                description: row.description ?? undefined,
                priority: row.priority,
                isCompleted: row.is_completed === 1,
                completedAt: row.completed_at
                    ? new Date(row.completed_at)
                    : undefined,
                displayOrder: row.display_order,
                suggestedActions: actions,
            });
        }

        return items;
    }

    async markBriefingItemComplete(
        itemId: string,
        isCompleted: boolean = true,
    ): Promise<void> {
        const db = getDatabase();
        const completedAt = isCompleted ? Date.now() : null;

        // Update briefing item
        await db.runAsync(
            'UPDATE briefing_items SET is_completed = ?, completed_at = ? WHERE id = ?',
            [isCompleted ? 1 : 0, completedAt, itemId],
        );

        // Also update underlying source status if it's an analyzed email
        try {
            const item = await db.getFirstAsync<any>(
                'SELECT source_type, source_id FROM briefing_items WHERE id = ?',
                [itemId],
            );

            if (item && item.source_type === 'email') {
                await this._ensureColumnsExist(db);
                await db.runAsync(
                    'UPDATE analyzed_emails SET is_completed = ?, completed_at = ? WHERE email_id = ?',
                    [isCompleted ? 1 : 0, completedAt, item.source_id],
                );
                console.log(
                    `[IntegrationStorage] Synced completion status for email ${item.source_id}`,
                );
            }
        } catch (e) {
            console.warn(
                '[IntegrationStorage] Failed to sync email completion status:',
                e,
            );
        }
    }

    async getBriefingProgress(
        briefingId: string,
    ): Promise<{ total: number; completed: number }> {
        const db = getDatabase();
        const total = await db.getFirstAsync<{ count: number }>(
            'SELECT COUNT(*) as count FROM briefing_items WHERE briefing_id = ?',
            [briefingId],
        );
        const completed = await db.getFirstAsync<{ count: number }>(
            'SELECT COUNT(*) as count FROM briefing_items WHERE briefing_id = ? AND is_completed = 1',
            [briefingId],
        );

        return {
            total: total?.count ?? 0,
            completed: completed?.count ?? 0,
        };
    }

    // ==================== V3: Suggested Actions ====================

    async addSuggestedAction(
        briefingItemId: string,
        action: Omit<SuggestedAction, 'id' | 'briefingItemId'>,
    ): Promise<SuggestedAction> {
        const db = getDatabase();
        const id = generateUUID();

        await db.runAsync(
            `INSERT INTO suggested_actions (id, briefing_item_id, action_type, label, params, display_order)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                id,
                briefingItemId,
                action.actionType,
                action.label,
                JSON.stringify(action.params ?? {}),
                action.displayOrder,
            ],
        );

        return {
            id,
            briefingItemId,
            ...action,
        };
    }

    async getSuggestedActions(
        briefingItemId: string,
    ): Promise<SuggestedAction[]> {
        const db = getDatabase();
        const rows = await db.getAllAsync<any>(
            'SELECT * FROM suggested_actions WHERE briefing_item_id = ? ORDER BY display_order ASC',
            [briefingItemId],
        );

        return rows.map(row => ({
            id: row.id,
            briefingItemId: row.briefing_item_id,
            actionType: row.action_type,
            label: row.label,
            params: row.params ? JSON.parse(row.params) : undefined,
            displayOrder: row.display_order,
        }));
    }
}

// Singleton instance
export const integrationStorage = new IntegrationStorage();
