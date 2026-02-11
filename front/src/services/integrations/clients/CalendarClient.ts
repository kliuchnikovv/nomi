/**
 * Calendar Client
 * Direct Google Calendar API client that uses locally stored tokens
 */

import { tokenRefreshService } from '../tokenRefreshService';
import { integrationStorage, ExtractedEvent } from '../IntegrationStorage';
import { AppleIntelligence } from '../../ai/AppleIntelligence';
import { pluginChatStorage } from '../../plugins/PluginChatStorage';

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3/calendars/primary';
const CALENDAR_API_USERS_ME_CALENDARLIST = 'https://www.googleapis.com/calendar/v3/users/me/calendarList';

export interface CalendarEvent {
    id: string;
    summary?: string;
    description?: string;
    location?: string;
    start: { dateTime?: string; date?: string; timeZone?: string };
    end: { dateTime?: string; date?: string; timeZone?: string };
    status?: string;
    htmlLink?: string;
}

export interface CalendarListResponse {
    items?: CalendarEvent[];
    nextPageToken?: string;
}

class CalendarClient {
    /**
     * Called when the system wakes up the app in the background
     */
    async onWake(integrationId: string): Promise<void> {
        console.log(`[CalendarClient] onWake triggered for ${integrationId}`);

        try {
            // 1. Fetch upcoming events for next 7 days
            const now = new Date();
            const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

            const events = await this.listEvents(
                integrationId,
                now.toISOString(),
                sevenDaysLater.toISOString(),
                20
            );

            if (events.length === 0) {
                console.log('[CalendarClient] No upcoming events to process');
                return;
            }

            // 2. Filter events that need action (tentative status or no response)
            const eventsNeedingAction = events.filter(
                event => event.status === 'tentative' || !event.status || event.status === 'confirmed'
            );

            if (eventsNeedingAction.length === 0) {
                console.log('[CalendarClient] No events needing action');
                return;
            }

            console.log(`[CalendarClient] Processing ${eventsNeedingAction.length} events with Apple Intelligence...`);

            // 3. Check if Apple Intelligence is available
            if (!AppleIntelligence.isAvailable()) {
                console.log('[CalendarClient] Apple Intelligence not available, skipping analysis');
                return;
            }

            // 4. Process each event (limit to 5 to avoid performance issues)
            const eventsToProcess = eventsNeedingAction.slice(0, 5);

            for (const event of eventsToProcess) {
                try {
                    // Check if chat already exists for this event
                    const existingChat = await pluginChatStorage.getPluginChat(event.id);
                    if (existingChat) {
                        console.log(`[CalendarClient] Chat already exists for event ${event.id}, skipping`);
                        continue;
                    }

                    // Create plugin chat for this event
                    const chat = await pluginChatStorage.createPluginChat(
                        'calendar',
                        'event_chat',
                        event.id,
                        event.summary || '(No title)',
                        {
                            eventId: event.id,
                            start: event.start.dateTime || event.start.date,
                            end: event.end?.dateTime || event.end?.date,
                            location: event.location,
                            status: event.status,
                        }
                    );

                    // Format event details
                    const startDate = event.start.dateTime
                        ? new Date(event.start.dateTime).toLocaleString()
                        : event.start.date
                        ? new Date(event.start.date).toLocaleDateString()
                        : 'Unknown';

                    // Create user message with event summary
                    const eventSummary = `Upcoming calendar event

Title: ${event.summary || '(No title)'}
Date: ${startDate}
${event.location ? `Location: ${event.location}` : ''}
${event.description ? `Description: ${event.description}` : ''}
Status: ${event.status || 'Unknown'}`;

                    await pluginChatStorage.addMessage(chat.id, 'user', eventSummary);

                    // Analyze with Apple Intelligence
                    const prompt = `Analyze this calendar event and provide helpful suggestions.

Event: ${event.summary || '(No title)'}
Date: ${startDate}
${event.location ? `Location: ${event.location}` : ''}
${event.description ? `Description: ${event.description}` : ''}
Status: ${event.status || 'Unknown'}

Provide a brief analysis:
1. What preparation might be needed for this event?
2. Should the user confirm attendance?
3. Any recommendations or reminders?

Keep your response concise and actionable.`;

                    const analysis = await AppleIntelligence.generate(prompt);

                    // Save assistant response
                    await pluginChatStorage.addMessage(chat.id, 'assistant', analysis);

                    console.log(`[CalendarClient] Created chat and analysis for event: ${event.summary}`);
                } catch (e) {
                    console.error(`[CalendarClient] Failed to process event ${event.id}:`, e);
                }
            }

            console.log(`[CalendarClient] Finished processing ${eventsToProcess.length} events`);
        } catch (error) {
            console.error('[CalendarClient] onWake error:', error);
        }
    }

