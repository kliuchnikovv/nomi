/**
 * Register client plugin handlers. Import this once at app startup (e.g. from App.tsx).
 */

import { registerClientPlugin } from './clientRegistry';
import { gmailPlugin } from './gmail/executor';
import { calendarPlugin } from './calendar/executor';
import { backgroundTask as gmailBackgroundTask } from './gmail/background';
import { backgroundTask as calendarBackgroundTask } from './calendar/background';

let registered = false;

export function registerClientPlugins(): void {
    if (registered) return;
    registerClientPlugin('gmail', { ...gmailPlugin, backgroundTask: gmailBackgroundTask });
    registerClientPlugin('calendar', { ...calendarPlugin, backgroundTask: calendarBackgroundTask });
    registered = true;
}
