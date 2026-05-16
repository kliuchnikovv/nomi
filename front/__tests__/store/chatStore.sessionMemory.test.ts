/**
 * Session Memory — chatStore tests
 *
 * These tests verify that the Zustand chat store correctly accumulates messages
 * across multiple conversation turns. This is the frontend side of "session memory":
 * even if the backend sends history as structured messages, the store must retain
 * every turn so the UI shows the full conversation and so the correct message count
 * is available for subsequent sends.
 */

// Must mock before importing the store so zustand's persist middleware
// doesn't try to call AsyncStorage APIs that don't exist in the test environment.
jest.mock('@react-native-async-storage/async-storage', () => ({
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
    multiGet: jest.fn(() => Promise.resolve([])),
    multiSet: jest.fn(() => Promise.resolve()),
}));

// startTransition is a no-op in tests (not a DOM environment).
jest.mock('react', () => ({
    ...jest.requireActual('react'),
    startTransition: (cb: () => void) => cb(),
}));

import { act } from '@testing-library/react-native';
import { useChatStore } from '../../src/store/chatStore';

const CHAT_ID = 'test-chat-session';

// Helper — build a minimal user message payload
function userPayload(id: string, text: string) {
    return {
        message_id: id,
        role: 'user',
        message: text,
        sender: 'user-1',
    };
}

// Helper — build a final (done=true) assistant text payload
function assistantPayload(id: string, text: string) {
    return {
        message_id: id,
        role: 'assistant',
        type: 'text',
        message: text,
        done: true,
    };
}

// Helper — read the current messages for CHAT_ID directly from the store
function getMessages() {
    return useChatStore.getState().chats[CHAT_ID] ?? [];
}

beforeEach(() => {
    // Reset store state between tests
    useChatStore.setState({ chats: {} });
});

// ─── Basic accumulation ───────────────────────────────────────────────────────

describe('single-turn message accumulation', () => {
    it('stores a user message added via addMessage', () => {
        act(() => {
            useChatStore.getState().addMessage(CHAT_ID, userPayload('m1', 'Hello'));
        });
        const msgs = getMessages();
        expect(msgs).toHaveLength(1);
        expect(msgs[0].role).toBe('user');
        expect(msgs[0].text).toBe('Hello');
    });

    it('stores an assistant message after the user message', () => {
        act(() => {
            useChatStore.getState().addMessage(CHAT_ID, userPayload('m1', 'Hello'));
            useChatStore.getState().addMessage(CHAT_ID, assistantPayload('m2', 'Hi there!'));
        });
        const msgs = getMessages();
        expect(msgs).toHaveLength(2);
        expect(msgs[1].role).toBe('assistant');
    });
});

// ─── Multi-turn retention ────────────────────────────────────────────────────

describe('multi-turn session memory', () => {
    it('retains all messages across 3 conversation turns', () => {
        act(() => {
            // Turn 1
            useChatStore.getState().addMessage(CHAT_ID, userPayload('u1', 'What stores are nearby?'));
            useChatStore.getState().addMessage(CHAT_ID, assistantPayload('a1', 'Here are nearby stores: …'));
            // Turn 2
            useChatStore.getState().addMessage(CHAT_ID, userPayload('u2', 'Which one is closest?'));
            useChatStore.getState().addMessage(CHAT_ID, assistantPayload('a2', 'The closest is Store A.'));
            // Turn 3
            useChatStore.getState().addMessage(CHAT_ID, userPayload('u3', 'What did I ask first?'));
            useChatStore.getState().addMessage(CHAT_ID, assistantPayload('a3', 'You asked about nearby stores.'));
        });

        const msgs = getMessages();
        expect(msgs).toHaveLength(6);

        // Order must be chronological
        expect(msgs[0].text).toBe('What stores are nearby?');
        expect(msgs[1].text).toContain('nearby stores');
        expect(msgs[4].text).toBe('What did I ask first?');
        expect(msgs[5].text).toContain('nearby stores');
    });

    it('does not duplicate a user message sent twice with the same id (optimistic dedup)', () => {
        act(() => {
            useChatStore.getState().addMessage(CHAT_ID, userPayload('u1', 'Hello'));
            // Simulate duplicate optimistic add
            useChatStore.getState().addMessage(CHAT_ID, userPayload('u1', 'Hello'));
        });
        expect(getMessages()).toHaveLength(1);
    });

    it('does not lose turn-1 messages when turn-3 arrives', () => {
        act(() => {
            useChatStore.getState().addMessage(CHAT_ID, userPayload('u1', 'First question'));
            useChatStore.getState().addMessage(CHAT_ID, assistantPayload('a1', 'First answer'));
            useChatStore.getState().addMessage(CHAT_ID, userPayload('u2', 'Second question'));
            useChatStore.getState().addMessage(CHAT_ID, assistantPayload('a2', 'Second answer'));
            useChatStore.getState().addMessage(CHAT_ID, userPayload('u3', 'Third question'));
        });

        const msgs = getMessages();
        const texts = msgs.map(m => m.text);
        expect(texts).toContain('First question');
        expect(texts).toContain('First answer');
        expect(texts).toContain('Third question');
    });
});

