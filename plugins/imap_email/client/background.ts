/**
 * Background task handler for IMAP email plugin
 */

import { imapEmailClient } from '@genie/front/services/integrations/clients/IMAPEmailClient';

export async function backgroundTask(): Promise<void> {
    console.log('[IMAP Email Background Task] Started');

    try {
        const { integrationStorage } = await import('@genie/front/services/integrations/IntegrationStorage');

        const integrations = await integrationStorage.getIntegrations();
        const imapIntegrations = integrations.filter(i => i.provider === 'imap_email' && i.enabled);

        for (const integration of imapIntegrations) {
            try {
                await imapEmailClient.onWake(integration.id);
                console.log(`[IMAP Email Background Task] Synced integration ${integration.id}`);
            } catch (error) {
                console.error(`[IMAP Email Background Task] Failed to sync integration ${integration.id}:`, error);
            }
        }

        console.log(`[IMAP Email Background Task] Completed - synced ${imapIntegrations.length} integrations`);
    } catch (error) {
        console.error('[IMAP Email Background Task] Error:', error);
    }
}
