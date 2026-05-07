import { ChatCache } from '../../src/utils/chatCache';
import type { Chat, Message } from '../../src/utils/chatCache';
import AsyncStorage from '@react-native-async-storage/async-storage';

// AsyncStorage is auto-mocked by the react-native preset

function makeChat(id: string, updated_at = 1000): Chat {
    return { id, model: 'gpt-4', title: `Chat ${id}`, mode: 'agent', created_at: 0, updated_at };
}

function makeMsg(id: string, created_at = 1000): Message {
    return { id, chat_id: 'c1', sender: 'user', role: 'user', text: 'hi', created_at };
}

beforeEach(() => {
    (AsyncStorage as any).clear();
    jest.clearAllMocks();
});

// ── cacheChats / getCachedChats ───────────────────────────────────────────────

describe('ChatCache — chats', () => {
    it('stores and retrieves chats', async () => {
        const chats = [makeChat('c1'), makeChat('c2')];
        await ChatCache.cacheChats(chats);
        const result = await ChatCache.getCachedChats();
        expect(result?.chats).toHaveLength(2);
        expect(result?.chats[0].id).toBe('c1');
    });

    it('returns null when nothing is cached', async () => {
        const result = await ChatCache.getCachedChats();
        expect(result).toBeNull();
    });

    it('returns null when stored value is invalid JSON', async () => {
        await AsyncStorage.setItem('genie_chats_cache', 'NOT_JSON');
        const result = await ChatCache.getCachedChats();
        expect(result).toBeNull();
    });

    it('stores an ISO timestamp', async () => {
        await ChatCache.cacheChats([makeChat('c1')]);
        const result = await ChatCache.getCachedChats();
        expect(result?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('getLastChatTimestamp returns null when cache is empty', async () => {
        const ts = await ChatCache.getLastChatTimestamp();
        expect(ts).toBeNull();
    });

    it('getLastChatTimestamp returns the stored timestamp', async () => {
        await ChatCache.cacheChats([makeChat('c1')]);
        const ts = await ChatCache.getLastChatTimestamp();
        expect(ts).not.toBeNull();
    });
});

// ── cacheMessages / getCachedMessages ─────────────────────────────────────────

describe('ChatCache — messages', () => {
    it('stores and retrieves messages for a chat', async () => {
        const messages = [makeMsg('m1'), makeMsg('m2')];
        await ChatCache.cacheMessages('chat-1', messages);
        const result = await ChatCache.getCachedMessages('chat-1');
        expect(result?.messages).toHaveLength(2);
    });

    it('returns null for an unknown chatId', async () => {
        const result = await ChatCache.getCachedMessages('unknown');
        expect(result).toBeNull();
    });

    it('returns null on corrupt data', async () => {
        await AsyncStorage.setItem('genie_messages_chat-1', '{bad json');
        const result = await ChatCache.getCachedMessages('chat-1');
        expect(result).toBeNull();
    });

    it('getLastMessageTimestamp returns null for unknown chat', async () => {
        const ts = await ChatCache.getLastMessageTimestamp('none');
        expect(ts).toBeNull();
    });
});

// ── updateCachedMessages ──────────────────────────────────────────────────────

describe('ChatCache.updateCachedMessages', () => {
    it('creates a fresh cache when none exists', async () => {
        await ChatCache.updateCachedMessages('chat-1', [makeMsg('m1'), makeMsg('m2')]);
        const result = await ChatCache.getCachedMessages('chat-1');
        expect(result?.messages).toHaveLength(2);
    });

    it('merges new messages with existing ones (deduplicates by id)', async () => {
        await ChatCache.cacheMessages('chat-1', [makeMsg('m1', 100), makeMsg('m2', 200)]);
        await ChatCache.updateCachedMessages('chat-1', [makeMsg('m2', 200), makeMsg('m3', 300)]);
        const result = await ChatCache.getCachedMessages('chat-1');
        expect(result?.messages.map(m => m.id)).toEqual(['m1', 'm2', 'm3']);
    });

    it('sorts merged messages by created_at ascending', async () => {
        await ChatCache.cacheMessages('chat-1', [makeMsg('m2', 200)]);
        await ChatCache.updateCachedMessages('chat-1', [makeMsg('m1', 100)]);
        const result = await ChatCache.getCachedMessages('chat-1');
        expect(result?.messages[0].id).toBe('m1');
    });

    it('caps at 200 messages for a fresh cache', async () => {
        const msgs = Array.from({ length: 250 }, (_, i) => makeMsg(`m${i}`, i));
        await ChatCache.updateCachedMessages('chat-big', msgs);
        const result = await ChatCache.getCachedMessages('chat-big');
        expect(result?.messages.length).toBe(200);
    });

    it('keeps the most recent 200 when merged exceeds limit', async () => {
        const old = Array.from({ length: 150 }, (_, i) => makeMsg(`old${i}`, i));
        await ChatCache.cacheMessages('chat-1', old);
        const fresh = Array.from({ length: 100 }, (_, i) => makeMsg(`new${i}`, 200 + i));
        await ChatCache.updateCachedMessages('chat-1', fresh);
        const result = await ChatCache.getCachedMessages('chat-1');
        expect(result!.messages.length).toBe(200);
        // Should contain the 200 newest: 50 old + 100 new = 150 newest?
        // Actually sorted by created_at; the last 200 of 250 merged.
        expect(result!.messages[0].created_at).toBeGreaterThanOrEqual(50);
    });
});

// ── clearCache ────────────────────────────────────────────────────────────────

describe('ChatCache.clearCache', () => {
    it('removes all genie_ prefixed keys', async () => {
        await ChatCache.cacheChats([makeChat('c1')]);
        await ChatCache.cacheMessages('chat-1', [makeMsg('m1')]);
        await ChatCache.clearCache();
        expect(await ChatCache.getCachedChats()).toBeNull();
        expect(await ChatCache.getCachedMessages('chat-1')).toBeNull();
    });
});
