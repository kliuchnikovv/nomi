import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Message } from '../screens/main/models';

interface ChatState {
    chats: Record<string, Message[]>; // Key is chat_id
    addMessage: (chatId: string, message: Message) => void;
    setMessages: (chatId: string, messages: Message[]) => void;
    updateMessageStatus: (chatId: string, messageId: string, status: 'pending' | 'sent' | 'error') => void;
    updateMessage: (chatId: string, messageId: string, updates: Partial<Message>) => void;
}

export const useChatStore = create<ChatState>()(
    persist(
        (set, get) => ({
            chats: {},
            addMessage: (chatId, message) => set((state) => {
                const currentMessages = state.chats[chatId] || [];
                // Check if message already exists to avoid duplicates
                const exists = currentMessages.some(m => m.id === message.id);
                if (exists) return state;

                return {
                    chats: {
                        ...state.chats,
                        [chatId]: [...currentMessages, message],
                    },
                };
            }),
            setMessages: (chatId, messages) => set((state) => ({
                chats: {
                    ...state.chats,
                    [chatId]: messages,
                },
            })),
            updateMessageStatus: (chatId, messageId, status) => set((state) => {
                const currentMessages = state.chats[chatId] || [];
                const updatedMessages = currentMessages.map(m => {
                    if (m.id === messageId) {
                        // Assuming the Message type has a pending field or we map 'status' to it
                        // The user requested 'status', but our model has 'pending?: boolean'.
                        // Let's map 'sent' -> pending: false, 'pending' -> pending: true
                        return { ...m, pending: status === 'pending' };
                    }
                    return m;
                });
                return {
                    chats: {
                        ...state.chats,
                        [chatId]: updatedMessages,
                    },
                };
            }),
            updateMessage: (chatId, messageId, updates) => set((state) => {
                const currentMessages = state.chats[chatId] || [];
                const updatedMessages = currentMessages.map(m =>
                    m.id === messageId ? { ...m, ...updates } : m
                );
                return {
                    chats: {
                        ...state.chats,
                        [chatId]: updatedMessages,
                    },
                };
            }),
        }),
        {
            name: 'chat-storage',
            storage: createJSONStorage(() => AsyncStorage),
        }
    )
);
