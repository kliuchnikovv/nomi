import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { briefingApi } from '../../apiClient';
import { gmailClient } from '../integrations/clients/GmailClient';
import { integrationStorage } from '../integrations/IntegrationStorage';

const BACKGROUND_EMAIL_SYNC_TASK = 'background-email-sync';

TaskManager.defineTask(BACKGROUND_EMAIL_SYNC_TASK, async () => {
    try {
        let hasNewData = false;
        const integrations = await integrationStorage.getAll();
        const gmailIntegrations = integrations.filter(i => i.provider === 'gmail' && i.enabled);

        for (const integration of gmailIntegrations) {
            try {

                const emails = await gmailClient.syncEmails(integration.id);
                if (emails.length > 0) {
                    hasNewData = true;
                }

                // Analyze pending emails (incremental)
                // Limit to small batch to respect background execution time limits
                const unanalyzed = await integrationStorage.getUnanalyzedEmails(5);
                if (unanalyzed.length > 0) {
                    console.log(`[BackgroundSync] Analyzing ${unanalyzed.length} new emails...`);
                    for (const email of unanalyzed) {
                        try {
                            const textToAnalyze = (email.bodyText || email.snippet || "").substring(0, 5000); // Limit context
                            if (textToAnalyze.length < 50) {
                                // Skip too short
                                await integrationStorage.markAnalyzed(email.id);
                                continue;
                            }

                            const analysis = await briefingApi.analyze(textToAnalyze);

                            if (analysis && (analysis.events?.length > 0 || analysis.tasks?.length > 0)) {
                                await integrationStorage.saveExtractedData(
                                    email.id,
                                    analysis.events || [],
                                    analysis.tasks || []
                                );
                                hasNewData = true;
                            }

                            await integrationStorage.markAnalyzed(email.id);
                        } catch (e) {
                            console.error(`[BackgroundSync] Analysis error for ${email.id}:`, e);
                        }
                    }
                }

            } catch (error) {
                console.error(`[BackgroundSync] Failed to sync integration ${integration.id}:`, error);
            }
        } // End for loop


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
