import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { integrationStorage } from '../integrations/IntegrationStorage';
import { gmailClient } from '../integrations/clients/GmailClient';

const BACKGROUND_EMAIL_SYNC_TASK = 'BACKGROUND_EMAIL_SYNC';

TaskManager.defineTask(BACKGROUND_EMAIL_SYNC_TASK, async () => {
    const now = new Date();
    console.log(`[BackgroundSync] Starting sync at ${now.toISOString()}`);

    try {
        const integrations = await integrationStorage.getIntegrations();
        const gmailIntegrations = integrations.filter(i => i.provider === 'gmail' && i.enabled);

        if (gmailIntegrations.length === 0) {
            console.log('[BackgroundSync] No enabled Gmail integrations found.');
            return BackgroundFetch.BackgroundFetchResult.NoData;
        }

        let hasNewData = false;

        for (const integration of gmailIntegrations) {
            console.log(`[BackgroundSync] Syncing integration: ${integration.name} (${integration.id})`);
            try {
                const emails = await gmailClient.syncEmails(integration.id);
                if (emails.length > 0) {
                    hasNewData = true;
                }
            } catch (error) {
                console.error(`[BackgroundSync] Failed to sync integration ${integration.id}:`, error);
            }
        }

        console.log(`[BackgroundSync] Sync completed. New data: ${hasNewData}`);
        return hasNewData
            ? BackgroundFetch.BackgroundFetchResult.NewData
            : BackgroundFetch.BackgroundFetchResult.NoData;

    } catch (error) {
        console.error('[BackgroundSync] Task failed:', error);
        return BackgroundFetch.BackgroundFetchResult.Failed;
    }
});

export async function registerBackgroundSync() {
    try {
        const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_EMAIL_SYNC_TASK);
        if (isRegistered) {
            console.log('[BackgroundSync] Task already registered');
            return;
        }

        console.log('[BackgroundSync] Registering task...');
        await BackgroundFetch.registerTaskAsync(BACKGROUND_EMAIL_SYNC_TASK, {
            minimumInterval: 15 * 60, // 15 minutes
            stopOnTerminate: false,   // Continue after app kill (iOS only supports this partly)
            startOnBoot: true,        // Android only
        });
        console.log('[BackgroundSync] Task registered successfully');
    } catch (err) {
        console.error('[BackgroundSync] Failed to register task:', err);
    }
}

export async function unregisterBackgroundSync() {
    try {
        const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_EMAIL_SYNC_TASK);
        if (!isRegistered) return;

        await BackgroundFetch.unregisterTaskAsync(BACKGROUND_EMAIL_SYNC_TASK);
        console.log('[BackgroundSync] Task unregistered');
    } catch (err) {
        console.error('[BackgroundSync] Failed to unregister task:', err);
    }
}
