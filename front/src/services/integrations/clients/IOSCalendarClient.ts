/**
 * iOS Calendar Client
 * Uses React Native module to access EventKit
 */

import { NativeModules, Platform } from 'react-native';

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

class IOSCalendarClient {
    /**
     * Get calendar events for a date range
     */
    async getEvents(
        startDate: string,
        endDate: string,
        limit: number = 20,
        calendar?: string
    ): Promise<CalendarEvent[]> {
        if (!IOSCalendarManager) {
            throw new Error('IOSCalendarManager is not available. Make sure iOS native module is properly linked.');
        }

        try {
            const events: CalendarEvent[] = await IOSCalendarManager.getEvents(startDate, endDate, limit, calendar || '');
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
        } = {}
    ): Promise<CalendarEvent> {
        if (!IOSCalendarManager) {
            throw new Error('IOSCalendarManager is not available.');
        }

        const event = await IOSCalendarManager.createEvent(title, start, end, options);
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
        }
    ): Promise<CalendarEvent> {
        if (!IOSCalendarManager) {
            throw new Error('IOSCalendarManager is not available.');
        }

        const event = await IOSCalendarManager.updateEvent(id, updates);
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
     * Index events for RAG (Retrieval-Augmented Generation)
     * Stores event data in VectorStore for semantic search
     */
    async indexForRAG(integrationId: string): Promise<void> {
        if (Platform.OS !== 'ios') {
            console.warn('[IOSCalendarClient] RAG indexing is iOS only');
            return;
        }

        try {
            const { VectorStore } = await import('@genie/front/services/database/VectorStore');
            const vectorStore = new VectorStore();

            const now = new Date();
            const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

            const events = await this.getEvents(
                thirtyDaysAgo.toISOString(),
                thirtyDaysLater.toISOString(),
                100
            );

            for (const event of events) {
                const startDate = new Date(event.start).toLocaleString();
                const endDate = new Date(event.end).toLocaleString();

                let content = `Event: ${event.title}. `;
                content += `Date: ${startDate} - ${endDate}. `;
                if (event.location) content += `Location: ${event.location}. `;
                if (event.notes) content += `Notes: ${event.notes}. `;

                await vectorStore.addDocument({
                    id: `ios_calendar_${integrationId}_${event.id}`,
                    sourceType: 'ios_calendar_event',
                    content,
                    metadata: {
                        integrationId,
                        eventId: event.id,
                        title: event.title,
                        startDate: event.start,
                        endDate: event.end,
                        location: event.location,
                        allDay: event.allDay
                    }
                });
            }

            console.log(`[IOSCalendarClient] Indexed ${events.length} events for RAG`);
        } catch (error) {
            console.error('[IOSCalendarClient] indexForRAG error:', error);
        }
    }

    /**
     * Search in RAG indexed calendar events
     */
    async searchInRAG(query: string, integrationId?: string): Promise<any[]> {
        if (Platform.OS !== 'ios') {
            return [];
        }

        try {
            const { VectorStore } = await import('@genie/front/services/database/VectorStore');
            const vectorStore = new VectorStore();

            const sourceType = integrationId ? `ios_calendar_event_${integrationId}` : 'ios_calendar_event';
            const results = await vectorStore.search(query, 5, sourceType);

            return results;
        } catch (error) {
            console.error('[IOSCalendarClient] searchInRAG error:', error);
            return [];
        }
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
