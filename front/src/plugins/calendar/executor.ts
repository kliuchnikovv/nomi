/**
 * Calendar client plugin: executes Google Calendar tool actions.
 */

import type { ClientPluginHandler } from '../clientRegistry';
import { calendarClient } from '../../services/integrations/clients/CalendarClient';
import { getIntegrationMetadata, isClientOnly } from '../../services/integrations/registry';

export const calendarPlugin: ClientPluginHandler = {
    async execute(method: string, params: Record<string, any>): Promise<string> {
        const metadata = getIntegrationMetadata('calendar');
        if (!metadata || !isClientOnly('calendar')) {
            throw new Error('Calendar is not configured as a client-side integration');
        }

        const { integrationStorage } = await import('../../services/integrations/IntegrationStorage');
        const integrations = await integrationStorage.getIntegrations();
        const calInteg = integrations.find(i => i.provider === 'calendar' && i.enabled);

        if (!calInteg) {
            throw new Error('No active Calendar integration found on device');
        }

        const integrationId = calInteg.id;

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