    /**
     * Fetch upcoming events from Google Calendar API and cache them
     */
    async syncEvents(integrationId: string, timeMin?: Date, timeMax?: Date): Promise<ExtractedEvent[]> {
        const accessToken = await tokenRefreshService.getValidToken(integrationId);

        const start = timeMin ? timeMin.toISOString() : new Date().toISOString();
        // Default to 30 days ahead if not specified
        const end = timeMax ? timeMax.toISOString() : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        const params = new URLSearchParams({
            timeMin: start,
            timeMax: end,
            singleEvents: 'true',
            orderBy: 'startTime',
            maxResults: '50'
        });

        const response = await fetch(
            `${CALENDAR_API_BASE}/events?${params.toString()}`,
            {
                headers: { Authorization: `Bearer ${accessToken}` },
            }
        );

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error?.message || 'Failed to list Calendar events');
        }

        const data: CalendarListResponse = await response.json();

        if (!data.items || data.items.length === 0) {
            return [];
        }

        // Map to internal ExtractedEvent format
        const events: Partial<ExtractedEvent>[] = data.items.map(item => ({
            sourceId: item.id,
            title: item.summary || '(No Subject)',
            startDate: item.start.dateTime ? new Date(item.start.dateTime) : (item.start.date ? new Date(item.start.date) : new Date()),
            endDate: item.end.dateTime ? new Date(item.end.dateTime) : (item.end.date ? new Date(item.end.date) : undefined),
            location: item.location,
            status: item.status || 'confirmed',
            externalId: item.id,
        }));

        // Cache the events
        await integrationStorage.saveExtractedData(integrationId, events, []);

        console.log(`[CalendarClient] Synced ${events.length} events`);

        // Refetch from storage to get full objects with IDs
        // Note: exact query might need adjustment if we want *exactly* what we just synced, 
        // but getting all for the date range is usually what we want.
        // For simplicity, we just return what we fetched mapped to full objects (mocking IDs for return if needed, but storage handles it).
        // Best practice: Read from storage.

        // Since getEventsForDate gets specific date, we might want a range query.
        // For now, let's just return the mapped objects with generated IDs if needed, or better, implement range query in storage.
        // Let's rely on `integrationStorage` being the source of truth.

        return events as ExtractedEvent[]; // Cast for now, but better to fetch from DB if we need DB IDs.
    }

    /**
     * Get upcoming events, using cache if available
     */
    async getUpcomingEvents(integrationId: string, daysStr: number = 7): Promise<ExtractedEvent[]> {
        // This logic mimics getRecentEmails: sync in background, return cache?
        // Calendar is time-sensitive. Stale cache is bad.
        // But offline support is good.

        // For now, let's sync strictly.
        // Or implement "try cache, then sync".

        const now = new Date();
        const end = new Date(now.getTime() + daysStr * 24 * 60 * 60 * 1000);

        return this.syncEvents(integrationId, now, end);
    }

    /**
     * Create a new event on the primary calendar
     */
    async createEvent(
        integrationId: string,
        title: string,
        start: string,
        end: string,
        description?: string,
        attendees?: string[],
        timezone?: string
    ): Promise<CalendarEvent> {
        const accessToken = await tokenRefreshService.getValidToken(integrationId);

        const timeZoneToUse = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

        let endDateTime = end;
        if (!endDateTime) {
            const startDate = new Date(start);
            const endDate = new Date(startDate.getTime() + 30 * 60 * 1000); // Add 30 minutes
            endDateTime = endDate.toISOString();
        }

        const eventData: any = {
            summary: title,
            description: description,
            start: {
                dateTime: start,
                timeZone: timeZoneToUse,
            },
            end: {
                dateTime: endDateTime,
                timeZone: timeZoneToUse,
            },
        };

        if (attendees && attendees.length > 0) {
            eventData.attendees = attendees.map(email => ({ email }));
        }

        const response = await fetch(
            `${CALENDAR_API_BASE}/events`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(eventData),
            }
        );

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            const errorMessage = error.error?.message || 'Failed to create Calendar event';
            console.error('[CalendarClient] Create event failed:', errorMessage);
            throw new Error(errorMessage);
        }

        const createdEvent: CalendarEvent = await response.json();
        console.log(`[CalendarClient] Created event: ${createdEvent.id} - ${createdEvent.summary}`);
        return createdEvent;
    }

    /**
     * Delete an event
     */
    async deleteEvent(integrationId: string, eventId: string): Promise<void> {
        const accessToken = await tokenRefreshService.getValidToken(integrationId);

        const response = await fetch(
            `${CALENDAR_API_BASE}/events/${eventId}`,
            {
                method: 'DELETE',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            }
        );

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error?.message || 'Failed to delete Calendar event');
        }

        console.log(`[CalendarClient] Deleted event: ${eventId}`);
    }

    /**
     * Update an event
     */
    async updateEvent(
        integrationId: string,
        eventId: string,
        updates: {
            title?: string;
            start?: string;
            end?: string;
            description?: string;
            attendees?: string[];
            timezone?: string;
        }
    ): Promise<CalendarEvent> {
        const accessToken = await tokenRefreshService.getValidToken(integrationId);

        // First fetch existing event to patch it (or use PATCH if API supports it nicely, usually PUT resource semantic or PATCH)
        // Google Calendar API supports PATCH.

        const patchBody: any = {};
        if (updates.title) patchBody.summary = updates.title;
        if (updates.description) patchBody.description = updates.description;

        const timeZoneToUse = updates.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

        if (updates.start) {
            patchBody.start = { dateTime: updates.start, timeZone: timeZoneToUse };
        }
        if (updates.end) {
            patchBody.end = { dateTime: updates.end, timeZone: timeZoneToUse };
        }

        if (updates.attendees) {
            patchBody.attendees = updates.attendees.map(email => ({ email }));
        }

        const response = await fetch(
            `${CALENDAR_API_BASE}/events/${eventId}`,
            {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(patchBody),
            }
        );

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error?.message || 'Failed to update Calendar event');
        }

        const updatedEvent: CalendarEvent = await response.json();
        console.log(`[CalendarClient] Updated event: ${updatedEvent.id}`);
        return updatedEvent;
    }

    /**
     * List events for a specific range (wrapper for sync but returning raw for tool usage)
     */
    async listEvents(integrationId: string, start?: string, end?: string, maxResults: number = 10): Promise<CalendarEvent[]> {
        const accessToken = await tokenRefreshService.getValidToken(integrationId);

        const timeMin = start ? new Date(start).toISOString() : new Date().toISOString();
        const timeMax = end ? new Date(end).toISOString() : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        const params = new URLSearchParams({
            timeMin,
            timeMax,
            singleEvents: 'true',
            orderBy: 'startTime',
            maxResults: maxResults.toString()
        });

        const response = await fetch(
            `${CALENDAR_API_BASE}/events?${params.toString()}`,
            {
                headers: { Authorization: `Bearer ${accessToken}` },
            }
        );

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error?.message || 'Failed to list Calendar events');
        }

        const data: CalendarListResponse = await response.json();
        return data.items || [];
    }
}

export const calendarClient = new CalendarClient();
