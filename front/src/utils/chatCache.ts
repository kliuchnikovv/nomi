import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Chat {
    id: string;
    model: string;
    title: string;
    mode: string;
    team_id?: string | null;
    icon?: string;
    created_at: number;
    updated_at: number;
    archived_at?: number | null;
}

export interface Message {
    id: string;
    chat_id: string;
    sender: string;
    role: 'user' | 'assistant' | 'system';
    text: string;
    tool_calls?: any;
    content_parts?: any;
    reasoning?: string;
    model?: string;
    actions?: any;
    attachments?: any[];
    created_at: number;
}

interface CacheEntry<T> {
    data: T;
    timestamp: string; // ISO 8601
}

const CACHE_KEYS = {
    CHATS: 'nomi_chats_cache',
    MESSAGES_PREFIX: 'nomi_messages_',
};

export class ChatCache {
    // Cache chat list
    static async cacheChats(chats: Chat[]): Promise<void> {
        const entry: CacheEntry<Chat[]> = {
            data: chats,
            timestamp: new Date().toISOString(),
        };
        await AsyncStorage.setItem(CACHE_KEYS.CHATS, JSON.stringify(entry));
    }

    static async getCachedChats(): Promise<{ chats: Chat[]; timestamp: string } | null> {
        const cached = await AsyncStorage.getItem(CACHE_KEYS.CHATS);
        if (!cached) return null;

        try {
            const entry: CacheEntry<Chat[]> = JSON.parse(cached);
            return { chats: entry.data, timestamp: entry.timestamp };
        } catch (error) {
            console.error('Failed to parse cached chats:', error);
            return null;
        }
    }

    // Cache messages for a specific chat
    static async cacheMessages(chatId: string, messages: Message[]): Promise<void> {
        const entry: CacheEntry<Message[]> = {
            data: messages,
            timestamp: new Date().toISOString(),
        };
        await AsyncStorage.setItem(
            `${CACHE_KEYS.MESSAGES_PREFIX}${chatId}`,
            JSON.stringify(entry)
        );
    }

    static async getCachedMessages(chatId: string): Promise<{ messages: Message[]; timestamp: string } | null> {
        const cached = await AsyncStorage.getItem(`${CACHE_KEYS.MESSAGES_PREFIX}${chatId}`);
        if (!cached) return null;

        try {
            const entry: CacheEntry<Message[]> = JSON.parse(cached);
            return { messages: entry.data, timestamp: entry.timestamp };
        } catch (error) {
            console.error(`Failed to parse cached messages for chat ${chatId}:`, error);
            return null;
        }
    }

    // Maximum number of messages to keep in the per-chat AsyncStorage cache
    private static readonly MAX_CACHED_MESSAGES = 200;

    // Update messages in cache (merge with WebSocket updates)
    static async updateCachedMessages(chatId: string, newMessages: Message[]): Promise<void> {
        const cached = await this.getCachedMessages(chatId);
        if (!cached) {
            // Even for a fresh cache, cap the size
            const capped = newMessages.length > this.MAX_CACHED_MESSAGES
                ? newMessages
                    .sort((a, b) => a.created_at - b.created_at)
                    .slice(-this.MAX_CACHED_MESSAGES)
                : newMessages;
            await this.cacheMessages(chatId, capped);
            return;
        }

        // Merge: keep existing messages and add new ones (deduplicate by ID)
        const messageMap = new Map<string, Message>();
        cached.messages.forEach(m => messageMap.set(m.id, m));
        newMessages.forEach(m => messageMap.set(m.id, m));

        let merged = Array.from(messageMap.values()).sort(
            (a, b) => a.created_at - b.created_at
        );

        // Prune to keep only the most recent messages
        if (merged.length > this.MAX_CACHED_MESSAGES) {
            merged = merged.slice(-this.MAX_CACHED_MESSAGES);
        }

        await this.cacheMessages(chatId, merged);
    }

    // Clear all cache (on logout)
    static async clearCache(): Promise<void> {
        try {
            const keys = await AsyncStorage.getAllKeys();
            const cacheKeys = keys.filter(k => k.startsWith('nomi_'));
            if (cacheKeys.length > 0) {
                await AsyncStorage.multiRemove(cacheKeys);
            }
        } catch (error) {
            console.error('Failed to clear cache:', error);
        }
    }

    // Get the most recent chat timestamp for conditional fetching
    static async getLastChatTimestamp(): Promise<string | null> {
        const cached = await this.getCachedChats();
        return cached?.timestamp || null;
    }

    // Get the most recent message timestamp for a chat
    static async getLastMessageTimestamp(chatId: string): Promise<string | null> {
        const cached = await this.getCachedMessages(chatId);
        return cached?.timestamp || null;
    }
}
