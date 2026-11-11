/**
 * iOS Contacts client plugin: background sync task (contacts + RAG indexing).
 */

import { IOSContactsClient } from '@nomi/front/services/integrations/clients/IOSContactsClient';

export async function backgroundTask(integrationId: string): Promise<void> {
    console.log(`[iOS Contacts plugin] Background task triggered for ${integrationId}`);

    try {
        const client = new IOSContactsClient();

        await client.indexForRAG(integrationId);

        console.log(`[iOS Contacts plugin] Indexed contacts for RAG`);
    } catch (error) {
        console.error('[iOS Contacts plugin] Background task error:', error);
    }
}
