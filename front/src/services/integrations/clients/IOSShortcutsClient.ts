/**
 * iOS Shortcuts Client
 * Uses React Native module to access iOS Shortcuts via SiriKit and URL scheme
 */

import { NativeModules, Platform } from 'react-native';
import { getDatabase } from '../../database/database';

const { IOSShortcutsManager } = NativeModules;

export interface SirikitShortcut {
    id: string;
    name?: string;
    phrase: string;
    intentType?: string;
    activityType?: string;
}

export interface ManualShortcut {
    id: number;
    name: string;
    description?: string;
    created_at: string;
}

export interface Shortcut {
    id?: string;
    name: string;
    phrase?: string;
    description?: string;
    source: 'sirikit' | 'manual';
}

export interface RunResult {
    launched: boolean;
    name: string;
    url: string;
}

export interface DonateResult {
    donated: boolean;
    name: string;
    suggestedPhrase: string;
}

export interface ImportShortcutResult {
    opened: boolean;
    url: string;
}

class IOSShortcutsClient {
    private ensureAvailable(): void {
        if (!IOSShortcutsManager) {
            throw new Error('IOSShortcutsManager is not available. Make sure iOS native module is properly linked.');
        }
        if (Platform.OS !== 'ios') {
            throw new Error('iOS Shortcuts is only available on iOS devices.');
        }
    }

    async getSirikitShortcuts(): Promise<SirikitShortcut[]> {
        this.ensureAvailable();
        try {
            const shortcuts: SirikitShortcut[] = await IOSShortcutsManager.getSirikitShortcuts();
            return shortcuts;
        } catch (error) {
            console.error('[IOSShortcutsClient] getSirikitShortcuts error:', error);
            throw error;
        }
    }

    async getManualList(): Promise<ManualShortcut[]> {
        const db = getDatabase();
        try {
            const results = await db.getAllAsync<ManualShortcut>(
                'SELECT id, name, description, created_at FROM ios_shortcuts_list ORDER BY name'
            );
            return results;
        } catch (error) {
            console.error('[IOSShortcutsClient] getManualList error:', error);
            return [];
        }
    }

    async listAllShortcuts(): Promise<Shortcut[]> {
        const shortcuts: Shortcut[] = [];

        const sirikit = await this.getSirikitShortcuts();
        sirikit.forEach(s => {
            shortcuts.push({
                id: s.id,
                name: s.name || s.phrase,
                phrase: s.phrase,
                source: 'sirikit'
            });
        });

        const manual = await this.getManualList();
        manual.forEach(m => {
            shortcuts.push({
                id: String(m.id),
                name: m.name,
                description: m.description,
                source: 'manual'
            });
        });

        return shortcuts;
    }

    async runShortcut(name: string, input?: string): Promise<RunResult> {
        this.ensureAvailable();
        try {
            const result: RunResult = await IOSShortcutsManager.runShortcut(name, input || null);
            return result;
        } catch (error) {
            console.error('[IOSShortcutsClient] runShortcut error:', error);
            throw error;
        }
    }

    async donateShortcut(name: string, suggestedPhrase: string): Promise<DonateResult> {
        this.ensureAvailable();
        try {
            const result: DonateResult = await IOSShortcutsManager.donateShortcut(name, suggestedPhrase);
            return result;
        } catch (error) {
            console.error('[IOSShortcutsClient] donateShortcut error:', error);
            throw error;
        }
    }

    async importShortcut(fileUrl: string, name: string): Promise<ImportShortcutResult> {
        this.ensureAvailable();
        try {
            const result: ImportShortcutResult = await IOSShortcutsManager.importShortcut(fileUrl, name);
            return result;
        } catch (error) {
            console.error('[IOSShortcutsClient] importShortcut error:', error);
            throw error;
        }
    }

    async addToManualList(name: string, description?: string): Promise<void> {
        const db = getDatabase();
        try {
            await db.runAsync(
                'INSERT OR IGNORE INTO ios_shortcuts_list (name, description) VALUES (?, ?)',
                [name, description || null]
            );
        } catch (error) {
            console.error('[IOSShortcutsClient] addToManualList error:', error);
            throw error;
        }
    }

    async removeFromManualList(name: string): Promise<void> {
        const db = getDatabase();
        try {
            await db.runAsync(
                'DELETE FROM ios_shortcuts_list WHERE name = ?',
                [name]
            );
        } catch (error) {
            console.error('[IOSShortcutsClient] removeFromManualList error:', error);
            throw error;
        }
    }
}

export const iosShortcutsClient = new IOSShortcutsClient();
export { IOSShortcutsClient };
