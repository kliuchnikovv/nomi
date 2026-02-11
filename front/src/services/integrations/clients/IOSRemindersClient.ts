/**
 * iOS Reminders Client
 * Uses React Native module to access EventKit Reminders
 */

import { NativeModules, Platform } from 'react-native';

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
        limit: number = 20
    ): Promise<Reminder[]> {
        if (!IOSRemindersManager) {
            throw new Error('IOSRemindersManager is not available. Make sure iOS native module is properly linked.');
        }

        try {
            const reminders: Reminder[] = await IOSRemindersManager.getReminders(
                list || '',
                isCompleted,
                dueDateStart,
                dueDateEnd,
                limit
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
        } = {}
    ): Promise<Reminder> {
        if (!IOSRemindersManager) {
            throw new Error('IOSRemindersManager is not available.');
        }

        const reminder = await IOSRemindersManager.createReminder(title, options);
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
        }
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
     * Index reminders for RAG (Retrieval-Augmented Generation)
     */
    async indexForRAG(integrationId: string): Promise<void> {
        if (Platform.OS !== 'ios') {
            console.warn('[IOSRemindersClient] RAG indexing is iOS only');
            return;
        }

        try {
            const { VectorStore } = await import('@genie/front/services/database/VectorStore');
            const vectorStore = new VectorStore();

            const now = new Date();
            const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

            const reminders = await this.getReminders(
                undefined,
                false,
                now.toISOString(),
                thirtyDaysLater.toISOString(),
                100
            );

            for (const reminder of reminders) {
                let content = `Reminder: ${reminder.title}. `;
                if (reminder.notes) content += `Notes: ${reminder.notes}. `;
                if (reminder.dueDate) {
                    const dueDate = new Date(reminder.dueDate).toLocaleString();
                    content += `Due: ${dueDate}. `;
                }
                if (reminder.list) content += `List: ${reminder.list}. `;

                await vectorStore.addDocument({
                    id: `ios_reminders_${integrationId}_${reminder.id}`,
                    sourceType: 'ios_reminder',
                    content,
                    metadata: {
                        integrationId,
                        reminderId: reminder.id,
                        title: reminder.title,
                        dueDate: reminder.dueDate,
                        isCompleted: reminder.isCompleted,
                        priority: reminder.priority,
                        list: reminder.list
                    }
                });
            }

            console.log(`[IOSRemindersClient] Indexed ${reminders.length} reminders for RAG`);
        } catch (error) {
            console.error('[IOSRemindersClient] indexForRAG error:', error);
        }
    }

    /**
     * Search in RAG indexed reminders
     */
    async searchInRAG(query: string, integrationId?: string): Promise<any[]> {
        if (Platform.OS !== 'ios') {
            return [];
        }

        try {
            const { VectorStore } = await import('@genie/front/services/database/VectorStore');
            const vectorStore = new VectorStore();

            const sourceType = integrationId ? `ios_reminder_${integrationId}` : 'ios_reminder';
            const results = await vectorStore.search(query, 5, sourceType);

            return results;
        } catch (error) {
            console.error('[IOSRemindersClient] searchInRAG error:', error);
            return [];
        }
    }

    /**
     * Background task handler for reminders sync
     */
    async onWake(integrationId: string): Promise<void> {
        await this.indexForRAG(integrationId);
    }
}

export const iosRemindersClient = new IOSRemindersClient();

export { IOSRemindersClient };
