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
    setMessages: (chatId: string, messages: Message[]) => void;
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
            addMessage: (chatId, message) => {
                set((state) => {
                    const currentMessages = state.messages[chatId] || [];
                    // Deduplication based on id
                    const exists = currentMessages.some(m => m.id === message.id);
                    if (exists) {
                        return state;
                    }
                    // Append to the end (chronological order)
                    return {
                        messages: {
                            ...state.messages,
                            [chatId]: [...currentMessages, message]
                        }
                    };
                });
            },

            setMessages: (chatId, newMessages) => {
                set((state) => ({
                    messages: {
                        ...state.messages,
                        [chatId]: newMessages
                    }
                }));
            },

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
            name: 'chat-storage',
            storage: createJSONStorage(() => AsyncStorage),
        }
    )
);
