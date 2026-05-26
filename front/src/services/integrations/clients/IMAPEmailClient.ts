/**
 * IMAP Email Client
 * Uses React Native module to access IMAP/SMTP protocols
 */

import { NativeModules, Platform } from 'react-native';
import { integrationStorage } from '../IntegrationStorage';
import { eventsApi, ragApi } from '../../../apiClient';

const { IOSMailManager } = NativeModules;

export interface IMAPCredentials {
    imapHost: string;
    imapPort: number;
    imapUseTLS: boolean;
    smtpHost: string;
    smtpPort: number;
    smtpUseTLS: boolean;
    username: string;
    password: string;
    displayName?: string;
}

export interface Email {
    uid: number;
    subject: string;
    from: string;
    to: string[];
    date: string;
    flags: string[];
    snippet?: string;
    mailbox: string;
    body?: string;
}

export interface Mailbox {
    name: string;
}

export interface IMAPSyncState {
    integrationId: string;
    mailbox: string;
    lastUid: number;
    syncedAt: number;
}

class IMAPEmailClient {
    /**
     * Get credentials for an integration
     */
    private async getCredentials(
        integrationId: string,
    ): Promise<IMAPCredentials> {
        const credentials = await integrationStorage.getCredentials(
            integrationId,
        );
        if (!credentials) {
            throw new Error('Credentials not found for integration');
        }

        const imapConfig = JSON.parse(
            credentials.accessToken,
        ) as IMAPCredentials;
        return imapConfig;
    }

    /**
     * Test IMAP connection
     */
    async testConnection(
        config: IMAPCredentials,
    ): Promise<{ success: boolean; message: string }> {
        if (!IOSMailManager) {
            throw new Error(
                'IOSMailManager is not available. Make sure iOS native module is properly linked.',
            );
        }

        try {
            const result = await IOSMailManager.testConnection(config);
            return result as { success: boolean; message: string };
        } catch (error) {
            console.error('[IMAPEmailClient] testConnection error:', error);
            throw error;
        }
    }

    /**
     * Get list of mailboxes
     */
    async listMailboxes(integrationId: string): Promise<Mailbox[]> {
        if (!IOSMailManager) {
            throw new Error('IOSMailManager is not available.');
        }

        const config = await this.getCredentials(integrationId);
        const mailboxes = await IOSMailManager.listMailboxes(config);
        return mailboxes as Mailbox[];
    }

    /**
     * Fetch emails from server
     */
    async fetchEmails(
        integrationId: string,
        mailbox: string,
        limit: number = 50,
        sinceUid: number = 0,
    ): Promise<Email[]> {
        if (!IOSMailManager) {
            throw new Error('IOSMailManager is not available.');
        }

        const config = await this.getCredentials(integrationId);
        const emails = await IOSMailManager.fetchEmails(
            config,
            mailbox,
            limit,
            sinceUid,
        );
        return emails as Email[];
    }

    /**
     * Fetch full email body
     */
    async fetchEmailBody(
        integrationId: string,
        uid: number,
        mailbox: string,
    ): Promise<string> {
        if (!IOSMailManager) {
            throw new Error('IOSMailManager is not available.');
        }

        const config = await this.getCredentials(integrationId);
        const result = await IOSMailManager.fetchEmailBody(
            config,
            mailbox,
            uid,
        );
        return (result as { body: string }).body;
    }

    /**
     * Send email via SMTP
     */
    async sendEmail(
        integrationId: string,
        to: string,
        subject: string,
        body: string,
        options: {
            from?: string;
            cc?: string[];
            bcc?: string[];
        } = {},
    ): Promise<{ success: boolean; message: string }> {
        if (!IOSMailManager) {
            throw new Error('IOSMailManager is not available.');
        }

        const config = await this.getCredentials(integrationId);
        const message = {
            to,
            from: options.from || config.username,
            subject,
            body,
        };

        const result = await IOSMailManager.sendEmail(config, message);
        return result as { success: boolean; message: string };
    }