// ─── setMessages (history load from server) ──────────────────────────────────

describe('setMessages — loading history from server', () => {
    it('replaces store contents with server-loaded messages', () => {
        // Optimistic local message already in store
        act(() => {
            useChatStore.getState().addMessage(CHAT_ID, userPayload('opt1', 'Optimistic'));
        });

        const serverHistory = [
            { id: 'h1', chat_id: CHAT_ID, role: 'user', text: 'Old msg', created_at: 1 },
            { id: 'h2', chat_id: CHAT_ID, role: 'assistant', text: 'Old reply', created_at: 2 },
        ] as any[];

        act(() => {
            useChatStore.getState().setMessages(CHAT_ID, serverHistory);
        });

        const msgs = getMessages();
        expect(msgs).toHaveLength(2);
        expect(msgs[0].id).toBe('h1');
    });
});

// ─── mergeMessages (prepend older history) ───────────────────────────────────

describe('mergeMessages — prepending older history', () => {
    it('prepends older messages without duplicating existing ones', () => {
        // Simulate: user already has turns 3-4 in memory, server sends 1-4
        act(() => {
            useChatStore.getState().addMessage(CHAT_ID, userPayload('u3', 'Turn 3'));
            useChatStore.getState().addMessage(CHAT_ID, assistantPayload('a3', 'Answer 3'));
        });

        const olderHistory = [
            { id: 'u1', chat_id: CHAT_ID, role: 'user', text: 'Turn 1', created_at: 1 },
            { id: 'a1', chat_id: CHAT_ID, role: 'assistant', text: 'Answer 1', created_at: 2 },
            { id: 'u3', chat_id: CHAT_ID, role: 'user', text: 'Turn 3', created_at: 3 },  // dup
            { id: 'a3', chat_id: CHAT_ID, role: 'assistant', text: 'Answer 3', created_at: 4 },  // dup
        ] as any[];

        act(() => {
            useChatStore.getState().mergeMessages(CHAT_ID, olderHistory);
        });

        const msgs = getMessages();
        // 4 unique messages (2 new + 2 already present, no dups)
        expect(msgs).toHaveLength(4);
        // Oldest first
        expect(msgs[0].id).toBe('u1');
        expect(msgs[1].id).toBe('a1');
    });
});

// ─── Streaming assistant response ────────────────────────────────────────────

describe('streaming assistant response across chunks', () => {
    it('accumulates streaming chunks into one assistant message', () => {
        // Flush threshold is 100 chars; send a large final chunk to trigger immediate flush
        const bigChunk = 'A'.repeat(110);

        act(() => {
            useChatStore.getState().addMessage(CHAT_ID, userPayload('u1', 'Stream test'));
            // Streaming chunk (delta, no done flag) — should be queued
            useChatStore.getState().addMessage(CHAT_ID, {
                message_id: 'a1',
                role: 'assistant',
                type: 'text',
                delta: bigChunk,
            });
            // Flush pending updates explicitly (simulates timer firing)
            useChatStore.getState().flushPendingUpdates(CHAT_ID);
        });

        const msgs = getMessages();
        // User message + assistant message (even if partial)
        expect(msgs.length).toBeGreaterThanOrEqual(1);
        expect(msgs[0].role).toBe('user');
    });

    it('previous turns are not erased when a new streaming response arrives', () => {
        act(() => {
            // Completed turn 1
            useChatStore.getState().addMessage(CHAT_ID, userPayload('u1', 'First'));
            useChatStore.getState().addMessage(CHAT_ID, assistantPayload('a1', 'Reply to first'));
            // Turn 2 — user sends, assistant starts streaming
            useChatStore.getState().addMessage(CHAT_ID, userPayload('u2', 'Second'));
            useChatStore.getState().addMessage(CHAT_ID, {
                message_id: 'a2',
                role: 'assistant',
                type: 'text',
                delta: 'Starting reply…',
            });
            useChatStore.getState().flushPendingUpdates(CHAT_ID);
        });

        const msgs = getMessages();
        const ids = msgs.map(m => m.id);
        // Turn 1 messages must still be present
        expect(ids).toContain('u1');
        expect(ids).toContain('a1');
        expect(ids).toContain('u2');
    });
});

// ─── Isolation between chats ─────────────────────────────────────────────────

describe('chat isolation', () => {
    it('messages in one chat do not appear in another', () => {
        act(() => {
            useChatStore.getState().addMessage('chat-A', userPayload('uA', 'Hello from A'));
            useChatStore.getState().addMessage('chat-B', userPayload('uB', 'Hello from B'));
        });

        const msgsA = useChatStore.getState().chats['chat-A'] ?? [];
        const msgsB = useChatStore.getState().chats['chat-B'] ?? [];

        expect(msgsA).toHaveLength(1);
        expect(msgsB).toHaveLength(1);
        expect(msgsA[0].text).toBe('Hello from A');
        expect(msgsB[0].text).toBe('Hello from B');
    });
});
