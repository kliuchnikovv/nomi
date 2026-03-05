/**
 * Persistent log for Gmail background task runs.
 * Stored in AsyncStorage; keeps last MAX_RUNS entries per integration.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export type EmailAction =
    | 'reminder_created'
    | 'already_seen'
    | 'not_important'
    | 'reminder_failed'
    | 'skipped_no_permission';

export interface EmailAnalysisLog {
    urgent: boolean;
    importantKeywords: string[];
    hasGmailImportant: boolean;
}

export interface ReminderDetailsLog {
    dueDate: string;
    priority: number;
    reminderId?: string;
}

export interface EmailLogEntry {
    gmailId: string;
    subject: string;
    from: string;
    date: string;
    snippet: string;
    labels: string[];
    action: EmailAction;
    analysis?: EmailAnalysisLog;
    reminderDetails?: ReminderDetailsLog;
    error?: string;
    durationMs?: number;
}

export interface BackgroundRunLog {
    timestamp: string;     // ISO string
    totalFound: number;    // total emails returned by onWake
    entries: EmailLogEntry[];
}

const logKey = (integrationId: string) => `gmail_bg_log_${integrationId}`;
const MAX_RUNS = 20;

export const backgroundLogger = {
    async append(integrationId: string, log: BackgroundRunLog): Promise<void> {
        try {
            const existing = await this.getLogs(integrationId);
            const updated = [...existing, log].slice(-MAX_RUNS);
            await AsyncStorage.setItem(logKey(integrationId), JSON.stringify(updated));
        } catch (e) {
            console.warn('[backgroundLogger] Failed to write log:', e);
        }
    },

    async getLogs(integrationId: string): Promise<BackgroundRunLog[]> {
        try {
            const raw = await AsyncStorage.getItem(logKey(integrationId));
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            console.warn('[backgroundLogger] Failed to read logs:', e);
            return [];
        }
    },

    async clearLogs(integrationId: string): Promise<void> {
        try {
            await AsyncStorage.removeItem(logKey(integrationId));
        } catch (e) {
            console.warn('[backgroundLogger] Failed to clear logs:', e);
        }
    },
};
