/**
 * Gmail client plugin: background sync task (emails).
 */

import { gmailClient } from '../../services/integrations/clients/GmailClient';
import { integrationStorage } from '../../services/integrations/IntegrationStorage';

export async function backgroundTask(integrationId: string): Promise<void> {
    console.log(`[Gmail plugin] Syncing emails for integration ${integrationId}`);
    const emails = await gmailClient.syncEmails(integrationId);
    if (emails.length > 0) {
        console.log(`[Gmail plugin] Synced ${emails.length} new emails`);
        const unanalyzed = await integrationStorage.getUnanalyzedEmails(5);
        if (unanalyzed.length > 0) {
            console.log(`[Gmail plugin] Found ${unanalyzed.length} unanalyzed emails`);
        }
    }
}
