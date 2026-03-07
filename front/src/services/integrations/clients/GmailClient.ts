/**
 * Gmail Client
 * Direct Gmail API client that uses locally stored tokens
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { tokenRefreshService } from '../tokenRefreshService';
import { integrationStorage, Email } from '../IntegrationStorage';
import { ragApi } from '../../../apiClient';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const lastRunKey = (integrationId: string) => `gmail_bg_lastrun_${integrationId}`;

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

import { AppleIntelligence } from '../../ai/AppleIntelligence';
import { pluginChatStorage } from '../../plugins/PluginChatStorage';

class GmailClient {
    /**
     * Called when the system wakes up the app in the background
     */
    async onWake(integrationId: string): Promise<Email[]> {
        console.log(`[GmailClient] onWake triggered for ${integrationId}`);

        try {
            // 1. Determine search window: since last successful run, or fallback to 1 hour ago
            const rawTs = await AsyncStorage.getItem(lastRunKey(integrationId));
            const afterEpoch = rawTs
                ? parseInt(rawTs, 10)
                : Math.floor((Date.now() - 3600 * 1000) / 1000);
            const query = `is:unread after:${afterEpoch}`;
            console.log(`[GmailClient] Search query: ${query}`);

            // 2. Fetch unread emails since last run
            const emails = await this.searchEmails(integrationId, query, 10);
            console.log(`[GmailClient] Fetched ${emails.length} unread emails from Gmail`);

            if (emails.length === 0) {
                console.log('[GmailClient] No unread emails to process');
                return [];
            }

            // Process each email (limit to 5 to avoid performance issues)
            const emailsToProcess = emails.slice(0, 5);
            console.log(`[GmailClient] Processing ${emailsToProcess.length} emails (limit: 5)...`);

            // Check if Apple Intelligence is available
            const aiAvailable = AppleIntelligence.isAvailable();
            console.log(`[GmailClient] Apple Intelligence available: ${aiAvailable}`);

            let createdChats = 0;
            let skippedChats = 0;
            let failedChats = 0;

            for (const email of emailsToProcess) {
                const emailStart = Date.now();
                try {
                    // Check if chat already exists for this email
                    const existingChat = await pluginChatStorage.getPluginChat(email.gmailId);
                    if (existingChat) {
                        console.log(`[GmailClient] Chat already exists for email ${email.gmailId} (${email.subject}), skipping`);
                        skippedChats++;
                        continue;
                    }

                    // Create plugin chat for this email
                    const chat = await pluginChatStorage.createPluginChat(
                        'gmail',
                        'email_chat',
                        email.gmailId,
                        email.subject || '(No subject)',
                        {
                            emailId: email.gmailId,
                            from: email.fromEmail,
                            fromName: email.fromName,
                            date: email.date?.toISOString(),
                        }
                    );

                    console.log(`[GmailClient] Created chat ${chat.id} for email ${email.gmailId} from ${email.fromEmail}`);

                    // Create user message with email summary
                    const emailSummary = `New email from ${email.fromName || email.fromEmail}

Subject: ${email.subject || '(No subject)'}

${email.snippet || email.bodyText?.slice(0, 300) || '(No content)'}`;

                    await pluginChatStorage.addMessage(chat.id, 'user', emailSummary);

                    // Only analyze with AI if available
                    if (aiAvailable) {
                        const prompt = `Analyze this email and provide a brief response or suggested action.

From: ${email.fromName || email.fromEmail} <${email.fromEmail}>
Subject: ${email.subject || '(No subject)'}
Text: ${email.snippet || email.bodyText?.slice(0, 500) || '(No content)'}

Provide a concise analysis:
1. What is this email about?
2. Does it require any action?
3. What would be an appropriate response or next step?

Keep your response brief and actionable.`;

                        try {
                            const aiStartTime = Date.now();
                            const analysis = await AppleIntelligence.generate(prompt);
                            const aiDuration = Date.now() - aiStartTime;
                            console.log(`[GmailClient] AI analysis completed for ${email.gmailId} in ${aiDuration}ms`);
                            await pluginChatStorage.addMessage(chat.id, 'assistant', analysis);
                        } catch (aiError) {
                            console.error(`[GmailClient] AI analysis failed for email ${email.gmailId}:`, aiError);
                            await pluginChatStorage.addMessage(chat.id, 'assistant', 'Email loaded. Would you like me to analyze this email?');
                        }
                    } else {
                        console.log('[GmailClient] Apple Intelligence not available, creating chat without analysis');
                        await pluginChatStorage.addMessage(chat.id, 'assistant', 'Email loaded. Connect Apple Intelligence on iOS for AI-powered analysis.');
                    }

                    createdChats++;
                    const duration = Date.now() - emailStart;
                    console.log(`[GmailClient] Created chat for email: ${email.subject} (${duration}ms)`);
                } catch (e) {
                    failedChats++;
                    console.error(`[GmailClient] Failed to process email ${email.gmailId}:`, e);
                }
            }

            console.log(`[GmailClient] Finished processing ${emailsToProcess.length} emails: ${createdChats} created, ${skippedChats} skipped, ${failedChats} failed`);

            // Save last successful run timestamp
            await AsyncStorage.setItem(lastRunKey(integrationId), String(Math.floor(Date.now() / 1000)));

            return emailsToProcess;
        } catch (error) {
            console.error('[GmailClient] onWake error:', error);
            return [];
        }
    }

    private async getLastSyncTimestamp(integrationId: string): Promise<number | null> {
        // Placeholder: read from storage
        return null;
    }

    // ... existing methods ...

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

        // Index emails in backend RAG store
        for (const email of emails) {
            try {
                const content = `From: ${email.fromName || email.fromEmail}. Subject: ${email.subject}. Date: ${email.date ? new Date(email.date).toLocaleDateString() : 'Unknown'}. ${email.snippet || ''}`;
                await ragApi.index({
                    id: `${integrationId}_${email.gmailId}`,
                    source_type: 'email',
                    content,
                    metadata: {
                        integrationId,
                        gmailId: email.gmailId,
                    },
                });
            } catch (err) {
                console.warn(`[GmailClient] Failed to index email ${email.gmailId}:`, err);
            }
        }

        console.log(`[GmailClient] Synced ${emails.length} emails`);

        return emails;
    }

    /**
     * Sync emails and trigger analysis for new unread emails
     * This is the recommended method if you want automatic briefing integration
     */
    async syncAndAnalyze(
        integrationId: string,
        maxResults: number = 20,
        onAsapDetected?: (emailId: string) => void
    ): Promise<Email[]> {
        const emails = await this.syncEmails(integrationId, maxResults);

        // Trigger background analysis for unread emails
        this.analyzeNewEmailsInBackground(integrationId, onAsapDetected).catch(err => {
            console.warn('[GmailClient] Background analysis failed:', err);
        });

        return emails;
    }

    /**
     * Analyze new emails in background and handle ASAP detection
     */
    private async analyzeNewEmailsInBackground(
        integrationId: string,
        onAsapDetected?: (emailId: string) => void
    ): Promise<void> {
        try {
            // Lazy import to avoid circular dependencies
            const { briefingGenerator } = await import('../../briefing/BriefingGenerator');

            // Analyze unanalyzed emails (up to 5 at a time for performance)
            const analyzed = await briefingGenerator.analyzeUnanalyzedEmails(5, integrationId);

            if (analyzed > 0 && onAsapDetected) {
                // Check for new ASAP emails
                const { integrationStorage } = await import('../IntegrationStorage');
                const asapEmails = await integrationStorage.getAsapEmails();

                for (const asap of asapEmails) {
                    // Inject into today's briefing
                    const injected = await briefingGenerator.handleAsapEmail(asap.emailId);
                    if (injected) {
                        onAsapDetected(asap.emailId);
                    }
                }
            }
        } catch (error) {
            console.error('[GmailClient] Background analysis error:', error);
        }
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

    /**
     * Send an email
     */
    async sendEmail(integrationId: string, to: string, subject: string, body: string): Promise<void> {
        const accessToken = await tokenRefreshService.getValidToken(integrationId);

        // Create email message
        // Headers + Body need to be base64url encoded

        const utf8Subject = unescape(encodeURIComponent(subject));
        const utf8Body = unescape(encodeURIComponent(body));

        const message = [
            `To: ${to}`,
            `Subject: ${utf8Subject}`,
            'Content-Type: text/plain; charset="UTF-8"',
            'MIME-Version: 1.0',
            '',
            utf8Body
        ].join('\n');

        const encodedMessage = btoa(message).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

        const response = await fetch(
            `${GMAIL_API_BASE}/messages/send`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    raw: encodedMessage
                })
            }
        );

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error?.message || 'Failed to send email');
        }

        console.log(`[GmailClient] Sent email to ${to}`);
    }
    /**
     * Search emails
     */
    async searchEmails(integrationId: string, query: string, maxResults: number = 20): Promise<Email[]> {
        const accessToken = await tokenRefreshService.getValidToken(integrationId);

        // Get list of message IDs
        const listResponse = await fetch(
            `${GMAIL_API_BASE}/messages?maxResults=${maxResults}&q=${encodeURIComponent(query)}`,
            {
                headers: { Authorization: `Bearer ${accessToken}` },
            }
        );

        if (!listResponse.ok) {
            const error = await listResponse.json().catch(() => ({}));
            throw new Error(error.error?.message || 'Failed to search Gmail messages');
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

        return emails;
    }

    /**
     * Create a draft email
     */
    async createDraft(integrationId: string, to: string, subject: string, body: string): Promise<void> {
        const accessToken = await tokenRefreshService.getValidToken(integrationId);

        const utf8Subject = unescape(encodeURIComponent(subject));
        const utf8Body = unescape(encodeURIComponent(body));

        const message = [
            `To: ${to}`,
            `Subject: ${utf8Subject}`,
            'Content-Type: text/plain; charset="UTF-8"',
            'MIME-Version: 1.0',
            '',
            utf8Body
        ].join('\n');

        const encodedMessage = btoa(message).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

        const response = await fetch(
            `${GMAIL_API_BASE}/drafts`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: {
                        raw: encodedMessage
                    }
                })
            }
        );

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error?.message || 'Failed to create draft');
        }

        console.log(`[GmailClient] Created draft to ${to}`);
    }

    /**
     * Reply to an email
     */
    async replyToEmail(integrationId: string, messageId: string, body: string): Promise<void> {
        const accessToken = await tokenRefreshService.getValidToken(integrationId);

        // First fetch the original message to get references and threadId
        const original = await this.fetchEmail(integrationId, messageId, accessToken);
        if (!original) {
            throw new Error('Original message not found');
        }

        // Construct reply headers
        const references = original.gmailId; // Simplified, ideally should get References header
        // Ideally we should look at existing headers but for basic reply:
        // In-Reply-To: <original-msg-id>
        // References: <original-msg-id>

        // NOTE: The Gmail API takes care of threading if we provide threadId.
        // But for correct email headers we should check 'Message-ID' header of original.
        // For simplicity let's rely on threadId and Subject RE: prefix.

        let subject = original.subject || '';
        if (!subject.toLowerCase().startsWith('re:')) {
            subject = `Re: ${subject}`;
        }

        // Add quoted text to body
        const quotedBody = `\n\nOn ${original.date?.toLocaleString()}, ${original.fromName || original.fromEmail} wrote:\n> ${original.snippet}`;
        const fullBody = body + quotedBody;

        const utf8Subject = unescape(encodeURIComponent(subject));
        const utf8Body = unescape(encodeURIComponent(fullBody));

        // Attempting to construct a valid RFC 2822 message
        // Important: 'In-Reply-To' and 'References' headers are needed for proper threading clients.
        // But we need the actual Message-ID header value (e.g. <abc@xyz.com>), not the Gmail ID.
        // We didn't parse Message-ID in fetchEmail.
        // We'll proceed with basic send + threadId, which Gmail usually handles well enough for grouping.

        const to = original.fromEmail || '';

        const message = [
            `To: ${to}`,
            `Subject: ${utf8Subject}`,
            'Content-Type: text/plain; charset="UTF-8"',
            'MIME-Version: 1.0',
            '',
            utf8Body
        ].join('\n');

        const encodedMessage = btoa(message).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

        const response = await fetch(
            `${GMAIL_API_BASE}/messages/send`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    raw: encodedMessage,
                    threadId: original.threadId
                })
            }
        );

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error?.message || 'Failed to reply to email');
        }

        console.log(`[GmailClient] Replied to email ${messageId}`);
    }
}

export const gmailClient = new GmailClient();
