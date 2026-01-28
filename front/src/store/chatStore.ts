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
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chatStore.ts:36',message:'addMessage called',data:{chatId,payloadType:payload?.type,messageId:payload?.message_id,role:payload?.role},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'H'})}).catch(()=>{});
                // #endregion
                set((state) => {
                    const currentMessages = state.chats[chatId] || [];
                    const newMessages = onReceivedMessage(payload, currentMessages, chatId);

                    if (newMessages === currentMessages) {
                        // #region agent log
                        fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chatStore.ts:41',message:'messages unchanged',data:{chatId,currentCount:currentMessages.length},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'H'})}).catch(()=>{});
                        // #endregion
                        return state;
                    }

                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chatStore.ts:48',message:'messages updated',data:{chatId,oldCount:currentMessages.length,newCount:newMessages.length},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'H'})}).catch(()=>{});
                    // #endregion
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
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chatStore.ts:62',message:'onReceivedMessage called',data:{messageId:payload?.message_id,payloadType:payload?.type,role:payload?.role,prevCount:prevMessages.length},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'H'})}).catch(()=>{});
    // #endregion
    let newMessages: Message[] = [...prevMessages];

    const messageID = payload.message_id;
    if (!messageID) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chatStore.ts:66',message:'no message_id in payload',data:{payloadType:payload?.type},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'H'})}).catch(()=>{});
        // #endregion
        // console.error(`Frame got no message_id`, payload);
        return newMessages;
    }

    // Check if message already exists (deduplication for optimistic updates)
    const existingMessage = newMessages.find(m => m.id === messageID);

    // For user messages: if already exists with same text, skip (optimistic duplicate)
    if (existingMessage && existingMessage.role === 'user') {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chatStore.ts:72',message:'duplicate user message detected',data:{messageId:messageID,existingRole:existingMessage.role,payloadRole:payload.role},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'H'})}).catch(()=>{});
        // #endregion
        // console.log('Dedup: skipping duplicate user message', messageID);
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
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chatStore.ts:88',message:'creating new message',data:{messageId:messageID,role,sender,payloadRole:payload.role,payloadSender:payload.sender},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'H'})}).catch(()=>{});
        // #endregion
        
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
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'chatStore.ts:106',message:'user message from other device',data:{messageId:messageID},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'H'})}).catch(()=>{});
            // #endregion
            // console.log('Received user message from other device', messageID);
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
