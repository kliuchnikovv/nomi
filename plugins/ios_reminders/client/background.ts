/**
 * iOS Reminders client plugin: background sync task (RAG indexing +
 * proactive reminder-due events).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { IOSRemindersClient } from '@nomi/front/services/integrations/clients/IOSRemindersClient';
import { eventsApi } from '@nomi/front/apiClient';

/** Look-ahead window for due-reminder detection (ms). */
const UPCOMING_LOOKAHEAD_MS = 90 * 60 * 1000; // 90 minutes

/** How far in advance to fire the proactive nudge (ms). */
const FIRE_BEFORE_MS = 15 * 60 * 1000; // 15 minutes

/** AsyncStorage key for the emitted-event map {reminderId -> dueDateISO}. */
const EMITTED_KEY = 'proactive:emitted_reminders';

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
        console.warn('[iOS Reminders plugin] Failed to persist emitted map:', err);
    }
}

function pruneEmittedMap(map: Record<string, string>, now: number): Record<string, string> {
    const pruned: Record<string, string> = {};
    for (const [id, dueISO] of Object.entries(map)) {
        try {
            const due = new Date(dueISO).getTime();
            if (now - due < PRUNE_AGE_MS) {
                pruned[id] = dueISO;
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
    console.log(`[iOS Reminders plugin] Background task triggered for ${integrationId}`);

    try {
        const client = new IOSRemindersClient();

        // 1. RAG indexing (existing behaviour)
        await client.indexForRAG(integrationId);
        console.log(`[iOS Reminders plugin] Indexed reminders for RAG`);

        // 2. Proactive due-reminder detection
        await emitDueReminders(client);
    } catch (error) {
        console.error('[iOS Reminders plugin] Background task error:', error);
    }
}

async function emitDueReminders(client: IOSRemindersClient): Promise<void> {
    const now = Date.now();

    // Load and prune the emitted map
    let emitted = await loadEmittedMap();
    emitted = pruneEmittedMap(emitted, now);

    // Fetch incomplete reminders due in [now, now + UPCOMING_LOOKAHEAD_MS].
    const windowStart = new Date(now).toISOString();
    const windowEnd = new Date(now + UPCOMING_LOOKAHEAD_MS).toISOString();

    let reminders;
    try {
        reminders = await client.getReminders(
            undefined, // any list
            false, // not completed
            windowStart,
            windowEnd,
            50,
        );
    } catch (err) {
        console.error('[iOS Reminders plugin] Failed to fetch due reminders:', err);
        return;
    }

    let newEmissions = 0;

    for (const reminder of reminders) {
        if (!reminder.dueDate) {
            continue;
        }

        const dueMs = new Date(reminder.dueDate).getTime();

        // Skip already-emitted reminders
        if (emitted[reminder.id]) {
            continue;
        }

        const fireAtMs = dueMs - FIRE_BEFORE_MS;
        // If fireAt already passed (e.g. due imminently/overdue) → fire now.
        const fireImmediately = fireAtMs <= now;

        const payload: Record<string, unknown> = {
            id: reminder.id,
            title: reminder.title,
            due_date: new Date(reminder.dueDate).toISOString(),
            list: reminder.list ?? null,
            notes: reminder.notes ?? null,
        };

        try {
            await eventsApi.ingest({
                source: 'reminders',
                event_type: 'reminder_due',
                payload,
                ...(fireImmediately ? {} : { fire_at: new Date(fireAtMs).toISOString() }),
            });

            // Only mark as emitted on success
            emitted[reminder.id] = new Date(reminder.dueDate).toISOString();
            newEmissions++;
        } catch (err) {
            // Log and continue — next tick will retry (id not added to emitted)
            console.warn(
                `[iOS Reminders plugin] Failed to ingest reminder ${reminder.id} ("${reminder.title}"):`,
                err,
            );
        }
    }

    // Persist updated map (includes pruned state even if nothing new was emitted)
    await saveEmittedMap(emitted);

    if (newEmissions > 0) {
        console.log(`[iOS Reminders plugin] Emitted ${newEmissions} due reminder event(s) to proactive ingest`);
    }
}
