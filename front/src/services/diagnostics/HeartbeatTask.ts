/**
 * HeartbeatTask — a standalone diagnostic background task.
 *
 * Its only job is to confirm that iOS/Android actually wake the app and run
 * our BackgroundFetch tasks. On wake-up it POSTs to `/api/heartbeat`. Unlike
 * integration background tasks (see BackgroundTaskManager.ts), this task does
 * NOT depend on any integration being enabled — so a missing heartbeat points
 * at the OS background mechanism itself, not at integration config.
 *
 * The server persists heartbeats, so background execution can be verified
 * remotely via `GET /api/heartbeat` even when the app is suspended and the
 * console is not observable.
 */

import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient, setAuthToken } from '../../apiClient';
import { getApiUrl } from '../../config';

export const HEARTBEAT_TASK = 'diagnostic-heartbeat';
const HEARTBEAT_LOG_KEY = '@heartbeat_log';
const HEARTBEAT_LOG_LIMIT = 20;
// iOS treats this as a hint only; the system decides the real cadence.
const HEARTBEAT_INTERVAL_SECONDS = 15 * 60;

export interface HeartbeatLogEntry {
    trigger: string;
    triggeredAt: string;
    ok: boolean;
    detail?: string;
}

/**
 * Load auth token from AsyncStorage and wire it into apiClient.
 * Required when the task runs outside the React lifecycle.
 */
async function bootstrapAuthForBackground(): Promise<void> {
    const token = await AsyncStorage.getItem('token');
    setAuthToken(token);
}

async function appendLog(entry: HeartbeatLogEntry): Promise<void> {
    try {
        const raw = await AsyncStorage.getItem(HEARTBEAT_LOG_KEY);
        const log: HeartbeatLogEntry[] = raw ? JSON.parse(raw) : [];
        log.unshift(entry);
        await AsyncStorage.setItem(
            HEARTBEAT_LOG_KEY,
            JSON.stringify(log.slice(0, HEARTBEAT_LOG_LIMIT)),
        );
    } catch (e) {
        console.warn('[Heartbeat] Failed to append local log:', e);
    }
}

/**
 * Core heartbeat: bootstrap auth, POST to the server, record result locally.
 * Shared by the background task handler and the manual trigger.
 */
async function sendHeartbeat(trigger: string): Promise<void> {
    const triggeredAt = new Date().toISOString();
    const source = trigger === 'manual' ? 'ios-manual' : 'ios-bg';
    console.log(`[Heartbeat] 💓 Sending heartbeat (trigger=${trigger})...`);

    try {
        await bootstrapAuthForBackground();
        const res = await apiClient.post<{
            status: string;
            total_count: number;
        }>(`${getApiUrl()}/heartbeat`, {
            source,
            trigger,
            triggered_at: triggeredAt,
        });
        console.log(
            `[Heartbeat] ✅ Heartbeat acked, total_count=${res?.total_count}`,
        );
        await appendLog({ trigger, triggeredAt, ok: true });
    } catch (e: any) {
        const detail = e?.message ?? String(e);
        console.error('[Heartbeat] ❌ Heartbeat failed:', detail);
        await appendLog({ trigger, triggeredAt, ok: false, detail });
    }
}

/**
 * Define the background task at module/startup level (before registration).
 * Must run before BackgroundFetch.registerTaskAsync for the same name.
 */
export function defineHeartbeatTask(): void {
    if (TaskManager.isTaskDefined(HEARTBEAT_TASK)) {
        console.log('[Heartbeat] Task already defined, skipping');
        return;
    }
    TaskManager.defineTask(HEARTBEAT_TASK, async ({ error }: any) => {
        console.log('[Heartbeat] 🚀 BACKGROUND TASK EXECUTED');
        if (error) {
            console.error('[Heartbeat] Background task error:', error);
            return BackgroundFetch.BackgroundFetchResult.Failed;
        }
        await sendHeartbeat('background-fetch');
        return BackgroundFetch.BackgroundFetchResult.NewData;
    });
    console.log(`[Heartbeat] ✅ Defined background task: ${HEARTBEAT_TASK}`);
}

/** Register the task with BackgroundFetch. Idempotent. */
export async function registerHeartbeatTask(): Promise<void> {
    try {
        const isRegistered =
            await TaskManager.isTaskRegisteredAsync(HEARTBEAT_TASK);
        if (isRegistered) {
            console.log('[Heartbeat] Task already registered');
            return;
        }
        await BackgroundFetch.registerTaskAsync(HEARTBEAT_TASK, {
            minimumInterval: HEARTBEAT_INTERVAL_SECONDS,
            stopOnTerminate: false,
            startOnBoot: true,
        });
        console.log(
            `[Heartbeat] ✓ Registered (interval hint ${HEARTBEAT_INTERVAL_SECONDS}s)`,
        );
    } catch (e) {
        console.error('[Heartbeat] Failed to register task:', e);
    }
}

/** Unregister the task (e.g. on logout). */
export async function unregisterHeartbeatTask(): Promise<void> {
    try {
        const isRegistered =
            await TaskManager.isTaskRegisteredAsync(HEARTBEAT_TASK);
        if (!isRegistered) return;
        await BackgroundFetch.unregisterTaskAsync(HEARTBEAT_TASK);
        console.log('[Heartbeat] Unregistered task');
    } catch (e) {
        console.error('[Heartbeat] Failed to unregister task:', e);
    }
}

/** Fire a heartbeat synchronously (foreground testing). */
export async function triggerHeartbeatNow(
    trigger: string = 'manual',
): Promise<void> {
    await sendHeartbeat(trigger);
}

/** Read the local heartbeat log (newest first). */
export async function getHeartbeatLog(): Promise<HeartbeatLogEntry[]> {
    try {
        const raw = await AsyncStorage.getItem(HEARTBEAT_LOG_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}
