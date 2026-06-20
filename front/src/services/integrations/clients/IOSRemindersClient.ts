/**
 * iOS Reminders Client
 * Uses React Native module to access EventKit Reminders
 */

import { NativeModules } from 'react-native';
import {
    checkIOSPermissionStatus,
    openIOSPermissionSettings,
    requestIOSPermission,
} from './iosPermissions';
import { indexItemsForRAG } from './iosRagIndex';

const { IOSRemindersManager } = NativeModules;

export interface Reminder {
    id: string;
    title: string;
    notes?: string;
    dueDate?: string;
    isCompleted: boolean;
    priority: number;
    list?: string;
    url?: string;
    completionDate?: string;
    creationDate: string;
}

export interface ReminderList {
    id: string;
    title: string;
    color?: string;
    type: string;
}

class IOSRemindersClient {
    /**
     * Get reminders with optional filtering
     */
    async getReminders(
        list?: string,
        isCompleted?: boolean,
        dueDateStart?: string,
        dueDateEnd?: string,
        limit: number = 20,
    ): Promise<Reminder[]> {
        if (!IOSRemindersManager) {
            throw new Error(
                'IOSRemindersManager is not available. Make sure iOS native module is properly linked.',
            );
        }

        try {
            const reminders: Reminder[] =
                await IOSRemindersManager.getReminders(
                    list || '',
                    isCompleted ?? null,
                    dueDateStart ?? null,
                    dueDateEnd ?? null,
                    limit,
                );
            return reminders;
        } catch (error) {
            console.error('[IOSRemindersClient] getReminders error:', error);
            throw error;
        }
    }

    /**
     * Create a new reminder
     */
    async createReminder(
        title: string,
        options: {
            notes?: string;
            dueDate?: string;
            priority?: number;
            list?: string;
            url?: string;
        } = {},
    ): Promise<Reminder> {
        if (!IOSRemindersManager) {
            throw new Error('IOSRemindersManager is not available.');
        }

        const reminder = await IOSRemindersManager.createReminder(
            title,
            options,
        );
        return reminder;
    }

    /**
     * Update an existing reminder
     */
    async updateReminder(
        id: string,
        updates: {
            title?: string;
            notes?: string;
            dueDate?: string;
            isCompleted?: boolean;
            priority?: number;
            url?: string;
        },
    ): Promise<Reminder> {
        if (!IOSRemindersManager) {
            throw new Error('IOSRemindersManager is not available.');
        }

        const reminder = await IOSRemindersManager.updateReminder(id, updates);
        return reminder;
    }

    /**
     * Mark a reminder as completed
     */
    async completeReminder(id: string): Promise<Reminder> {
        return this.updateReminder(id, { isCompleted: true });
    }

    /**
     * Delete a reminder
     */
    async deleteReminder(id: string): Promise<void> {
        if (!IOSRemindersManager) {
            throw new Error('IOSRemindersManager is not available.');
        }

        await IOSRemindersManager.deleteReminder(id);
    }

    /**
     * Get list of reminder lists
     */
    async getLists(): Promise<ReminderList[]> {
        if (!IOSRemindersManager) {
            throw new Error('IOSRemindersManager is not available.');
        }

        const lists = await IOSRemindersManager.getLists();
        return lists;
    }

    /**
     * Index reminders into backend RAG store
     */
    async indexForRAG(integrationId: string): Promise<void> {
        const PRIORITY_LABEL: Record<number, string> = {
            1: 'HIGH',
            5: 'MEDIUM',
            9: 'LOW',
        };
        const now = new Date();
        const thirtyDaysLater = new Date(
            now.getTime() + 30 * 24 * 60 * 60 * 1000,
        );
        await indexItemsForRAG<Reminder>(
            'IOSRemindersClient',
            () =>
                this.getReminders(
                    undefined,
                    false,
                    now.toISOString(),
                    thirtyDaysLater.toISOString(),
                    100,
                ),
            reminder => {
                const priorityLabel =
                    PRIORITY_LABEL[reminder.priority] ??
                    (reminder.priority > 0 ? `p${reminder.priority}` : 'none');
                const dueStr = reminder.dueDate
                    ? new Date(reminder.dueDate).toLocaleString()
                    : 'no due date';
                console.log(
                    `[IOSRemindersClient]   • [${priorityLabel}] "${
                        reminder.title
                    }" — due: ${dueStr}${
                        reminder.list ? ` (${reminder.list})` : ''
                    }`,
                );
                let content = `Reminder: ${reminder.title}.`;
                if (reminder.notes) content += ` Notes: ${reminder.notes}.`;
                if (reminder.dueDate)
                    content += ` Due: ${new Date(
                        reminder.dueDate,
                    ).toLocaleString()}.`;
                if (reminder.list) content += ` List: ${reminder.list}.`;
                return {
                    id: `ios_reminders_${integrationId}_${reminder.id}`,
                    sourceType: 'ios_reminder',
                    content,
                    metadata: {
                        integrationId,
                        reminderId: reminder.id,
                        list: reminder.list,
                    },
                };
            },
        );
    }

    /**
     * Background task handler for reminders sync
     */
    async onWake(integrationId: string): Promise<void> {
        await this.indexForRAG(integrationId);
    }

    checkPermissionStatus() {
        return checkIOSPermissionStatus(
            IOSRemindersManager,
            'IOSRemindersClient',
        );
    }

    requestPermission() {
        return requestIOSPermission(IOSRemindersManager, 'IOSRemindersClient');
    }

    openSettings() {
        return openIOSPermissionSettings(
            IOSRemindersManager,
            'IOSRemindersClient',
        );
    }
}

export const iosRemindersClient = new IOSRemindersClient();

export { IOSRemindersClient };
