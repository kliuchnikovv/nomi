/**
 * Drains the server-side pending-action outbox: fetches client actions the
 * brain queued while this device was offline, executes them natively, and posts
 * the results back. Invoked from three triggers that share this single path
 * (idempotent via call_id dedupe):
 *   - app becomes active / network comes online (foreground, React lifecycle)
 *   - silent wake push received
 *   - periodic background fetch (app not foregrounded)
 */

import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    fetchPendingActions,
    sendPendingActionResult,
    setAuthToken,
} from '../../apiClient';
import { claimClientAction } from './dedupe';

const BACKGROUND_PENDING_ACTIONS_TASK = 'background-pending-actions';

let draining = false;

/**
 * Fetch, execute, and report all pending actions for the current device.
 * Safe to call concurrently (guards against overlapping drains).
 */
export async function drainPendingActions(): Promise<boolean> {
    if (draining) {
        return false;
    }
    draining = true;
    let didWork = false;
    try {
        const actions = await fetchPendingActions();
        if (!actions.length) {
            return false;
        }
        const { clientToolExecutor } = await import(
            '../tools/ClientToolExecutor'
        );
        for (const action of actions) {
            // Dedupe with the live user-channel listener: if the action already
            // executed live, skip re-running it here.
            if (!claimClientAction(action.call_id)) {
                continue;
            }
            let result: string;
            try {
                result = await clientToolExecutor.execute({
                    tool: action.tool,
                    method: action.method,
                    params: action.params || {},
                    integration_id: action.integration_id,
                });
            } catch (error: any) {
                result = `Error: ${error?.message ?? String(error)}`;
            }
            try {
                await sendPendingActionResult(action.call_id, result);
                didWork = true;
            } catch (error) {
                console.warn(
                    '[drainPendingActions] failed to post result',
                    action.call_id,
                    error,
                );
            }
        }
    } catch (error) {
        console.warn('[drainPendingActions] drain failed', error);
    } finally {
        draining = false;
    }
    return didWork;
}

// Background fetch task: drains the outbox when iOS wakes the app, even if the
// user never opens it. Runs outside the React lifecycle, so it must wire the
// auth token from storage first (same pattern as background email sync).
TaskManager.defineTask(BACKGROUND_PENDING_ACTIONS_TASK, async () => {
    try {
        const token = await AsyncStorage.getItem('token');
        if (!token) {
            return BackgroundFetch.BackgroundFetchResult.NoData;
        }
        setAuthToken(token);
        const didWork = await drainPendingActions();
        return didWork
            ? BackgroundFetch.BackgroundFetchResult.NewData
            : BackgroundFetch.BackgroundFetchResult.NoData;
    } catch (error) {
        console.error('[drainPendingActions] background task failed', error);
        return BackgroundFetch.BackgroundFetchResult.Failed;
    }
});

export async function registerPendingActionsDrain(): Promise<void> {
    try {
        const isRegistered = await TaskManager.isTaskRegisteredAsync(
            BACKGROUND_PENDING_ACTIONS_TASK,
        );
        if (isRegistered) {
            return;
        }
        await BackgroundFetch.registerTaskAsync(
            BACKGROUND_PENDING_ACTIONS_TASK,
            {
                minimumInterval: 15 * 60, // 15 minutes (iOS floor is best-effort)
                stopOnTerminate: false,
                startOnBoot: true,
            },
        );
        console.log('[drainPendingActions] background task registered');
    } catch (err) {
        console.error('[drainPendingActions] failed to register task', err);
    }
}

export async function unregisterPendingActionsDrain(): Promise<void> {
    try {
        const isRegistered = await TaskManager.isTaskRegisteredAsync(
            BACKGROUND_PENDING_ACTIONS_TASK,
        );
        if (!isRegistered) {
            return;
        }
        await BackgroundFetch.unregisterTaskAsync(
            BACKGROUND_PENDING_ACTIONS_TASK,
        );
    } catch (err) {
        console.warn(
            '[drainPendingActions] failed to unregister task (ignored)',
            err,
        );
    }
}
