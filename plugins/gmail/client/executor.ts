/**
 * Gmail client plugin: executes Gmail tool actions.
 */

import type { ClientPluginHandler } from '@genie/front/plugins/clientRegistry';
import { gmailClient } from '@genie/front/services/integrations/clients/GmailClient';
import { getIntegrationMetadata, isClientOnly } from '@genie/front/services/integrations/registry';

export const gmailPlugin: ClientPluginHandler = {
    async execute(method: string, params: Record<string, any>): Promise<string> {
        const metadata = getIntegrationMetadata('gmail');
        if (!metadata || !isClientOnly('gmail')) {
            throw new Error('Gmail is not configured as a client-side integration');
        }

        const { integrationStorage } = await import('@genie/front/services/integrations/IntegrationStorage');
        const integrations = await integrationStorage.getIntegrations();
        
        // Use integration_id from params if provided (from AI agent), otherwise find first enabled
        let integrationId = params.integration_id;
        
        if (!integrationId) {
            // Find enabled gmail integration (case-insensitive provider check)
            const gmailInteg = integrations.find(i => i.provider.toLowerCase() === 'gmail' && i.enabled);
            if (!gmailInteg) {
                const available = integrations.map(i => `${i.provider}:${i.enabled}`).join(', ');
                throw new Error(`No active Gmail integration found on device. Available integrations: ${available}`);
            }
            integrationId = gmailInteg.id;
        } else {
            // Verify the integration exists and is enabled
            const validIntegration = integrations.find(i => i.id === integrationId && i.enabled);
            if (!validIntegration) {
                throw new Error(`Integration ${integrationId} not found or not enabled`);
            }
        }

        switch (method) {
            case 'send_email':
                await gmailClient.sendEmail(integrationId, params.to, params.subject, params.body);
                return `Email sent to ${params.to}`;

            case 'get_recent_emails':
                const emails = await gmailClient.getRecentEmails(integrationId, params.limit || 5);
                return JSON.stringify(emails.map(e => ({
                    id: e.gmailId,
                    from: e.fromEmail,
                    subject: e.subject,
                    date: e.date,
                    snippet: e.snippet
                })));

            case 'search_emails':
                const { vectorStore } = await import('@genie/front/services/database/VectorStore');
                const searchResults = await vectorStore.search(
                    params.query, 
                    params.max_results || 5, 
                    'email',
                    { integrationId: integrationId }  // Filter by specific account
                );
                if (searchResults.length === 0) {
                    return "No relevant emails found in local cache.";
                }
                return JSON.stringify(searchResults.map(r => ({
                    id: r.id,
                    content: r.content,
                    score: r.score,
                    metadata: r.metadata
                })));

            case 'get_email':
                const email = await gmailClient.fetchEmail(integrationId, params.message_id);
                if (!email) return "Email not found";
                return JSON.stringify({
                    id: email.gmailId,
                    from: email.fromEmail,
                    subject: email.subject,
                    date: email.date,
                    body: email.bodyText || email.bodyHtml
                });

            case 'reply_email':
                await gmailClient.replyToEmail(integrationId, params.message_id, params.body);
                return `Replied to email ${params.message_id}`;

            case 'create_draft':
                await gmailClient.createDraft(integrationId, params.to, params.subject, params.body);
                return `Draft created for ${params.to}`;

            default:
                throw new Error(`Unknown Gmail method: ${method}`);
        }
    },
};
