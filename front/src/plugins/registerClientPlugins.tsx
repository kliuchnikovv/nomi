/**
 * Register client plugin handlers. Import this once at app startup (e.g. from App.tsx).
 */

import { registerClientPlugin } from './clientRegistry';
import { registerChatElement } from './chatElementRegistry';
import { registerWidget } from './widgetRegistry';
import { gmailPlugin } from '@genie/plugin-gmail/client';
import { calendarPlugin } from '@genie/plugin-calendar/client';
import { githubPlugin } from '@genie/plugin-github/client';
import { backgroundTask as gmailBackgroundTask } from '@genie/plugin-gmail/background';
import { backgroundTask as calendarBackgroundTask } from '@genie/plugin-calendar/background';
import { backgroundTask as githubBackgroundTask } from '@genie/plugin-github/background';
import { GmailMainScreen } from '@genie/plugin-gmail/components/GmailMainScreen';
import { GmailSidebar } from '@genie/plugin-gmail/components/GmailSidebar';
import { GmailPluginScreen } from '@genie/plugin-gmail/components/GmailPluginScreen';
import { CalendarPluginScreen } from '@genie/plugin-calendar/components/CalendarPluginScreen';
import { GithubMainScreen } from '@genie/plugin-github/components/GithubMainScreen';
import { GithubSidebarItem } from '@genie/plugin-github/components/GithubSidebarItem';
import { telegramPlugin } from '@genie/plugin-telegram/client';
import { backgroundTask as telegramBackgroundTask } from '@genie/plugin-telegram/background';
import { TelegramMainScreen } from '@genie/plugin-telegram/components/TelegramMainScreen';
import { TelegramSidebarItem } from '@genie/plugin-telegram/components/TelegramSidebarItem';
import { iosCalendarPlugin } from '@genie/plugin-ios_calendar/client';
import { backgroundTask as iosCalendarBackgroundTask } from '@genie/plugin-ios_calendar/background';
import IOSCalendarPluginScreen from '@genie/plugin-ios_calendar/components/IOSCalendarPluginScreen';
import { iosRemindersPlugin } from '@genie/plugin-ios_reminders/client';
import { backgroundTask as iosRemindersBackgroundTask } from '@genie/plugin-ios_reminders/background';
import { iosContactsPlugin } from '@genie/plugin-ios_contacts/client';
import { backgroundTask as iosContactsBackgroundTask } from '@genie/plugin-ios_contacts/background';
import { iosHealthPlugin } from '@genie/plugin-ios_health/client';
import { PollComponent, ButtonsComponent } from '../screens/chat/message/UIComponents';
import { BriefingCard } from '../screens/chat/components/BriefingCard';

let registered = false;

export function registerClientPlugins(): void {
    if (registered) return;

    // ─── Built-in chat elements ────────────────────────────
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

    // ─── Built-in widgets ──────────────────────────────────
    registerWidget({
        id: 'briefing',
        label: 'Morning Briefing',
        priority: 10,
        Component: BriefingCard,
    });
    registerWidget({
        id: 'gmail-insights',
        label: 'Email Insights',
        priority: 20,
        Component: GmailPluginScreen,
    });
    registerWidget({
        id: 'calendar-insights',
        label: 'Event Insights',
        priority: 21,
        Component: CalendarPluginScreen,
    });

    // ─── Plugin handlers ───────────────────────────────────
    registerClientPlugin('gmail', {
        ...gmailPlugin,
        backgroundTask: gmailBackgroundTask,
        MainComponent: GmailMainScreen,
        SidebarComponent: GmailSidebar,
    });
    registerClientPlugin('calendar', { 
        ...calendarPlugin, 
        backgroundTask: calendarBackgroundTask,
        MainComponent: CalendarPluginScreen,
    });
    registerClientPlugin('github', {
        ...githubPlugin,
        backgroundTask: githubBackgroundTask,
        MainComponent: GithubMainScreen,
        SidebarComponent: GithubSidebarItem,
    });
    registerClientPlugin('telegram', {
        ...telegramPlugin,
        backgroundTask: telegramBackgroundTask,
        MainComponent: TelegramMainScreen,
        SidebarComponent: TelegramSidebarItem,
    });
    registerClientPlugin('ios_calendar', {
        ...iosCalendarPlugin,
        backgroundTask: iosCalendarBackgroundTask,
        MainComponent: IOSCalendarPluginScreen,
    });
    registerClientPlugin('ios_reminders', {
        ...iosRemindersPlugin,
        backgroundTask: iosRemindersBackgroundTask,
    });
    registerClientPlugin('ios_contacts', {
        ...iosContactsPlugin,
        backgroundTask: iosContactsBackgroundTask,
    });
    registerClientPlugin('ios_health', {
        ...iosHealthPlugin,
    });

    registered = true;
}
