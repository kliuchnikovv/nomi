import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';

const BACKGROUND_SYNC_TASK = 'BACKGROUND_SYNC_TASK';

// Define the task in the global scope
TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
    try {
        // TODO: Implement actual sync logic
        // For now we just log to verify it works
        console.log('Background sync task running');

        // You would typically fetch data here and update your local database
        // const result = await syncData();

        return BackgroundFetch.BackgroundFetchResult.NewData;
    } catch (error) {
        console.error('Background sync task failed:', error);
        return BackgroundFetch.BackgroundFetchResult.Failed;
    }
});

export async function registerBackgroundSync() {
    try {
        const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK);
        if (isRegistered) {
            console.log('Background sync task already registered');
            return;
        }

        await BackgroundFetch.registerTaskAsync(BACKGROUND_SYNC_TASK, {
            minimumInterval: 15 * 60, // 15 minutes
            stopOnTerminate: false, // Android only
            startOnBoot: true, // Android only
        });

        console.log('Background sync task registered successfully');
    } catch (err) {
        console.error('Failed to register background sync task:', err);
    }
}
