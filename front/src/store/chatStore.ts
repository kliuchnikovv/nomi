import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { startTransition } from 'react';
import { Message, ContentPart } from '../screens/main/models';
import { dispatchPayload } from './handlers';

// Throttling configuration for streaming performance
const STREAM_THROTTLE_MS = 120; // Update UI max ~8 times per second during streaming
const STREAM_FLUSH_THRESHOLD = 100; // Force update every 100 chars even within throttle window

interface PendingUpdate {
    payload: any;
    timestamp: number;
}

interface ChatStore {
    chats: Record<string, Message[]>;
    addMessage: (chatId: string, payload: any) => void;
    setMessages: (chatId: string, messages: Message[]) => void;
    clearChat: (chatId: string) => void;
    flushPendingUpdates: (chatId: string) => void;
}

// Throttling state (outside store to avoid re-renders)
const pendingUpdates = new Map<string, PendingUpdate[]>();
const throttleTimers = new Map<string, ReturnType<typeof setTimeout>>();
const lastFlushTime = new Map<string, number>();

// Flush accumulated streaming updates for a chat
function flushPendingUpdates(
    chatId: string, 
    set: (fn: (state: { chats: Record<string, Message[]> }) => { chats: Record<string, Message[]> }) => void
) {
    // Clear any pending timer
    const existingTimer = throttleTimers.get(chatId);
    if (existingTimer) {
        clearTimeout(existingTimer);
        throttleTimers.delete(chatId);
    }

    const updates = pendingUpdates.get(chatId);
    if (!updates || updates.length === 0) {
        return;
    }

    // Clear pending updates
    pendingUpdates.set(chatId, []);
    lastFlushTime.set(chatId, Date.now());

    // Batch all accumulated chunks into a single low-priority store update.
    // startTransition marks this as interruptible so taps/gestures get priority.
    startTransition(() => {
        set((state) => {
            let currentMessages = state.chats[chatId] || [];
            let newMessages = [...currentMessages];

            // Process all pending payloads in order
            for (const update of updates) {
                const result = onReceivedMessage(update.payload, newMessages, chatId);
                if (result !== newMessages) {
                    newMessages = result;
                }
            }

            // Only update if there were actual changes
            if (newMessages === currentMessages) {
                return state;
            }

            return {
                chats: {
                    ...state.chats,
                    [chatId]: newMessages,
                },
            };
        });
    });
}

export const useChatStore = create<ChatStore>()(
    persist(
        (set, get) => ({
            chats: {},

            setMessages: (chatId, messages) => {
                // Flush any pending streaming updates before replacing messages
                if (pendingUpdates.has(chatId) && pendingUpdates.get(chatId)!.length > 0) {
                    flushPendingUpdates(chatId, set);
                }
                set((state) => ({
                    chats: {
                        ...state.chats,
                        [chatId]: messages,
                    },
                }));
            },

            clearChat: (chatId) => {
                // Clear any pending updates for this chat
                pendingUpdates.delete(chatId);
                const existingTimer = throttleTimers.get(chatId);
                if (existingTimer) {
                    clearTimeout(existingTimer);
                    throttleTimers.delete(chatId);
                }
                lastFlushTime.delete(chatId);
                
                set((state) => {
                    const newChats = { ...state.chats };
                    delete newChats[chatId];
                    return { chats: newChats };
                });
            },

            flushPendingUpdates: (chatId) => {
                // Manually flush any pending updates for this chat
                if (pendingUpdates.has(chatId) && pendingUpdates.get(chatId)!.length > 0) {
                    flushPendingUpdates(chatId, set);
                }
            },

            addMessage: (chatId, payload) => {
                // Check if this is a streaming text chunk that should be throttled
                const isStreamingChunk = payload?.type === 'text' && 
                                         payload?.delta && 
                                         !payload?.done;
                
                if (isStreamingChunk) {
                    // Accumulate streaming chunks and throttle updates
                    if (!pendingUpdates.has(chatId)) {
                        pendingUpdates.set(chatId, []);
                    }
                    pendingUpdates.get(chatId)!.push({
                        payload,
                        timestamp: Date.now()
                    });

                    const now = Date.now();
                    const lastFlush = lastFlushTime.get(chatId) || 0;
                    const timeSinceLastFlush = now - lastFlush;
                    
                    // Calculate accumulated text length since last flush
                    const accumulatedLength = pendingUpdates.get(chatId)!
                        .reduce((sum, u) => sum + (u.payload.delta?.length || 0), 0);

                    // Flush immediately if:
                    // 1. Enough time has passed since last flush, OR
                    // 2. We've accumulated enough characters
                    if (timeSinceLastFlush >= STREAM_THROTTLE_MS || accumulatedLength >= STREAM_FLUSH_THRESHOLD) {
                        flushPendingUpdates(chatId, set);
                    } else if (!throttleTimers.has(chatId)) {
                        // Schedule a flush
                        const timer = setTimeout(() => {
                            flushPendingUpdates(chatId, set);
                        }, STREAM_THROTTLE_MS - timeSinceLastFlush);
                        throttleTimers.set(chatId, timer);
                    }
                    return;
                }

                // Non-streaming messages: flush any pending updates first, then process immediately
                if (pendingUpdates.has(chatId) && pendingUpdates.get(chatId)!.length > 0) {
                    flushPendingUpdates(chatId, set);
                }

                console.log('[ChatStore 📥 addMessage]', {
                    chatId,
                    payload_type: payload?.type,
                    payload_message_id: payload?.message_id,
                    payload_agent_name: payload?.agent_name,
                    payload_role: payload?.role,
                    payload_message_preview: payload?.message?.substring(0, 50)
                });
                startTransition(() => {
                    set((state) => {
                        const currentMessages = state.chats[chatId] || [];
                        console.log('[ChatStore 📋 Before]', {
                            chatId,
                            messageCount: currentMessages.length,
                            messageIds: currentMessages.map(m => `${m.id}${m.agent_id ? `-${m.agent_id}` : ''}`)
                        });
                        const newMessages = onReceivedMessage(payload, currentMessages, chatId);

                        if (newMessages === currentMessages) {
                            console.log('[ChatStore ⏭️  Skip] No changes, returning previous state');
                            return state;
                        }

                        console.log('[ChatStore 📋 After]', {
                            chatId,
                            messageCount: newMessages.length,
                            messageIds: newMessages.map(m => `${m.id}${m.agent_id ? `-${m.agent_id}` : ''}`),
                            added: newMessages.length - currentMessages.length
                        });
                        return {
                            chats: {
                                ...state.chats,
                                [chatId]: newMessages,
                            },
                        };
                    });
                });
            },
        }),
        {
            name: 'chat-storage',
            storage: createJSONStorage(() => AsyncStorage),
        }
    )
);

