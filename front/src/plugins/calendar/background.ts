/**
 * Calendar client plugin: background sync task (events).
 */

import { calendarClient } from '../../services/integrations/clients/CalendarClient';

export async function backgroundTask(integrationId: string): Promise<void> {
    console.log(`[Calendar plugin] Syncing events for integration ${integrationId}`);
    try {
        const events = await calendarClient.syncEvents(integrationId);
        if (events.length > 0) {
            console.log(`[Calendar plugin] Synced ${events.length} calendar events`);
        }
    } catch (error) {
        console.error(`[Calendar plugin] Sync failed:`, error);
        throw error;
    }
}
