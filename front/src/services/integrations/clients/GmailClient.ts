/**
 * Gmail Client
 * Direct Gmail API client that uses locally stored tokens
 */

import { tokenRefreshService } from '../tokenRefreshService';
import { integrationStorage, Email } from '../IntegrationStorage';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

export interface GmailMessage {
    id: string;
    threadId: string;
    labelIds?: string[];
    snippet?: string;
    payload?: {
        headers?: Array<{ name: string; value: string }>;
        body?: { data?: string };
        parts?: Array<{
            mimeType: string;
            body?: { data?: string };
        }>;
    };
    internalDate?: string;
}

export interface GmailListResponse {
    messages?: Array<{ id: string; threadId: string }>;
    nextPageToken?: string;
    resultSizeEstimate?: number;
}

class GmailClient {
    /**
     * Fetch recent emails from Gmail API and cache them
     */
    async syncEmails(integrationId: string, maxResults: number = 20): Promise<Email[]> {
        const accessToken = await tokenRefreshService.getValidToken(integrationId);

        // Get list of message IDs
        const listResponse = await fetch(
            `${GMAIL_API_BASE}/messages?maxResults=${maxResults}&labelIds=INBOX`,
            {
                headers: { Authorization: `Bearer ${accessToken}` },
            }
        );

        if (!listResponse.ok) {
            const error = await listResponse.json().catch(() => ({}));
            throw new Error(error.error?.message || 'Failed to list Gmail messages');
        }

        const listData: GmailListResponse = await listResponse.json();

        if (!listData.messages || listData.messages.length === 0) {
            return [];
        }

        // Fetch full message details for each
        const emails: Email[] = [];
        for (const msg of listData.messages) {
            try {
                const email = await this.fetchEmail(integrationId, msg.id, accessToken);
                if (email) {
                    emails.push(email);
                }
            } catch (e) {
                console.warn(`[GmailClient] Failed to fetch email ${msg.id}:`, e);
            }
        }

        // Cache the emails
        await integrationStorage.cacheEmails(integrationId, emails.map(e => ({
            gmailId: e.gmailId,
            threadId: e.threadId,
            subject: e.subject,
            snippet: e.snippet,
            fromEmail: e.fromEmail,
            fromName: e.fromName,
            toEmails: e.toEmails,
            date: e.date,
            labels: e.labels,
            bodyText: e.bodyText,
            bodyHtml: e.bodyHtml,
            isRead: e.isRead,
        })));

        console.log(`[GmailClient] Synced ${emails.length} emails`);

        return emails;
    }

    /**
     * Fetch a single email by ID
     */
    async fetchEmail(integrationId: string, gmailId: string, accessToken?: string): Promise<Email | null> {
        if (!accessToken) {
            accessToken = await tokenRefreshService.getValidToken(integrationId);
        }

        const response = await fetch(
            `${GMAIL_API_BASE}/messages/${gmailId}?format=full`,
            {
                headers: { Authorization: `Bearer ${accessToken}` },
            }
        );

        if (!response.ok) {
            if (response.status === 404) {
                return null;
            }
            throw new Error('Failed to fetch email');
        }

        const msg: GmailMessage = await response.json();
        return this.parseGmailMessage(gmailId, msg);
    }

    /**
     * Get cached emails from local storage
     */
    async getCachedEmails(integrationId: string, limit?: number): Promise<Email[]> {
        return integrationStorage.getCachedEmails(integrationId, limit);
    }

    /**
     * Get recent emails, using cache if available, syncing if not
     */
    async getRecentEmails(integrationId: string, maxResults: number = 20): Promise<Email[]> {
        // First try to get from cache
        const cached = await integrationStorage.getCachedEmails(integrationId, maxResults);

        if (cached.length > 0) {
            // Return cached data and sync in background
            this.syncEmails(integrationId, maxResults).catch(e => {
                console.warn('[GmailClient] Background sync failed:', e);
            });
            return cached;
        }

        // No cache, sync now
        return this.syncEmails(integrationId, maxResults);
    }

    /**
     * Parse Gmail API message to our Email format
     */
    private parseGmailMessage(gmailId: string, msg: GmailMessage): Email {
        const headers = msg.payload?.headers || [];

        const getHeader = (name: string): string | undefined => {
            const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
            return header?.value;
        };

        const from = getHeader('From') || '';
        const fromMatch = from.match(/^(?:"?([^"<]*)"?\s*)?<?([^>]*)>?$/);
        const fromName = fromMatch?.[1]?.trim() || undefined;
        const fromEmail = fromMatch?.[2] || from;

        const to = getHeader('To') || '';
        const toEmails = to.split(',').map(e => e.trim()).filter(Boolean);

        const date = getHeader('Date');
        const internalDate = msg.internalDate ? new Date(parseInt(msg.internalDate, 10)) : undefined;

        // Extract body
        let bodyText: string | undefined;
        let bodyHtml: string | undefined;

        if (msg.payload?.body?.data) {
            bodyText = this.decodeBase64(msg.payload.body.data);
        }

        if (msg.payload?.parts) {
            for (const part of msg.payload.parts) {
                if (part.mimeType === 'text/plain' && part.body?.data) {
                    bodyText = this.decodeBase64(part.body.data);
                } else if (part.mimeType === 'text/html' && part.body?.data) {
                    bodyHtml = this.decodeBase64(part.body.data);
                }
            }
        }

        const isRead = !msg.labelIds?.includes('UNREAD');

        return {
            id: gmailId, // Will be replaced with UUID by storage
            integrationId: '', // Will be set by storage
            gmailId,
            threadId: msg.threadId,
            subject: getHeader('Subject'),
            snippet: msg.snippet,
            fromEmail,
            fromName,
            toEmails,
            date: internalDate || (date ? new Date(date) : undefined),
            labels: msg.labelIds,
            bodyText,
            bodyHtml,
            isRead,
            fetchedAt: new Date(),
        };
    }

    /**
     * Decode base64url encoded string
     */
    private decodeBase64(data: string): string {
        try {
            // Convert base64url to base64
            const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
            return atob(base64);
        } catch {
            return data;
        }
    }
}

export const gmailClient = new GmailClient();