// Pure function extracted from ChatContext to handle message accumulation
function onReceivedMessage(payload: any, prevMessages: Message[], activeChatID: string): Message[] {
    console.log('[onReceivedMessage 🔄 Start]', {
        payload_type: payload?.type,
        payload_message_id: payload?.message_id,
        payload_agent_name: payload?.agent_name,
        payload_role: payload?.role,
        prevMessagesCount: prevMessages.length
    });
    let newMessages: Message[] = [...prevMessages];

    const messageID = payload.message_id;
    if (!messageID) {
        console.log('[onReceivedMessage ⚠️  No message_id] Skipping');
        return newMessages;
    }

    // Aggressive deduplication: filter out any existing duplicate messages with same ID
    // Keep only the first occurrence if duplicates exist
    const uniqueMap = new Map();
    newMessages = newMessages.filter(item => {
        const key = item.id;
        if (uniqueMap.has(key)) {
            console.log('[onReceivedMessage 🧹 Removed duplicate in state]', key);
            return false;
        }
        uniqueMap.set(key, true);
        return true;
    });

    // Check if message already exists (deduplication for optimistic updates)
    const existingMessage = newMessages.find(m => m.id === messageID);

    // For user messages: if already exists with same text, skip (optimistic duplicate)
    if (existingMessage && existingMessage.role === 'user') {
        console.log('[onReceivedMessage ⏭️  Duplicate user message] Skipping:', messageID);
        return prevMessages; // Return unchanged
    }

    let messageIdx = newMessages.findIndex((item) => {
        // Multi-agent support: message is identified by message_id AND agent_id
        // Normalize to lowercase to handle casing inconsistencies (e.g. "Souper" vs "souper")
        if (payload.agent_name && item.agent_id) {
            if (item.agent_id.toLowerCase() !== payload.agent_name.toLowerCase()) {
                return false;
            }
        }
        return item.id === payload.message_id;
    });

    if (messageIdx === -1) {
        messageIdx = newMessages.length;
        // Use role from payload if available (for multi-device sync)
        const role = payload.role || 'assistant';
        const sender = payload.sender || (role === 'user' ? 'user' : 'assistant');
        console.log('[onReceivedMessage ➕ New Message]', {
            messageID,
            role,
            sender,
            agent_id: payload.agent_name,
            index: messageIdx
        });
        newMessages[messageIdx] = {
            id: messageID,
            chat_id: activeChatID,
            sender: sender,
            role: role,
            agent_id: payload.agent_name,
            // Initialize with a space for assistant to ensure GiftedChat renders the bubble immediately
            text: role === 'user' ? (payload.message || "") : " ",
            created_at: Date.now(),
            content_parts: role === 'user' ? undefined : [], // Initialize content_parts for assistant
            attachments: payload.attachments,
            context_items: payload.context_items,
        };
        // For user messages from other devices, we're done - don't accumulate
        if (role === 'user') {
            console.log('[onReceivedMessage ✅ User message complete]');
            return newMessages;
        }
    } else {
        console.log('[onReceivedMessage 🔄 Updating existing message]', {
            messageID,
            index: messageIdx,
            agent_id: payload.agent_name
        });
    }

    // For ANY user message (new or existing), don't do text accumulation
    // User messages arrive complete in a single frame, not streamed
    const messageRole = payload.role || newMessages[messageIdx]?.role;
    if (messageRole === 'user') {
        // User messages don't stream - they're complete
        // Just update text if needed and return
        if (payload.message && newMessages[messageIdx]) {
            console.log('[onReceivedMessage 📝 User message text update]');
            newMessages[messageIdx] = {
                ...newMessages[messageIdx],
                text: payload.message, // Replace, don't append
                context_items: payload.context_items, // Preserve context items
            };
        }
        return newMessages;
    }
    console.log('[onReceivedMessage 🚀 Dispatching to handler]', {
        payload_type: payload.type,
        messageIdx
    });
    
    // Dispatch to handler for assistant messages
    return dispatchPayload(payload, newMessages, messageIdx);
}
