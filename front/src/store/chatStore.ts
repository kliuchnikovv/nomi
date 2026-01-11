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

export const useChatStore = create<ChatState>()(
    persist(
        (set, get) => ({
            chats: {},
            outbox: [],
            addMessage: (chatId, message) => {
                set((state) => {
                    const currentMessages = state.chats[chatId] || [];
                    // Deduplication based on _id
                    const exists = currentMessages.some(m => m._id === message._id);
                    if (exists) {
                        return state;
                    }
                    // Add to beginning (GiftedChat standard) or end?
                    // GiftedChat usually expects newest first (index 0).
                    // Let's assume we append to the list and sorting happens in UI,
                    // OR strictly follow GiftedChat's "inverted" expectation if we want to store it that way.
                    // However, standard store usually just holds the list.
                    // Let's append to the front (newest first) to match common GiftedChat usage if the array is passed directly.
                    return {
                        chats: {
                            ...state.chats,
                            [chatId]: [message, ...currentMessages]
                        }
                    };
                });
            },

            setMessages: (chatId, messages) => {
                set((state) => ({
                    chats: {
                        ...state.chats,
                        [chatId]: messages
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
