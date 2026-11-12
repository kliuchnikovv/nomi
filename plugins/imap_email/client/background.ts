/**
 * Background task handler for IMAP email plugin
 */

export async function backgroundTask(): Promise<void> {
    console.log('[IMAP Email Background Task] Started');

    try {
        const { integrationStorage } = await import('@nomi/front/services/integrations/IntegrationStorage');
        const { imapEmailClient } = await import('@nomi/front/services/integrations/clients/IMAPEmailClient');

        const integrations = await integrationStorage.getIntegrations();
        const imapIntegrations = integrations.filter(i => i.provider === 'imap' && i.enabled);

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