    /**
     * Reply to an email
     */
    async replyToEmail(
        integrationId: string,
        uid: number,
        mailbox: string,
        body: string,
    ): Promise<{ success: boolean; message: string }> {
        const fullBody = await this.fetchEmailBody(integrationId, uid, mailbox);
        const from = this.parseFromHeader(fullBody);

        const subject = await this.getEmailSubject(integrationId, uid, mailbox);
        const replySubject = subject.startsWith('Re:')
            ? subject
            : `Re: ${subject}`;

        return await this.sendEmail(integrationId, from, replySubject, body);
    }

    /**
     * Move email to another mailbox
     */
    async moveEmail(
        integrationId: string,
        mailbox: string,
        uid: number,
        destinationMailbox: string,
    ): Promise<{ success: boolean; uid: number; destinationMailbox: string }> {
        if (!IOSMailManager) {
            throw new Error('IOSMailManager is not available.');
        }

        const config = await this.getCredentials(integrationId);
        const result = await IOSMailManager.moveEmail(
            config,
            mailbox,
            uid,
            destinationMailbox,
        );
        return result as {
            success: boolean;
            uid: number;
            destinationMailbox: string;
        };
    }

    /**
     * Delete email
     */
    async deleteEmail(
        integrationId: string,
        mailbox: string,
        uid: number,
    ): Promise<{ success: boolean; uid: number }> {
        if (!IOSMailManager) {
            throw new Error('IOSMailManager is not available.');
        }

        const config = await this.getCredentials(integrationId);
        const result = await IOSMailManager.deleteEmail(config, mailbox, uid);
        return result as { success: boolean; uid: number };
    }

    /**
     * Archive email (move to Archive mailbox or delete)
     */
    async archiveEmail(
        integrationId: string,
        mailbox: string,
        uid: number,
    ): Promise<any> {
        const mailboxes = await this.listMailboxes(integrationId);
        const archiveMailbox = mailboxes.find(m =>
            m.name.toLowerCase().includes('archive'),
        );

        if (archiveMailbox) {
            return await this.moveEmail(
                integrationId,
                mailbox,
                uid,
                archiveMailbox.name,
            );
        } else {
            return await this.deleteEmail(integrationId, mailbox, uid);
        }
    }

    /**
     * Set email flags (e.g., mark as read, flagged)
     */
    async setFlag(
        integrationId: string,
        mailbox: string,
        uid: number,
        flag: string,
        remove: boolean = false,
    ): Promise<{ success: boolean; uid: number; flags: string }> {
        if (!IOSMailManager) {
            throw new Error('IOSMailManager is not available.');
        }

        const config = await this.getCredentials(integrationId);
        const result = await IOSMailManager.setFlags(
            config,
            mailbox,
            uid,
            flag,
            remove,
        );
        return result as { success: boolean; uid: number; flags: string };
    }

    /**
     * Search emails on IMAP server
     */
    async searchImapServer(
        integrationId: string,
        criteria: string,
        mailbox: string = 'INBOX',
        limit: number = 50,
    ): Promise<Email[]> {
        if (!IOSMailManager) {
            throw new Error('IOSMailManager is not available.');
        }

        const config = await this.getCredentials(integrationId);
        const emails = await IOSMailManager.searchMailbox(
            config,
            mailbox,
            criteria,
            limit,
        );
        return emails as Email[];
    }

    /**
     * Semantic search using RAG (now performed server-side by the agent)
     * @deprecated Search is handled server-side via Agno Knowledge
     */
    async searchEmailsSemantic(
        _query: string,
        _integrationId: string,
    ): Promise<any[]> {
        return [];
    }

