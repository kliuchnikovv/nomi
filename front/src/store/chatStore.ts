import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Message, ContentPart } from '../screens/main/models';
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
          
            clearChat: (chatId) => {
                set((state) => {
                    const newChats = { ...state.chats };
                    delete newChats[chatId];
                    return { chats: newChats };
                });
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

// Pure function extracted from ChatContext to handle message accumulation
function onReceivedMessage(payload: any, prevMessages: Message[], activeChatID: string): Message[] {
    let newMessages: Message[] = [...prevMessages];

    const messageID = payload.message_id;
    if (!messageID) {
        // console.error(`Frame got no message_id`, payload);
        return newMessages;
    }

    // Check if message already exists (deduplication for optimistic updates)
    const existingMessage = newMessages.find(m => m.id === messageID);

    // For user messages: if already exists with same text, skip (optimistic duplicate)
    if (existingMessage && existingMessage.role === 'user') {
        // console.log('Dedup: skipping duplicate user message', messageID);
        return prevMessages; // Return unchanged
    }

    let messageIdx = newMessages.findIndex((item) => {
        return item.id === payload.message_id;
    });

    if (messageIdx === -1) {
        messageIdx = newMessages.length;
        // Use role from payload if available (for multi-device sync)
        const role = payload.role || 'assistant';
        const sender = payload.sender || (role === 'user' ? 'user' : 'assistant');
        // console.log('[DEBUG] New message received:', {
        //     messageID,
        //     payloadRole: payload.role,
        //     resolvedRole: role,
        //     payloadSender: payload.sender,
        //     message: payload.message?.substring(0, 50),
        // });
        newMessages[messageIdx] = {
            id: messageID,
            chat_id: activeChatID,
            sender: sender,
            role: role,
            // Initialize with a space for assistant to ensure GiftedChat renders the bubble immediately
            // This allows content_parts (thinking, tools) to be visible even before text arrives
            text: role === 'user' ? (payload.message || "") : " ",
            created_at: Date.now(),
            content_parts: role === 'user' ? undefined : [], // Initialize content_parts for assistant
        };
        // For user messages from other devices, we're done - don't accumulate
        if (role === 'user') {
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

    if (payload.type === 'actions') {
        // Handle D&D action buttons from suggest_actions tool
        const actions = payload.actions || [];
        // console.log('[ChatContext] Received actions frame:', actions);
        if (actions.length > 0) {
            // Set actions on the message for button rendering
            newMessages[messageIdx] = {
                ...newMessages[messageIdx],
                actions: actions.map((a: any) => ({
                    ...a,
                    message_id: payload.message_id
                })),
            };
            // console.log('[ChatContext] Set actions on message:', newMessages[messageIdx].actions);
        }
        return newMessages;
    }

    // Only accumulate text for assistant messages (streaming)
    if (!payload.eof) {
        const existingParts = newMessages[messageIdx].content_parts || [];
        let updatedParts = [...existingParts];

        // Handle streaming tool call
        if (payload.type === 'tool_call' && payload.tool) {
            updatedParts.push({ type: 'tool_call', tool_call: payload.tool });

            // Also update top-level tool_calls array for backward compatibility
            const currentToolCalls = newMessages[messageIdx].tool_calls || [];
            newMessages[messageIdx] = {
                ...newMessages[messageIdx],
                content_parts: updatedParts,
                tool_calls: [...currentToolCalls, payload.tool]
            };
        } else if (payload.type === 'member_response') {
            // Handle team member agent response - accumulate into collapsible part
            const memberText = payload.message || '';
            const agentName = payload.agent_name || 'Member';

            if (memberText) {
                // Check if last part is from the same member agent
                const lastPart = updatedParts.length > 0 ? updatedParts[updatedParts.length - 1] : null;
                if (lastPart && (lastPart as any).type === 'member_response' && (lastPart as any).agent_name === agentName) {
                    // Append to existing member response
                    updatedParts[updatedParts.length - 1] = {
                        type: 'member_response',
                        agent_name: agentName,
                        text: (lastPart as any).text + memberText
                    } as any;
                } else {
                    // Create new member response part
                    updatedParts.push({ type: 'member_response', agent_name: agentName, text: memberText } as any);
                }

                newMessages[messageIdx] = {
                    ...newMessages[messageIdx],
                    // Don't add memberText to main text - it goes to content_parts only
                    content_parts: updatedParts,
                };
            }
        } else if (payload.type === 'reasoning') {
            // Handle reasoning/thinking content from native Gemini thinking
            const reasoningText = payload.content || payload.message || '';
            if (reasoningText) {
                // Append to last reasoning part or create new one
                if (updatedParts.length > 0 && updatedParts[updatedParts.length - 1].type === 'reasoning') {
                    const lastPart = updatedParts[updatedParts.length - 1] as { type: 'reasoning', reasoning: string };
                    updatedParts[updatedParts.length - 1] = { type: 'reasoning', reasoning: lastPart.reasoning + reasoningText };
                } else {
                    updatedParts.push({ type: 'reasoning', reasoning: reasoningText });
                }

                // Also update reasoning_steps array
                const currentSteps = newMessages[messageIdx].reasoning_steps || [];
                const updatedSteps = [...currentSteps];
                if (updatedSteps.length > 0) {
                    updatedSteps[updatedSteps.length - 1] += reasoningText;
                } else {
                    updatedSteps.push(reasoningText);
                }

                newMessages[messageIdx] = {
                    ...newMessages[messageIdx],
                    content_parts: updatedParts,
                    reasoning_steps: updatedSteps,
                };
                // console.log('[ChatContext] Received reasoning:', reasoningText.substring(0, 50) + '...');
            }
        } else if (payload.type === 'client_action') {
             // Handle client-side action delegation
             // The Store handles data; execution happens elsewhere (e.g. socket listener).
             // However, we should record that it happened?
             // For now, mirroring ChatContext, we add a tool_call part.
             const { tool, method, params } = payload;

             updatedParts.push({
                type: 'tool_call',
                tool_call: {
                    name: `${tool}:${method}`,
                    arguments: params,
                    result: "Executed on client"
                }
            });
            newMessages[messageIdx] = {
                ...newMessages[messageIdx],
                content_parts: updatedParts
            };
        } else {
            const newText = payload.message || '';
            if (newText) {
                updatedParts.push({ type: 'text', text: newText });

                // Append text to main message text for backward compatibility
                newMessages[messageIdx] = {
                    ...newMessages[messageIdx],
                    text: (newMessages[messageIdx].text === " " ? "" : newMessages[messageIdx].text) + newText,
                    content_parts: updatedParts,
                };
            }
        }
    }
    // Handle metadata updates (e.g. usage)
    else if (payload.type === 'usage') {
        newMessages[messageIdx] = {
            ...newMessages[messageIdx],
            metadata: {
                ...newMessages[messageIdx].metadata,
                usage: {
                    prompt_tokens: payload.prompt_tokens,
                    completion_tokens: payload.completion_tokens,
                    elapsed_ms: payload.elapsed_ms
                }
            }
        };
    }
    // Handle chat title updates? (Usually in 'meta' op, not message payload)

    return newMessages;
}
