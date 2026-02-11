/**
 * Calendar client plugin: background sync task (events).
 */

import { calendarClient } from '@genie/front/services/integrations/clients/CalendarClient';

export async function backgroundTask(integrationId: string): Promise<void> {
    console.log(`[Calendar plugin] Background task triggered for ${integrationId}`);
    await calendarClient.onWake(integrationId);
}
