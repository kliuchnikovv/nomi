/**
 * iOS Reminders client plugin: executes iOS Reminders tool actions via EventKit.
 */

import type { ClientPluginHandler } from '@nomi/front/plugins/clientRegistry';
import { IOSRemindersClient } from '@nomi/front/services/integrations/clients/IOSRemindersClient';

export const iosRemindersPlugin: ClientPluginHandler = {
    async execute(method: string, params: Record<string, any>): Promise<string> {
        const client = new IOSRemindersClient();

        // Check permissions before executing any method
        const permissionStatus = await client.checkPermissionStatus();

        if (permissionStatus === 'notDetermined') {
            // Request permission
            const granted = await client.requestPermission();
            if (!granted) {
                return 'Please grant access to Reminders in the system settings to use this feature.';
            }
        } else if (permissionStatus === 'denied') {
            return 'Reminders access is denied. Please enable it in iOS Settings > Nomi > Reminders.';
        }

        // Permission granted, proceed with the method
        switch (method) {
            case 'get_reminders':
                const reminders = await client.getReminders(
                    params.list,
                    params.is_completed,
                    params.due_date_start,
                    params.due_date_end,
                    params.limit
                );
                return `<details><summary>Reminders</summary>\n\n\`\`\`json\n${JSON.stringify(reminders, null, 2)}\n\`\`\`\n</details>`;

            case 'create_reminder':
                const created = await client.createReminder(
                    params.title,
                    {
                        notes: params.notes,
                        dueDate: params.due_date,
                        priority: params.priority,
                        list: params.list,
                        url: params.url
                    }
                );
                const dueText = created.dueDate ? ` at ${new Date(created.dueDate).toLocaleString()}` : '';
                return `Reminder created: ${created.title}${dueText}`;

            case 'update_reminder':
                const updated = await client.updateReminder(
                    params.id,
                    {
                        title: params.title,
                        notes: params.notes,
                        dueDate: params.due_date,
                        isCompleted: params.is_completed,
                        priority: params.priority,
                        url: params.url
                    }
                );
                return `Reminder updated: ${updated.title}`;

            case 'complete_reminder':
                await client.completeReminder(params.id);
                return `Reminder completed: ${params.id}`;

            case 'delete_reminder':
                await client.deleteReminder(params.id);
                return `Reminder deleted: ${params.id}`;

            case 'get_lists':
                const lists = await client.getLists();
                return `<details><summary>Reminder Lists</summary>\n\n\`\`\`json\n${JSON.stringify(lists, null, 2)}\n\`\`\`\n</details>`;

            default:
                throw new Error(`Unknown iOS Reminders method: ${method}`);
        }
    },
};