    /**
     * Incremental sync from server
     */
    async syncEmails(
        integrationId: string,
        mailbox: string,
        limit: number = 100,
    ): Promise<Email[]> {
        const syncState = await this.getSyncState(integrationId, mailbox);
        const sinceUid = syncState?.lastUid || 0;
        // sinceUid === 0 means this is the initial backfill — do NOT emit proactive
        // events for those emails. Only emit when we already have a sync baseline.
        const isInitialSync = sinceUid === 0;

        const emails = await this.fetchEmails(
            integrationId,
            mailbox,
            limit,
            sinceUid,
        );

        if (emails.length > 0) {
            const maxUid = Math.max(...emails.map(e => e.uid));
            await this.updateSyncState(integrationId, mailbox, maxUid);

            await this.indexEmailsForRAG(integrationId, emails);

            if (!isInitialSync) {
                await this.emitNewEmailEvents(emails);
            }
        }

        return emails;
    }

    /**
     * Emit proactive events for newly-detected emails (not backfill).
     */
    private async emitNewEmailEvents(emails: Email[]): Promise<void> {
        for (const email of emails) {
            try {
                // Extract bare sender email (lowercased) from "Name <email>" or plain address.
                const bracketMatch = email.from.match(/<([^>]+)>/);
                const senderEmail = (
                    bracketMatch ? bracketMatch[1] : email.from
                )
                    .trim()
                    .toLowerCase();

                const snippet = email.snippet
                    ? email.snippet.slice(0, 200)
                    : email.body
                    ? email.body.slice(0, 200)
                    : '';

                await eventsApi.ingest({
                    source: 'email',
                    event_type: 'email_new',
                    payload: {
                        message_id: String(email.uid),
                        sender: email.from,
                        sender_email: senderEmail,
                        subject: email.subject,
                        snippet,
                        received_at: email.date,
                    },
                });
            } catch (error) {
                console.error(
                    `[IMAPEmailClient] Failed to emit proactive event for uid ${email.uid}:`,
                    error,
                );
                // Non-fatal — continue processing remaining emails.
            }
        }
    }

    /**
     * Index emails into backend RAG store
     */
    private async indexEmailsForRAG(
        integrationId: string,
        emails: Email[],
    ): Promise<void> {
        if (Platform.OS !== 'ios') {
            return;
        }

        try {
            for (const email of emails) {
                const content = `Subject: ${email.subject}. From: ${email.from}. Date: ${email.date}.`;
                await ragApi.index({
                    id: `imap_email_${integrationId}_${email.uid}`,
                    source_type: 'imap_email',
                    content,
                    metadata: {
                        integrationId,
                        uid: String(email.uid),
                        mailbox: email.mailbox,
                    },
                });
            }

            console.log(
                `[IMAPEmailClient] Indexed ${emails.length} emails for RAG`,
            );
        } catch (error) {
            console.error('[IMAPEmailClient] indexEmailsForRAG error:', error);
        }
    }

    /**
     * Get sync state from database
     */
    private async getSyncState(
        integrationId: string,
        mailbox: string,
    ): Promise<IMAPSyncState | null> {
        if (Platform.OS !== 'ios') {
            return null;
        }

        try {
            const db = await import('../database/database').then(m =>
                m.getDatabase(),
            );
            const row = await db.getFirstAsync<{
                integration_id: string;
                mailbox: string;
                last_uid: number;
                synced_at: number;
            }>(
                'SELECT * FROM imap_sync_state WHERE integration_id = ? AND mailbox = ?',
                [integrationId, mailbox],
            );

            if (!row) return null;

            return {
                integrationId: row.integration_id,
                mailbox: row.mailbox,
                lastUid: row.last_uid,
                syncedAt: row.synced_at,
            };
        } catch (error) {
            console.error('[IMAPEmailClient] getSyncState error:', error);
            return null;
        }
    }

    /**
     * Update sync state in database
     */
    private async updateSyncState(
        integrationId: string,
        mailbox: string,
        lastUid: number,
    ): Promise<void> {
        if (Platform.OS !== 'ios') {
            return;
        }

        try {
            const db = await import('../database/database').then(m =>
                m.getDatabase(),
            );
            const now = Date.now();

            await db.runAsync(
                `INSERT OR REPLACE INTO imap_sync_state (integration_id, mailbox, last_uid, synced_at)
                 VALUES (?, ?, ?, ?)`,
                [integrationId, mailbox, lastUid, now],
            );
        } catch (error) {
            console.error('[IMAPEmailClient] updateSyncState error:', error);
        }
    }

