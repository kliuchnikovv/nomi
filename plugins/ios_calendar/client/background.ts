/**
 * iOS Calendar client plugin: background sync task (events + RAG indexing +
 * proactive upcoming-meeting events).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { IOSCalendarClient } from '@nomi/front/services/integrations/clients/IOSCalendarClient';
import { eventsApi } from '@nomi/front/apiClient';

/** Look-ahead window for upcoming-meeting detection (ms). */
const UPCOMING_LOOKAHEAD_MS = 90 * 60 * 1000; // 90 minutes

/** How far in advance to fire the proactive brief (ms). */
const FIRE_BEFORE_MS = 15 * 60 * 1000; // 15 minutes

/** Minimum lead time — skip events starting within this window (ms). */
const MIN_LEAD_MS = 60 * 1000; // 1 minute

/** AsyncStorage key for the emitted-event map {eventId -> startTimeISO}. */
const EMITTED_KEY = 'proactive:emitted_calendar_events';

/** Prune emitted entries older than this (ms). */
const PRUNE_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

async function loadEmittedMap(): Promise<Record<string, string>> {
    try {
        const raw = await AsyncStorage.getItem(EMITTED_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

async function saveEmittedMap(map: Record<string, string>): Promise<void> {
    try {
        await AsyncStorage.setItem(EMITTED_KEY, JSON.stringify(map));
    } catch (err) {
        console.warn('[iOS Calendar plugin] Failed to persist emitted map:', err);
    }
}

function pruneEmittedMap(map: Record<string, string>, now: number): Record<string, string> {
    const pruned: Record<string, string> = {};
    for (const [id, startTimeISO] of Object.entries(map)) {
        try {
            const start = new Date(startTimeISO).getTime();
            if (now - start < PRUNE_AGE_MS) {
                pruned[id] = startTimeISO;
            }
        } catch {
            // Drop malformed entries
        }
    }
    return pruned;
}

// ---------------------------------------------------------------------------
// Background task
// ---------------------------------------------------------------------------

export async function backgroundTask(integrationId: string): Promise<void> {
    console.log(`[iOS Calendar plugin] Background task triggered for ${integrationId}`);

    try {
        const client = new IOSCalendarClient();

        // 1. RAG indexing (existing behaviour)
        await client.indexForRAG(integrationId);
        console.log(`[iOS Calendar plugin] Indexed events for RAG`);

        // 2. Proactive upcoming-meeting detection
        await emitUpcomingMeetings(client, integrationId);
    } catch (error) {
        console.error('[iOS Calendar plugin] Background task error:', error);
    }
}

async function emitUpcomingMeetings(
    client: IOSCalendarClient,
    integrationId: string,
): Promise<void> {
    const now = Date.now();

    // Load and prune the emitted-event map
    let emitted = await loadEmittedMap();
    emitted = pruneEmittedMap(emitted, now);

    // Fetch events in [now, now + UPCOMING_LOOKAHEAD_MS]
    const windowStart = new Date(now).toISOString();
    const windowEnd = new Date(now + UPCOMING_LOOKAHEAD_MS).toISOString();

    let events;
    try {
        events = await client.getEvents(windowStart, windowEnd, 50);
    } catch (err) {
        console.error('[iOS Calendar plugin] Failed to fetch upcoming events:', err);
        return;
    }

    let newEmissions = 0;

    for (const event of events) {
        const startMs = new Date(event.start).getTime();

        // Skip events starting within the next minute — too late to be useful
        if (startMs <= now + MIN_LEAD_MS) {
            continue;
        }

        // Skip already-emitted events
        if (emitted[event.id]) {
            continue;
        }

        const fireAtMs = startMs - FIRE_BEFORE_MS;
        // If fireAt is already in the past but event hasn't started → fire immediately
        const fireImmediately = fireAtMs <= now;

        const serializedEvent: Record<string, unknown> = {
            id: event.id,
            title: event.title,
            start_time: new Date(event.start).toISOString(),
            end_time: new Date(event.end).toISOString(),
            participants: [],
            participants_count: 0,
            location: event.location ?? null,
            notes: event.notes ?? null,
            all_day: event.allDay,
        };

        try {
            await eventsApi.ingest({
                source: 'calendar',
                event_type: 'calendar_upcoming',
                payload: serializedEvent,
                ...(fireImmediately ? {} : { fire_at: new Date(fireAtMs).toISOString() }),
            });

            // Only mark as emitted on success
            emitted[event.id] = event.start;
            newEmissions++;
        } catch (err) {
            // Log and continue — next tick will retry (event.id not added to emitted)
            console.warn(
                `[iOS Calendar plugin] Failed to ingest event ${event.id} ("${event.title}"):`,
                err,
            );
        }
    }

    // Persist updated map (includes pruned state even if nothing new was emitted)
    await saveEmittedMap(emitted);

    if (newEmissions > 0) {
        console.log(`[iOS Calendar plugin] Emitted ${newEmissions} upcoming meeting event(s) to proactive ingest`);
    }
}
