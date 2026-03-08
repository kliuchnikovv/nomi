/**
 * Plugin Chat Storage
 * Manages local storage of plugin-specific chats and messages
 */

import { getDatabase } from '../database/database';

function generateId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
}

export interface PluginChat {
    id: string;
    pluginName: string;
    recordType: string;
    sourceId: string;
    title: string;
    data?: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface PluginMessage {
    id: string;
    chatId: string;
    role: 'user' | 'assistant';
    content: string;
    createdAt: Date;
}

class PluginChatStorage {
    /**
     * Create a new plugin chat
     */
    async createPluginChat(
        pluginName: string,
        recordType: string,
        sourceId: string,
        title: string,
        data?: Record<string, any>
    ): Promise<PluginChat> {
        const db = getDatabase();
        const now = Date.now();
        const id = generateId();

        const dataStr = data ? JSON.stringify(data) : null;

        await db.runAsync(
            `INSERT INTO plugin_chats (id, plugin_name, record_type, source_id, title, data, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, pluginName, recordType, sourceId, title, dataStr, now, now]
        );

        console.log(`[PluginChatStorage] Created chat for ${pluginName}: ${title}`);

        return {
            id,
            pluginName,
            recordType,
            sourceId,
            title,
            data: dataStr || undefined,
            createdAt: new Date(now),
            updatedAt: new Date(now),
        };
    }

    /**
     * Get all plugin chats for a specific plugin, optionally filtered by integrationId stored in data JSON
     */
    async getPluginChats(pluginName: string, recordType?: string, integrationId?: string): Promise<PluginChat[]> {
        const db = getDatabase();

        let query = 'SELECT * FROM plugin_chats WHERE plugin_name = ?';
        const params: any[] = [pluginName];

        if (recordType) {
            query += ' AND record_type = ?';
            params.push(recordType);
        }

        if (integrationId) {
            query += ' AND json_extract(data, \'$.integrationId\') = ?';
            params.push(integrationId);
        }

        query += ' ORDER BY updated_at DESC';

        const rows = await db.getAllAsync<any>(query, params);

        return rows.map(row => ({
            id: row.id,
            pluginName: row.plugin_name,
            recordType: row.record_type,
            sourceId: row.source_id,
            title: row.title,
            data: row.data,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
        }));
    }

    /**
     * Get a plugin chat by source ID
     */
    async getPluginChat(sourceId: string): Promise<PluginChat | null> {
        const db = getDatabase();

        const row = await db.getFirstAsync<any>(
            'SELECT * FROM plugin_chats WHERE source_id = ?',
            [sourceId]
        );

        if (!row) {
            return null;
        }

        return {
            id: row.id,
            pluginName: row.plugin_name,
            recordType: row.record_type,
            sourceId: row.source_id,
            title: row.title,
            data: row.data,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
        };
    }

    /**
     * Get a plugin chat by ID
     */
    async getPluginChatById(chatId: string): Promise<PluginChat | null> {
        const db = getDatabase();

        const row = await db.getFirstAsync<any>(
            'SELECT * FROM plugin_chats WHERE id = ?',
            [chatId]
        );

        if (!row) {
            return null;
        }

        return {
            id: row.id,
            pluginName: row.plugin_name,
            recordType: row.record_type,
            sourceId: row.source_id,
            title: row.title,
            data: row.data,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
        };
    }

    /**
     * Add a message to a plugin chat
     */
    async addMessage(chatId: string, role: 'user' | 'assistant', content: string): Promise<PluginMessage> {
        const db = getDatabase();
        const now = Date.now();
        const id = generateId();

        await db.runAsync(
            `INSERT INTO plugin_messages (id, chat_id, role, content, created_at)
             VALUES (?, ?, ?, ?, ?)`,
            [id, chatId, role, content, now]
        );

        // Update the chat's updated_at timestamp
        await db.runAsync(
            'UPDATE plugin_chats SET updated_at = ? WHERE id = ?',
            [now, chatId]
        );

        console.log(`[PluginChatStorage] Added ${role} message to chat ${chatId}`);

        return {
            id,
            chatId,
            role,
            content,
            createdAt: new Date(now),
        };
    }

    /**
     * Get all messages for a plugin chat
     */
    async getMessages(chatId: string): Promise<PluginMessage[]> {
        const db = getDatabase();

        const rows = await db.getAllAsync<any>(
            'SELECT * FROM plugin_messages WHERE chat_id = ? ORDER BY created_at ASC',
            [chatId]
        );

        return rows.map(row => ({
            id: row.id,
            chatId: row.chat_id,
            role: row.role,
            content: row.content,
            createdAt: new Date(row.created_at),
        }));
    }

    /**
     * Delete a plugin chat and all its messages
     */
    async deletePluginChat(chatId: string): Promise<void> {
        const db = getDatabase();

        // Messages will be deleted automatically due to CASCADE
        await db.runAsync('DELETE FROM plugin_chats WHERE id = ?', [chatId]);

        console.log(`[PluginChatStorage] Deleted chat ${chatId}`);
    }

    /**
     * Delete all plugin chats (and their messages via CASCADE) for a specific plugin
     */
    async deletePluginChatsByPlugin(pluginName: string): Promise<void> {
        const db = getDatabase();
        await db.runAsync('DELETE FROM plugin_chats WHERE plugin_name = ?', [pluginName]);
        console.log(`[PluginChatStorage] Deleted all chats for plugin: ${pluginName}`);
    }

    /**
     * Merge patch into a plugin chat's data JSON, identified by sourceId.
     */
    async updateChatData(sourceId: string, patch: Record<string, any>): Promise<void> {
        const db = getDatabase();
        const existing = await this.getPluginChat(sourceId);
        const currentData = existing?.data ? JSON.parse(existing.data) : {};
        const merged = { ...currentData, ...patch };
        const now = Date.now();
        await db.runAsync(
            'UPDATE plugin_chats SET data = ?, updated_at = ? WHERE source_id = ?',
            [JSON.stringify(merged), now, sourceId]
        );
    }

    /**
     * Update a plugin chat's title
     */
    async updateChatTitle(chatId: string, title: string): Promise<void> {
        const db = getDatabase();
        const now = Date.now();

        await db.runAsync(
            'UPDATE plugin_chats SET title = ?, updated_at = ? WHERE id = ?',
            [title, now, chatId]
        );

        console.log(`[PluginChatStorage] Updated chat ${chatId} title to: ${title}`);
    }
}

export const pluginChatStorage = new PluginChatStorage();