    /**
     * Parse FROM header from email body
     */
    private parseFromHeader(body: string): string {
        const fromMatch = body.match(/^From:\s*(.+)$/m);
        if (fromMatch) {
            const emailMatch = fromMatch[1].match(/<([^>]+)>/);
            return emailMatch ? emailMatch[1] : fromMatch[1].trim();
        }
        return '';
    }

    /**
     * Get email subject from cached metadata
     */
    private async getEmailSubject(
        integrationId: string,
        uid: number,
        mailbox: string,
    ): Promise<string> {
        const emails = await this.fetchEmails(
            integrationId,
            mailbox,
            1,
            uid - 1,
        );
        return emails.length > 0 ? emails[0].subject : '';
    }

    /**
     * Auto-detect provider configuration based on email domain
     */
    static autoDetectConfig(
        email: string,
        password: string,
    ): Partial<IMAPCredentials> {
        const domain = email.split('@')[1]?.toLowerCase() || '';

        const configs: Record<string, Partial<IMAPCredentials>> = {
            'gmail.com': {
                imapHost: 'imap.gmail.com',
                imapPort: 993,
                imapUseTLS: true,
                smtpHost: 'smtp.gmail.com',
                smtpPort: 465,
                smtpUseTLS: true,
                username: email,
            },
            'icloud.com': {
                imapHost: 'imap.mail.me.com',
                imapPort: 993,
                imapUseTLS: true,
                smtpHost: 'smtp.mail.me.com',
                smtpPort: 587,
                smtpUseTLS: true,
                username: email,
            },
            'me.com': {
                imapHost: 'imap.mail.me.com',
                imapPort: 993,
                imapUseTLS: true,
                smtpHost: 'smtp.mail.me.com',
                smtpPort: 587,
                smtpUseTLS: true,
                username: email,
            },
            'mac.com': {
                imapHost: 'imap.mail.me.com',
                imapPort: 993,
                imapUseTLS: true,
                smtpHost: 'smtp.mail.me.com',
                smtpPort: 587,
                smtpUseTLS: true,
                username: email,
            },
            'outlook.com': {
                imapHost: 'outlook.office365.com',
                imapPort: 993,
                imapUseTLS: true,
                smtpHost: 'smtp-mail.outlook.com',
                smtpPort: 587,
                smtpUseTLS: true,
                username: email,
            },
            'hotmail.com': {
                imapHost: 'outlook.office365.com',
                imapPort: 993,
                imapUseTLS: true,
                smtpHost: 'smtp-mail.outlook.com',
                smtpPort: 587,
                smtpUseTLS: true,
                username: email,
            },
            'live.com': {
                imapHost: 'outlook.office365.com',
                imapPort: 993,
                imapUseTLS: true,
                smtpHost: 'smtp-mail.outlook.com',
                smtpPort: 587,
                smtpUseTLS: true,
                username: email,
            },
            'yahoo.com': {
                imapHost: 'imap.mail.yahoo.com',
                imapPort: 993,
                imapUseTLS: true,
                smtpHost: 'smtp.mail.yahoo.com',
                smtpPort: 465,
                smtpUseTLS: true,
                username: email,
            },
        };

        const config = configs[domain] || {
            imapHost: `imap.${domain}`,
            imapPort: 993,
            imapUseTLS: true,
            smtpHost: `smtp.${domain}`,
            smtpPort: 465,
            smtpUseTLS: true,
            username: email,
        };

        return { ...config, password };
    }

    /**
     * Background task handler for email sync
     */
    async onWake(integrationId: string): Promise<void> {
        try {
            await this.syncEmails(integrationId, 'INBOX', 50);
            console.log(
                `[IMAPEmailClient] Synced emails for integration ${integrationId}`,
            );
        } catch (error) {
            console.error('[IMAPEmailClient] onWake error:', error);
        }
    }
}

export const imapEmailClient = new IMAPEmailClient();
export { IMAPEmailClient };
