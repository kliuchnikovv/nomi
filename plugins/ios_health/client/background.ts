/**
 * iOS Health client plugin: background task that emits proactive
 * "health_anomaly" events when daily sleep or activity falls outside simple
 * thresholds. Anomalies are intentionally coarse here — the server-side LLM
 * judge decides whether each one is worth surfacing.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { IOSHealthClient } from '@genie/front/services/integrations/clients/IOSHealthClient';
import { eventsApi } from '@genie/front/apiClient';

/** Thresholds below which a metric is flagged as anomalous. */
const MIN_SLEEP_HOURS = 6;
const MIN_DAILY_STEPS = 3000;

/** AsyncStorage key for the emitted-event map {metric:date -> ISO emitted-at}. */
const EMITTED_KEY = 'proactive:emitted_health';

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
        console.warn('[iOS Health plugin] Failed to persist emitted map:', err);
    }
}

function pruneEmittedMap(map: Record<string, string>, now: number): Record<string, string> {
    const pruned: Record<string, string> = {};
    for (const [key, emittedISO] of Object.entries(map)) {
        try {
            if (now - new Date(emittedISO).getTime() < PRUNE_AGE_MS) {
                pruned[key] = emittedISO;
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
    console.log(`[iOS Health plugin] Background task triggered for ${integrationId}`);

    try {
        const client = new IOSHealthClient();
        await emitHealthAnomalies(client);
    } catch (error) {
        console.error('[iOS Health plugin] Background task error:', error);
    }
}

async function emitHealthAnomalies(client: IOSHealthClient): Promise<void> {
    const now = Date.now();
    let emitted = await loadEmittedMap();
    emitted = pruneEmittedMap(emitted, now);

    // Look at the last 24h (covers last night's sleep + yesterday's activity).
    const start = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const end = new Date(now).toISOString();
    const dayKey = new Date(now).toISOString().slice(0, 10); // YYYY-MM-DD

    const anomalies: Array<Record<string, unknown>> = [];

    // 1. Sleep duration
    try {
        const sleep = await client.getSleepAnalysis(start, end);
        const totalSleep = sleep.reduce((sum, s) => sum + (s.duration || 0), 0);
        if (sleep.length > 0 && totalSleep < MIN_SLEEP_HOURS) {
            anomalies.push({
                metric: 'sleep_duration',
                value: `${totalSleep.toFixed(1)}h`,
                threshold: `>= ${MIN_SLEEP_HOURS}h`,
                date: dayKey,
            });
        }
    } catch (err) {
        console.warn('[iOS Health plugin] Failed to read sleep:', err);
    }

    // 2. Daily steps / activity
    try {
        const activity = await client.getActivitySummary(start, end);
        if (activity && activity.steps < MIN_DAILY_STEPS) {
            anomalies.push({
                metric: 'daily_steps',
                value: String(activity.steps),
                threshold: `>= ${MIN_DAILY_STEPS}`,
                date: dayKey,
            });
        }
    } catch (err) {
        console.warn('[iOS Health plugin] Failed to read activity:', err);
    }

    let newEmissions = 0;
    for (const anomaly of anomalies) {
        const key = `${anomaly.metric}:${anomaly.date}`;
        if (emitted[key]) {
            continue;
        }
        try {
            await eventsApi.ingest({
                source: 'health',
                event_type: 'health_anomaly',
                payload: anomaly,
            });
            emitted[key] = new Date(now).toISOString();
            newEmissions++;
        } catch (err) {
            console.warn(`[iOS Health plugin] Failed to ingest anomaly ${key}:`, err);
        }
    }

    await saveEmittedMap(emitted);

    if (newEmissions > 0) {
        console.log(`[iOS Health plugin] Emitted ${newEmissions} health anomaly event(s)`);
    }
}
