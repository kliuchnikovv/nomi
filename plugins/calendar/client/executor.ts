/**
 * Calendar client plugin: executes Google Calendar tool actions.
 */

import type { ClientPluginHandler } from '@genie/front/plugins/clientRegistry';
import { calendarClient } from '@genie/front/services/integrations/clients/CalendarClient';
export const calendarPlugin: ClientPluginHandler = {
    async execute(method: string, params: Record<string, any>): Promise<string> {
        const { integrationStorage } = await import('@genie/front/services/integrations/IntegrationStorage');
        const integrations = await integrationStorage.getIntegrations();
        const calIntegrations = integrations.filter(i => i.provider === 'calendar' && i.enabled);

        // Use integration_id from params if provided (from AI agent), otherwise find first enabled.
        // integration_id may be a UUID or an accountEmail — support both.
        let integrationId = params.integration_id as string | undefined;

        if (!integrationId) {
            if (calIntegrations.length === 0) {
                throw new Error('No active Calendar integration found on device');
            }
            integrationId = calIntegrations[0].id;
        } else {
            // Resolve by UUID or accountEmail, then normalise to UUID for downstream use
            const resolved = calIntegrations.find(
                i => i.id === integrationId || i.accountEmail === integrationId
            );
            if (!resolved) {
                throw new Error(`Calendar integration '${integrationId}' not found or not enabled`);
            }
            integrationId = resolved.id;
        }

        switch (method) {
            case 'create_event':
                await calendarClient.createEvent(
                    integrationId,
                    params.title,
                    params.start,
                    params.end,
                    params.description,
                    params.attendees,
                    params.timezone
                );
                return `Event '${params.title}' created`;

            case 'list_events':
                const events = await calendarClient.listEvents(
                    integrationId,
                    params.start_time,
                    params.end_time,
                    params.max_results
                );
                const eventsJson = JSON.stringify(events.map(e => ({
                    id: e.id,
                    summary: e.summary,
                    start: e.start,
                    end: e.end,
                    status: e.status
                })), null, 2);
                return `<details><summary>Calendar Events</summary>\n\n\`\`\`json\n${eventsJson}\n\`\`\`\n</details>`;

            case 'update_event':
                await calendarClient.updateEvent(
                    integrationId,
                    params.event_id,
                    {
                        title: params.title,
                        start: params.start,
                        end: params.end,
                        description: params.description,
                        attendees: params.attendees,
                        timezone: params.timezone
                    }
                );
                return `Event ${params.event_id} updated`;

            case 'delete_event':
                await calendarClient.deleteEvent(integrationId, params.event_id);
                return `Event ${params.event_id} deleted`;

            default:
                throw new Error(`Unknown Calendar method: ${method}`);
        }
    },
};
