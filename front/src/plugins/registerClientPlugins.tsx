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
import { GithubMainScreen } from '@genie/plugin-github/components/GithubMainScreen';
import { GithubSidebarItem } from '@genie/plugin-github/components/GithubSidebarItem';
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

    registered = true;
}
