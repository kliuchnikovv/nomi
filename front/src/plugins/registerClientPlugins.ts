/**
 * Register client plugin handlers. Import this once at app startup (e.g. from App.tsx).
 */

import { registerClientPlugin } from './clientRegistry';
import { gmailPlugin } from '@genie/plugin-gmail';
import { calendarPlugin } from '@genie/plugin-calendar';
import { backgroundTask as gmailBackgroundTask } from '@genie/plugin-gmail/background';
import { backgroundTask as calendarBackgroundTask } from '@genie/plugin-calendar/background';
import { GmailMainScreen } from '@genie/plugin-gmail/components/GmailMainScreen';
import { GmailSidebarItem } from '@genie/plugin-gmail/components/GmailSidebarItem';

let registered = false;

export function registerClientPlugins(): void {
    if (registered) return;
    registerClientPlugin('gmail', { 
        ...gmailPlugin, 
        backgroundTask: gmailBackgroundTask,
        MainComponent: GmailMainScreen,
        SidebarComponent: GmailSidebarItem,
    });
    registerClientPlugin('calendar', { ...calendarPlugin, backgroundTask: calendarBackgroundTask });
    registered = true;
}
