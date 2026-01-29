import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Message, ContentPart } from '../screens/main/models';
import { dispatchPayload } from './handlers';

interface ChatStore {
    chats: Record<string, Message[]>;
    addMessage: (chatId: string, payload: any) => void;
    setMessages: (chatId: string, messages: Message[]) => void;
    clearChat: (chatId: string) => void;
}

export const useChatStore = create<ChatStore>()(
    persist(
        (set, get) => ({
            chats: {},

            setMessages: (chatId, messages) => {
                set((state) => ({
                    chats: {
                        ...state.chats,
                        [chatId]: messages,
                    },
                }));
            },

            clearChat: (chatId) => {
                set((state) => {
                    const newChats = { ...state.chats };
                    delete newChats[chatId];
                    return { chats: newChats };
                });
            },

            addMessage: (chatId, payload) => {
                set((state) => {
                    const currentMessages = state.chats[chatId] || [];
                    const newMessages = onReceivedMessage(payload, currentMessages, chatId);

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
    let newMessages: Message[] = [...prevMessages];

    const messageID = payload.message_id;
    if (!messageID) {
        return newMessages;
    }

    // Check if message already exists (deduplication for optimistic updates)
    const existingMessage = newMessages.find(m => m.id === messageID);

    // For user messages: if already exists with same text, skip (optimistic duplicate)
    if (existingMessage && existingMessage.role === 'user') {
        return prevMessages; // Return unchanged
    }

    let messageIdx = newMessages.findIndex((item) => {
        // Multi-agent support: message is identified by message_id AND agent_id
        if (payload.agent_name && item.agent_id && item.agent_id !== payload.agent_name) {
            return false;
        }
        return item.id === payload.message_id;
    });

    if (messageIdx === -1) {
        messageIdx = newMessages.length;
        // Use role from payload if available (for multi-device sync)
        const role = payload.role || 'assistant';
        const sender = payload.sender || (role === 'user' ? 'user' : 'assistant');
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
        };
        // For user messages from other devices, we're done - don't accumulate
        if (role === 'user') {
            return newMessages;
        }
    }

    // For ANY user message (new or existing), don't do text accumulation
    // User messages arrive complete in a single frame, not streamed
    const messageRole = payload.role || newMessages[messageIdx]?.role;
    if (messageRole === 'user') {
        // User messages don't stream - they're complete
        // Just update text if needed and return
        if (payload.message && newMessages[messageIdx]) {
            newMessages[messageIdx] = {
                ...newMessages[messageIdx],
                text: payload.message, // Replace, don't append
            };
        }
        return newMessages;
    }

    // Dispatch to handler for assistant messages
    return dispatchPayload(payload, newMessages, messageIdx);
}
