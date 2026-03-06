/**
 * Register client plugin handlers. Import this once at app startup (e.g. from App.tsx).
 *
 * This function is designed to be:
 * - Optional: Plugins can fail to load without crashing the app
 * - Async-friendly: Returns a promise, but can be called without await
 * - Idempotent: Multiple calls are safe
 * - Lazy: Individual plugin imports happen on-demand with error handling
 */

import { registerClientPlugin } from './clientRegistry';
import { registerChatElement } from './chatElementRegistry';
import { registerWidget } from './widgetRegistry';
import {
    PollComponent,
    ButtonsComponent,
} from '../screens/chat/message/UIComponents';
import { BriefingCard } from '../screens/chat/components/BriefingCard';

let registered = false;
let registrationPromise: Promise<void> | null = null;

/**
 * Register all client plugins.
 *
 * Returns a Promise that resolves when all available plugins have been registered.
 * Plugins that fail to load are logged but don't prevent other plugins from loading.
 *
 * This function is idempotent - calling it multiple times is safe.
 */
export function registerClientPlugins(): Promise<void> {
    if (registered) {
        return Promise.resolve();
    }

    if (registrationPromise) {
        return registrationPromise;
    }

    registrationPromise = (async () => {
        console.log('[registerClientPlugins] Starting plugin registration...');

        // ─── Built-in chat elements ────────────────────────────
        try {
            registerChatElement({
                toolNames: 'ui_client_show_poll',
                Component: ({ args }) => (
                    <PollComponent
                        question={args.question}
                        options={args.options}
                        allowMultiple={args.allow_multiple}
                    />
                ),
            });
            registerChatElement({
                toolNames: 'ui_client_show_buttons',
                Component: ({ args }) => (
                    <ButtonsComponent text={args.text} buttons={args.buttons} />
                ),
            });
            console.log(
                '[registerClientPlugins] Built-in chat elements registered',
            );
        } catch (e) {
            console.warn(
                '[registerClientPlugins] Failed to register built-in chat elements:',
                e,
            );
        }

        // ─── Built-in widgets ──────────────────────────────────
        try {
            registerWidget({
                id: 'briefing',
                label: 'Morning Briefing',
                priority: 10,
                Component: BriefingCard,
            });
            console.log('[registerClientPlugins] Built-in widgets registered');
        } catch (e) {
            console.warn(
                '[registerClientPlugins] Failed to register built-in widgets:',
                e,
            );
        }

        // ─── Plugin handlers ───────────────────────────────────
        // Each plugin is loaded independently with error handling

        // Gmail
        try {
            console.log('[registerClientPlugins] Loading Gmail plugin...');
            const { gmailPlugin } = await import('@genie/plugin-gmail/client');
            console.log('[registerClientPlugins] Gmail plugin loaded, loading background module...');
            const gmailBackgroundModule = await import(
                '@genie/plugin-gmail/background'
            );
            const { backgroundTask: gmailBackgroundTask } =
                gmailBackgroundModule;
            console.log('[registerClientPlugins] Gmail backgroundTask loaded:', typeof gmailBackgroundTask);
            const { GmailMainScreen } = await import(
                '@genie/plugin-gmail/components/GmailMainScreen'
            );
            const { GmailSidebar } = await import(
                '@genie/plugin-gmail/components/GmailSidebar'
            );
            const { GmailPluginScreen } = await import(
                '@genie/plugin-gmail/components/GmailPluginScreen'
            );

            registerClientPlugin('gmail', {
                ...gmailPlugin,
                backgroundTask: gmailBackgroundTask,
                MainComponent: GmailMainScreen,
                SidebarComponent: GmailSidebar,
            });

            registerWidget({
                id: 'gmail-insights',
                label: 'Email Insights',
                priority: 20,
                Component: GmailPluginScreen,
            });
            console.log('[registerClientPlugins] ✅ Gmail plugin registered with background task');
        } catch (e) {
            console.warn(
                '[registerClientPlugins] ❌ Failed to load Gmail plugin:',
                e,
            );
        }

        // Calendar
        try {
            const { calendarPlugin } = await import(
                '@genie/plugin-calendar/client'
            );
            const calendarBackgroundModule = await import(
                '@genie/plugin-calendar/background'
            );
            const { backgroundTask: calendarBackgroundTask } =
                calendarBackgroundModule;
            const { CalendarPluginScreen } = await import(
                '@genie/plugin-calendar/components/CalendarPluginScreen'
            );

            registerClientPlugin('calendar', {
                ...calendarPlugin,
                backgroundTask: calendarBackgroundTask,
                MainComponent: CalendarPluginScreen,
            });

            registerWidget({
                id: 'calendar-insights',
                label: 'Event Insights',
                priority: 21,
                Component: CalendarPluginScreen,
            });
            console.log('[registerClientPlugins] Calendar plugin registered');
        } catch (e) {
            console.warn(
                '[registerClientPlugins] Failed to load Calendar plugin:',
                e,
            );
        }

        // GitHub
        try {
            const { githubPlugin } = await import(
                '@genie/plugin-github/client'
            );
            const githubBackgroundModule = await import(
                '@genie/plugin-github/background'
            );
            const { backgroundTask: githubBackgroundTask } =
                githubBackgroundModule;
            const { GithubMainScreen } = await import(
                '@genie/plugin-github/components/GithubMainScreen'
            );
            const { GithubSidebarItem } = await import(
                '@genie/plugin-github/components/GithubSidebarItem'
            );

            registerClientPlugin('github', {
                ...githubPlugin,
                backgroundTask: githubBackgroundTask,
                MainComponent: GithubMainScreen,
                SidebarComponent: GithubSidebarItem,
            });
            console.log('[registerClientPlugins] GitHub plugin registered');
        } catch (e) {
            console.warn(
                '[registerClientPlugins] Failed to load GitHub plugin:',
                e,
            );
        }

        // Telegram
        try {
            const { telegramPlugin } = await import(
                '@genie/plugin-telegram/client'
            );
            const telegramBackgroundModule = await import(
                '@genie/plugin-telegram/background'
            );
            const { backgroundTask: telegramBackgroundTask } =
                telegramBackgroundModule;
            const { TelegramMainScreen } = await import(
                '@genie/plugin-telegram/components/TelegramMainScreen'
            );
            const { TelegramSidebarItem } = await import(
                '@genie/plugin-telegram/components/TelegramSidebarItem'
            );

            registerClientPlugin('telegram', {
                ...telegramPlugin,
                backgroundTask: telegramBackgroundTask,
                MainComponent: TelegramMainScreen,
                SidebarComponent: TelegramSidebarItem,
            });
            console.log('[registerClientPlugins] Telegram plugin registered');
        } catch (e) {
            console.warn(
                '[registerClientPlugins] Failed to load Telegram plugin:',
                e,
            );
        }

        // iOS Calendar
        try {
            const { iosCalendarPlugin } = await import(
                '@genie/plugin-ios_calendar/client'
            );
            const iosCalendarBackgroundModule = await import(
                '@genie/plugin-ios_calendar/background'
            );
            const { backgroundTask: iosCalendarBackgroundTask } =
                iosCalendarBackgroundModule;
            const IOSCalendarPluginScreen = (
                await import(
                    '@genie/plugin-ios_calendar/components/IOSCalendarPluginScreen'
                )
            ).default;

            registerClientPlugin('ios_calendar', {
                ...iosCalendarPlugin,
                backgroundTask: iosCalendarBackgroundTask,
                MainComponent: IOSCalendarPluginScreen,
            });
            console.log(
                '[registerClientPlugins] iOS Calendar plugin registered',
            );
        } catch (e) {
            console.warn(
                '[registerClientPlugins] Failed to load iOS Calendar plugin:',
                e,
            );
        }

        // iOS Reminders
        try {
            const { iosRemindersPlugin } = await import(
                '@genie/plugin-ios_reminders/client'
            );
            const iosRemindersBackgroundModule = await import(
                '@genie/plugin-ios_reminders/background'
            );
            const { backgroundTask: iosRemindersBackgroundTask } =
                iosRemindersBackgroundModule;

            registerClientPlugin('ios_reminders', {
                ...iosRemindersPlugin,
                backgroundTask: iosRemindersBackgroundTask,
            });
            console.log(
                '[registerClientPlugins] iOS Reminders plugin registered',
            );
        } catch (e) {
            console.warn(
                '[registerClientPlugins] Failed to load iOS Reminders plugin:',
                e,
            );
        }

        // iOS Contacts
        try {
            const { iosContactsPlugin } = await import(
                '@genie/plugin-ios_contacts/client'
            );
            const iosContactsBackgroundModule = await import(
                '@genie/plugin-ios_contacts/background'
            );
            const { backgroundTask: iosContactsBackgroundTask } =
                iosContactsBackgroundModule;

            registerClientPlugin('ios_contacts', {
                ...iosContactsPlugin,
                backgroundTask: iosContactsBackgroundTask,
            });
            console.log(
                '[registerClientPlugins] iOS Contacts plugin registered',
            );
        } catch (e) {
            console.warn(
                '[registerClientPlugins] Failed to load iOS Contacts plugin:',
                e,
            );
        }

        // iOS Health
        try {
            const { iosHealthPlugin } = await import(
                '@genie/plugin-ios_health/client'
            );

            registerClientPlugin('ios_health', {
                ...iosHealthPlugin,
            });
            console.log('[registerClientPlugins] iOS Health plugin registered');
        } catch (e) {
            console.warn(
                '[registerClientPlugins] Failed to load iOS Health plugin:',
                e,
            );
        }

        registered = true;
        registrationPromise = null;
        console.log('[registerClientPlugins] Plugin registration complete');
    })().catch(e => {
        console.error(
            '[registerClientPlugins] Fatal error during plugin registration:',
            e,
        );
        registrationPromise = null;
        // We don't set registered = true on error, so retries are possible
    });

    return registrationPromise;
}

/**
 * Check if plugins have been registered
 */
export function arePluginsRegistered(): boolean {
    return registered;
}
