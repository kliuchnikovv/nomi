import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Message } from '../screens/main/models';

interface ChatStoreState {
    messages: Record<string, Message[]>;
    outbox: {
        message: Message;
        payload: any; // The WebSocket frame payload
    }[];
    addMessage: (chatId: string, message: Message) => void;
    updateMessageStatus: (messageId: string, status: 'pending' | 'sent' | 'error') => void;
    addToOutbox: (message: Message, payload: any) => void;
    removeFromOutbox: (messageId: string) => void;
    clearOutbox: () => void;
}

export const useChatStore = create<ChatStoreState>()(
    persist(
        (set, get) => ({
            messages: {},
            outbox: [],
            addMessage: (chatId, message) => set((state) => {
                const chatMessages = state.messages[chatId] || [];
                // Check if message already exists
                if (chatMessages.some(m => m.id === message.id)) {
                    return state;
                }
                return {
                    messages: {
                        ...state.messages,
                        [chatId]: [...chatMessages, message],
                    },
                };
            }),
            updateMessageStatus: (messageId, status) => set((state) => {
                const newMessages = { ...state.messages };
                let updated = false;

                for (const chatId in newMessages) {
                    const idx = newMessages[chatId].findIndex(m => m.id === messageId);
                    if (idx !== -1) {
                        newMessages[chatId][idx] = {
                            ...newMessages[chatId][idx],
                            status: status,
                        };
                        updated = true;
                        break; // Message found, assuming ID is unique globally
                    }
                }

                if (!updated) return state;
                return { messages: newMessages };
            }),
            addToOutbox: (message, payload) => set((state) => ({
                outbox: [...state.outbox, { message, payload }],
            })),
            removeFromOutbox: (messageId) => set((state) => ({
                outbox: state.outbox.filter(item => item.message.id !== messageId),
            })),
            clearOutbox: () => set({ outbox: [] }),
        }),
        {
            name: 'chat-store',
            storage: createJSONStorage(() => AsyncStorage),
        }
    )
);
