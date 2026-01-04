import BackgroundFetch from 'react-native-background-fetch';
import { GmailClient } from '../api/gmail';
import { CalendarClient } from '../api/calendar';
import { GitHubClient } from '../api/github';
import { saveCache, getIntegration } from '../store/db';

export const refreshIntegrations = async () => {
    console.log('[BackgroundFetch] Starting refresh...');

    // Gmail
    try {
        if (getIntegration('gmail')?.enabled) {
            const client = new GmailClient();
            const messages = await client.listMessages(5); // Get top 5 recent
            saveCache('gmail', { recent_messages: messages });
            console.log('[BackgroundFetch] Gmail refreshed');
        }
    } catch (e) {
        console.warn('[BackgroundFetch] Gmail failed', e);
    }

    // Calendar
    try {
        if (getIntegration('calendar')?.enabled) {
            const client = new CalendarClient();
            const events = await client.listEvents(5); // Next 5 events
            saveCache('calendar', { upcoming_events: events });
            console.log('[BackgroundFetch] Calendar refreshed');
        }
    } catch (e) {
        console.warn('[BackgroundFetch] Calendar failed', e);
    }

    // GitHub
    try {
        if (getIntegration('github')?.enabled) {
            const client = new GitHubClient();
            const notifications = await client.getNotifications();
            saveCache('github', { notifications: notifications.slice(0, 5) });
            console.log('[BackgroundFetch] GitHub refreshed');
        }
    } catch (e) {
        console.warn('[BackgroundFetch] GitHub failed', e);
    }

    console.log('[BackgroundFetch] Refresh complete');
};

export const configureBackgroundFetch = () => {
    BackgroundFetch.configure({
        minimumFetchInterval: 15, // 15 minutes
        stopOnTerminate: false,
        startOnBoot: true,
        enableHeadless: true,
        forceAlarmManager: false,
    }, async (taskId) => {
        console.log('[BackgroundFetch] Received event: ', taskId);
        await refreshIntegrations();
        BackgroundFetch.finish(taskId);
    }, (error) => {
        console.error('[BackgroundFetch] Failed to start', error);
    });

    // Optional: Schedule a task immediately for testing
    // BackgroundFetch.scheduleTask({
    //     taskId: 'com.genie.refresh',
    //     delay: 1000,
    //     periodic: true
    // });
};
