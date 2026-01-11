import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChatState, IMessage } from '../types/Model';

export const useChatStore = create<ChatState>()(
    persist(
        (set, get) => ({
            chats: {},

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

            updateMessageStatus: (chatId, msgId, status) => {
                set((state) => {
                    const currentMessages = state.chats[chatId] || [];
                    const updatedMessages = currentMessages.map(msg =>
                        msg._id === msgId ? { ...msg, ...status } : msg
                    );
                    return {
                        chats: {
                            ...state.chats,
                            [chatId]: updatedMessages
                        }
                    };
                });
            }
        }),
        {
            name: 'chat-storage',
            storage: createJSONStorage(() => AsyncStorage),
        }
    )
);
