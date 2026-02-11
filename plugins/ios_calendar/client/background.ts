/**
 * iOS Calendar client plugin: background sync task (events + RAG indexing).
 */

import { IOSCalendarClient } from '@genie/front/services/integrations/clients/IOSCalendarClient';

export async function backgroundTask(integrationId: string): Promise<void> {
    console.log(`[iOS Calendar plugin] Background task triggered for ${integrationId}`);

    try {
        const client = new IOSCalendarClient();

        await client.indexForRAG(integrationId);

        console.log(`[iOS Calendar plugin] Indexed events for RAG`);
    } catch (error) {
        console.error('[iOS Calendar plugin] Background task error:', error);
    }
}
