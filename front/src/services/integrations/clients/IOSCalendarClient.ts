/**
 * iOS Calendar Client
 * Uses React Native module to access EventKit
 */

import { NativeModules } from 'react-native';
import { indexItemsForRAG } from './iosRagIndex';

const { IOSCalendarManager } = NativeModules;

export interface CalendarEvent {
    id: string;
    title: string;
    start: string;
    end: string;
    allDay: boolean;
    location?: string;
    notes?: string;
    url?: string;
    calendar?: string;
    status?: string;
}

export interface Calendar {
    id: string;
    title: string;
    type: string;
    source: string;
    color: string;
}

// Ensure full ISO8601 datetime string — native EventKit rejects bare YYYY-MM-DD dates
function toISO8601(date: string): string {
    return date.includes('T') ? date : `${date}T00:00:00`;
}

class IOSCalendarClient {
    /**
     * Get calendar events for a date range
     */
    async getEvents(
        startDate: string,
        endDate: string,
        limit: number = 20,
        calendar?: string,
    ): Promise<CalendarEvent[]> {
        if (!IOSCalendarManager) {
            throw new Error(
                'IOSCalendarManager is not available. Make sure iOS native module is properly linked.',
            );
        }

        try {
            const events: CalendarEvent[] = await IOSCalendarManager.getEvents(
                toISO8601(startDate),
                toISO8601(endDate),
                limit,
                calendar || '',
            );
            return events;
        } catch (error) {
            console.error('[IOSCalendarClient] getEvents error:', error);
            throw error;
        }
    }

    /**
     * Create a new calendar event
     */
    async createEvent(
        title: string,
        start: string,
        end: string,
        options: {
            allDay?: boolean;
            location?: string;
            notes?: string;
            url?: string;
            calendar?: string;
        } = {},
    ): Promise<CalendarEvent> {
        if (!IOSCalendarManager) {
            throw new Error('IOSCalendarManager is not available.');
        }

        const event = await IOSCalendarManager.createEvent(
            title,
            toISO8601(start),
            toISO8601(end),
            options,
        );
        return event;
    }

    /**
     * Update an existing event
     */
    async updateEvent(
        id: string,
        updates: {
            title?: string;
            start?: string;
            end?: string;
            allDay?: boolean;
            location?: string;
            notes?: string;
            url?: string;
        },
    ): Promise<CalendarEvent> {
        if (!IOSCalendarManager) {
            throw new Error('IOSCalendarManager is not available.');
        }

        const normalized = {
            ...updates,
            ...(updates.start && { start: toISO8601(updates.start) }),
            ...(updates.end && { end: toISO8601(updates.end) }),
        };
        const event = await IOSCalendarManager.updateEvent(id, normalized);
        return event;
    }

    /**
     * Delete an event
     */
    async deleteEvent(id: string): Promise<void> {
        if (!IOSCalendarManager) {
            throw new Error('IOSCalendarManager is not available.');
        }

        await IOSCalendarManager.deleteEvent(id);
    }

    /**
     * Get list of available calendars
     */
    async getCalendars(): Promise<Calendar[]> {
        if (!IOSCalendarManager) {
            throw new Error('IOSCalendarManager is not available.');
        }

        const calendars = await IOSCalendarManager.getCalendars();
        return calendars;
    }

    /**
     * Index events into backend RAG store
     */
    async indexForRAG(integrationId: string): Promise<void> {
        const now = new Date();
        const thirtyDaysAgo = new Date(
            now.getTime() - 30 * 24 * 60 * 60 * 1000,
        );
        const thirtyDaysLater = new Date(
            now.getTime() + 30 * 24 * 60 * 60 * 1000,
        );
        await indexItemsForRAG<CalendarEvent>(
            'IOSCalendarClient',
            () =>
                this.getEvents(
                    thirtyDaysAgo.toISOString(),
                    thirtyDaysLater.toISOString(),
                    100,
                ),
            event => {
                let content = `Event: ${event.title}. Date: ${new Date(
                    event.start,
                ).toLocaleString()} - ${new Date(event.end).toLocaleString()}.`;
                if (event.location) content += ` Location: ${event.location}.`;
                if (event.notes) content += ` Notes: ${event.notes}.`;
                return {
                    id: `ios_calendar_${integrationId}_${event.id}`,
                    sourceType: 'ios_calendar_event',
                    content,
                    metadata: { integrationId, eventId: event.id },
                };
            },
        );
    }

    /**
     * Background task handler for calendar sync
     */
    async onWake(integrationId: string): Promise<void> {
        await this.indexForRAG(integrationId);
    }
}

export const iosCalendarClient = new IOSCalendarClient();

export { IOSCalendarClient };
