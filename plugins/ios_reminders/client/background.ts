/**
 * iOS Reminders client plugin: background sync task (reminders + RAG indexing).
 */

import { IOSRemindersClient } from '@genie/front/services/integrations/clients/IOSRemindersClient';

export async function backgroundTask(integrationId: string): Promise<void> {
    console.log(`[iOS Reminders plugin] Background task triggered for ${integrationId}`);

    try {
        const client = new IOSRemindersClient();

        await client.indexForRAG(integrationId);

        console.log(`[iOS Reminders plugin] Indexed reminders for RAG`);
    } catch (error) {
        console.error('[iOS Reminders plugin] Background task error:', error);
    }
}
