/**
 * iOS Calendar client plugin: executes iOS Calendar tool actions via EventKit.
 */

import type { ClientPluginHandler } from '@genie/front/plugins/clientRegistry';
import { IOSCalendarClient } from '@genie/front/services/integrations/clients/IOSCalendarClient';

export const iosCalendarPlugin: ClientPluginHandler = {
    async execute(method: string, params: Record<string, any>): Promise<string> {
        const client = new IOSCalendarClient();

        switch (method) {
            case 'get_events':
                const events = await client.getEvents(
                    params.start_date,
                    params.end_date,
                    params.limit,
                    params.calendar
                );
                return `<details><summary>Calendar Events</summary>\n\n\`\`\`json\n${JSON.stringify(events, null, 2)}\n\`\`\`\n</details>`;

            case 'create_event':
                const created = await client.createEvent(
                    params.title,
                    params.start,
                    params.end,
                    {
                        allDay: params.all_day,
                        location: params.location,
                        notes: params.notes,
                        url: params.url,
                        calendar: params.calendar
                    }
                );
                return `Event created: ${created.title} at ${new Date(created.start).toLocaleString()}`;

            case 'update_event':
                const updated = await client.updateEvent(
                    params.id,
                    {
                        title: params.title,
                        start: params.start,
                        end: params.end,
                        allDay: params.all_day,
                        location: params.location,
                        notes: params.notes,
                        url: params.url
                    }
                );
                return `Event updated: ${updated.title}`;

            case 'delete_event':
                await client.deleteEvent(params.id);
                return `Event deleted: ${params.id}`;

            case 'get_calendars':
                const calendars = await client.getCalendars();
                return `<details><summary>Calendars</summary>\n\n\`\`\`json\n${JSON.stringify(calendars, null, 2)}\n\`\`\`\n</details>`;

            default:
                throw new Error(`Unknown iOS Calendar method: ${method}`);
        }
    },
};
