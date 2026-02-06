/**
 * Register client plugin handlers. Import this once at app startup (e.g. from App.tsx).
 */

import { registerClientPlugin } from './clientRegistry';
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

let registered = false;

export function registerClientPlugins(): void {
    if (registered) return;
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
