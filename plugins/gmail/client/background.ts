/**
 * Gmail client plugin: background sync task (emails).
 */

import { gmailClient } from '@genie/front/services/integrations/clients/GmailClient';

export async function backgroundTask(integrationId: string): Promise<void> {
    console.log(`[Gmail plugin] Background task triggered for ${integrationId}`);
    await gmailClient.onWake(integrationId);
}
