/**
 * Register client plugin handlers. Import this once at app startup (e.g. from App.tsx).
 */

import { registerClientPlugin } from './clientRegistry';
import { registerChatElement } from './chatElementRegistry';
import { registerWidget } from './widgetRegistry';
import { gmailPlugin } from '@genie/plugin-gmail';
import { calendarPlugin } from '@genie/plugin-calendar';
import { githubPlugin } from '@genie/plugin-github';
import { backgroundTask as gmailBackgroundTask } from '@genie/plugin-gmail/background';
import { backgroundTask as calendarBackgroundTask } from '@genie/plugin-calendar/background';
import { backgroundTask as githubBackgroundTask } from '@genie/plugin-github/background';
import { GmailMainScreen } from '@genie/plugin-gmail/components/GmailMainScreen';
import { GmailSidebar } from '@genie/plugin-gmail/components/GmailSidebar';
import { GmailPluginScreen } from '@genie/plugin-gmail/components/GmailPluginScreen';
import { CalendarPluginScreen } from '@genie/plugin-calendar/components/CalendarPluginScreen';
import { GithubMainScreen } from '@genie/plugin-github/components/GithubMainScreen';
import { GithubSidebarItem } from '@genie/plugin-github/components/GithubSidebarItem';
import { telegramPlugin } from '@genie/plugin-telegram';
import { backgroundTask as telegramBackgroundTask } from '@genie/plugin-telegram/background';
import { TelegramMainScreen } from '@genie/plugin-telegram/components/TelegramMainScreen';
import { TelegramSidebarItem } from '@genie/plugin-telegram/components/TelegramSidebarItem';
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
    registerClientPlugin('calendar', { ...calendarPlugin, backgroundTask: calendarBackgroundTask });
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

    registered = true;
}
