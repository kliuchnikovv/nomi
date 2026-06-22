import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { startTransition } from 'react';
import { Message, ContentPart, MessageAction } from '../screens/main/models';
import { dispatchPayload } from './handlers';

// Throttling configuration for streaming performance
const STREAM_THROTTLE_MS = 120; // Update UI max ~8 times per second during streaming
const STREAM_FLUSH_THRESHOLD = 100; // Force update every 100 chars even within throttle window

// Memory management: limit how many chats and messages are kept in memory
const MAX_CHATS_IN_MEMORY = 10; // Only keep the N most recently accessed chats in memory
const MAX_MESSAGES_PER_CHAT = 200; // Cap messages per chat to prevent unbounded growth
const MAX_PERSISTED_CHATS = 5; // Only persist the N most recently accessed chats to AsyncStorage
const MAX_PERSISTED_MESSAGES = 50; // Persist fewer messages per chat (rest loaded from server on demand)

interface PendingUpdate {
    payload: any;
    timestamp: number;
}

interface ChatStore {
    chats: Record<string, Message[]>;
    // Ephemeral, non-persisted follow-up suggestion chips keyed by chatId.
    followUps: Record<string, string[]>;
    setFollowUps: (chatId: string, items: string[]) => void;
    clearFollowUps: (chatId: string) => void;
    addMessage: (chatId: string, payload: any) => void;
    setMessages: (chatId: string, messages: Message[]) => void;
    mergeMessages: (chatId: string, incoming: Message[]) => void;
    removeMessage: (chatId: string, messageId: string) => void;
    clearChat: (chatId: string) => void;
    flushPendingUpdates: (chatId: string) => void;
    appendActions: (
        chatId: string,
        messageId: string,
        actions: MessageAction[],
    ) => void;
    setMessageStatus: (
        chatId: string,
        messageId: string,
        status: NonNullable<Message['status']>,
    ) => void;
    getLastMessage: (chatId: string) => Message | undefined;
    // Upserts an in-chat background-task progress card from a task_progress
    // signal frame (or a seeded snapshot). Keyed by task_id, not message_id.
    upsertTaskProgress: (chatId: string, payload: any) => void;
}

// Throttling state (outside store to avoid re-renders)
const pendingUpdates = new Map<string, PendingUpdate[]>();
const throttleTimers = new Map<string, ReturnType<typeof setTimeout>>();
const lastFlushTime = new Map<string, number>();

// LRU tracking: ordered list of chatIds, most recently accessed last
const chatAccessOrder: string[] = [];

function touchChatAccess(chatId: string) {
    const idx = chatAccessOrder.indexOf(chatId);
    if (idx !== -1) {
        chatAccessOrder.splice(idx, 1);
    }
    chatAccessOrder.push(chatId);
}

function evictOldChats(
    chats: Record<string, Message[]>,
): Record<string, Message[]> {
    if (chatAccessOrder.length <= MAX_CHATS_IN_MEMORY) {
        return chats;
    }
    const newChats = { ...chats };
    // Evict least recently accessed chats
    while (chatAccessOrder.length > MAX_CHATS_IN_MEMORY) {
        const evictId = chatAccessOrder.shift()!;
        delete newChats[evictId];
        // Also clean up throttling state for evicted chats
        pendingUpdates.delete(evictId);
        const timer = throttleTimers.get(evictId);
        if (timer) {
            clearTimeout(timer);
            throttleTimers.delete(evictId);
        }
        lastFlushTime.delete(evictId);
    }
    return newChats;
}

function trimMessages(messages: Message[], limit: number): Message[] {
    if (messages.length <= limit) {
        return messages;
    }
    // Keep the most recent messages
    return messages.slice(messages.length - limit);
}

// Flush accumulated streaming updates for a chat
function flushPendingUpdates(
    chatId: string,
    set: (
        fn: (state: { chats: Record<string, Message[]> }) => {
            chats: Record<string, Message[]>;
        },
    ) => void,
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
        set(state => {
            let currentMessages = state.chats[chatId] || [];
            let newMessages = currentMessages;

            for (const update of updates) {
                const result = onReceivedMessage(
                    update.payload,
                    newMessages,
                    chatId,
                );
                if (result !== newMessages) {
                    newMessages = result;
                }
            }

            // Only update if there were actual changes
            if (newMessages === currentMessages) {
                return state;
            }

            // Trim messages if they exceed the limit
            newMessages = trimMessages(newMessages, MAX_MESSAGES_PER_CHAT);

            touchChatAccess(chatId);

            return {
                chats: evictOldChats({
                    ...state.chats,
                    [chatId]: newMessages,
                }),
            };
        });
    });
}

export const useChatStore = create<ChatStore>()(
    persist(
        (set, get) => ({
            chats: {},
            followUps: {},

            setFollowUps: (chatId, items) => {
                set(state => ({
                    followUps: {
                        ...state.followUps,
                        [chatId]: items,
                    },
                }));
            },

            clearFollowUps: chatId => {
                set(state => {
                    if (!state.followUps[chatId]?.length) return state;
                    const next = { ...state.followUps };
                    delete next[chatId];
                    return { followUps: next };
                });
            },

            setMessages: (chatId, messages) => {
                // Flush any pending streaming updates before replacing messages
                if (
                    pendingUpdates.has(chatId) &&
                    pendingUpdates.get(chatId)!.length > 0
                ) {
                    flushPendingUpdates(chatId, set);
                }
                touchChatAccess(chatId);
                // Bridge the brief window between the optimistic command_call
                // bubble (pushed locally in runCommand) and the server-persisted
                // row arriving via getMessages refresh. Keep a local bubble only
                // if the incoming list has neither its id NOR a twin row
                // (same name+args, also flagged command_call). Once the server
                // twin shows up the optimistic one is dropped, preventing the
                // doubled-bubble regression.
                const current = get().chats[chatId] ?? [];
                const incomingIds = new Set(messages.map(m => m.id));
                const argsKey = (a: any) => {
                    try {
                        return JSON.stringify(a ?? {});
                    } catch {
                        return '';
                    }
                };
                const hasIncomingTwin = (local: any) => {
                    const lm = local?.meta;
                    if (!lm?.command_call) return false;
                    const lKey = argsKey(lm?.args);
                    return messages.some((srv: any) => {
                        const sm = srv?.meta;
                        return (
                            sm?.command_call === true &&
                            sm?.name === lm?.name &&
                            argsKey(sm?.args) === lKey
                        );
                    });
                };
                const localCommandBubbles = current.filter(
                    m =>
                        (m as any)?.meta?.command_call === true &&
                        !incomingIds.has(m.id) &&
                        !hasIncomingTwin(m),
                );
                let merged = messages;
                if (localCommandBubbles.length > 0) {
                    merged = [...messages, ...localCommandBubbles].sort(
                        (a, b) => (a.created_at ?? 0) - (b.created_at ?? 0),
                    );
                }
                const trimmed = trimMessages(merged, MAX_MESSAGES_PER_CHAT);
                set(state => ({
                    chats: evictOldChats({
                        ...state.chats,
                        [chatId]: trimmed,
                    }),
                }));
            },

            mergeMessages: (chatId, incoming) => {
                if (!incoming || incoming.length === 0) return;
                touchChatAccess(chatId);
                set(state => {
                    const existing = state.chats[chatId] ?? [];
                    const existingIds = new Set(existing.map(m => m.id));
                    const toAdd = incoming.filter(m => !existingIds.has(m.id));
                    if (toAdd.length === 0) return state;
                    // History messages (toAdd) are older — prepend before in-flight existing messages
                    const merged = trimMessages(
                        [...toAdd, ...existing],
                        MAX_MESSAGES_PER_CHAT,
                    );
                    return {
                        chats: evictOldChats({
                            ...state.chats,
                            [chatId]: merged,
                        }),
                    };
                });
            },

            removeMessage: (chatId, messageId) => {
                set(state => {
                    const messages = state.chats[chatId];
                    if (!messages) return state;
                    return {
                        chats: {
                            ...state.chats,
                            [chatId]: messages.filter(m => m.id !== messageId),
                        },
                    };
                });
            },

            clearChat: chatId => {
                // Clear any pending updates for this chat
                pendingUpdates.delete(chatId);
                const existingTimer = throttleTimers.get(chatId);
                if (existingTimer) {
                    clearTimeout(existingTimer);
                    throttleTimers.delete(chatId);
                }
                lastFlushTime.delete(chatId);
                // Remove from LRU tracking
                const lruIdx = chatAccessOrder.indexOf(chatId);
                if (lruIdx !== -1) {
                    chatAccessOrder.splice(lruIdx, 1);
                }

                set(state => {
                    const newChats = { ...state.chats };
                    delete newChats[chatId];
                    return { chats: newChats };
                });
            },

            flushPendingUpdates: chatId => {
                // Manually flush any pending updates for this chat
                if (
                    pendingUpdates.has(chatId) &&
                    pendingUpdates.get(chatId)!.length > 0
                ) {
                    flushPendingUpdates(chatId, set);
                }
            },

            setMessageStatus: (chatId, messageId, status) => {
                set(state => {
                    const msgs = state.chats[chatId];
                    if (!msgs) return state;
                    const idx = msgs.findIndex(m => m.id === messageId);
                    if (idx === -1 || msgs[idx].status === status) return state;
                    const updated = [...msgs];
                    updated[idx] = { ...updated[idx], status };
                    return {
                        chats: {
                            ...state.chats,
                            [chatId]: updated,
                        },
                    };
                });
            },

            getLastMessage: chatId => {
                const msgs = get().chats[chatId];
                if (!msgs || msgs.length === 0) return undefined;
                return msgs[msgs.length - 1];
            },

            appendActions: (chatId, messageId, actions) => {
                if (actions.length === 0) return;
                set(state => {
                    const msgs = state.chats[chatId];
                    if (!msgs) return state;
                    const idx = msgs.findIndex(m => m.id === messageId);
                    if (idx === -1) return state;
                    const updated = [...msgs];
                    updated[idx] = {
                        ...updated[idx],
                        actions: [...(updated[idx].actions ?? []), ...actions],
                    };
                    return {
                        chats: {
                            ...state.chats,
                            [chatId]: updated,
                        },
                    };
                });
            },

            upsertTaskProgress: (chatId, payload) => {
                const taskId = payload?.task_id;
                if (!taskId) return;
                const id = `task_${taskId}`;
                set(state => {
                    const msgs = state.chats[chatId] || [];
                    const idx = msgs.findIndex(m => m.id === id);
                    const prevMeta = idx !== -1 ? msgs[idx].metadata ?? {} : {};

                    const status = payload.status ?? prevMeta.status;

                    // Track the pending approval request id across frames: set it
                    // when an approval_request event arrives, clear it once the
                    // task moves out of waiting_input.
                    let approvalRequestId = prevMeta.approvalRequestId;
                    if (payload.event?.kind === 'approval_request') {
                        approvalRequestId =
                            payload.event.payload?.request_id ??
                            approvalRequestId;
                    }
                    if (status && status !== 'waiting_input') {
                        approvalRequestId = undefined;
                    }

                    // Intermediate frames (e.g. a log event) omit plan/result —
                    // preserve the last known values.
                    const metadata = {
                        ...prevMeta,
                        type: 'task_progress',
                        task_id: taskId,
                        goal: payload.goal ?? prevMeta.goal,
                        status,
                        plan: payload.plan ?? prevMeta.plan ?? null,
                        finished:
                            payload.finished ?? prevMeta.finished ?? false,
                        result: payload.result ?? prevMeta.result,
                        agent: payload.agent ?? prevMeta.agent,
                        approvalRequestId,
                    };

                    if (idx !== -1) {
                        const updated = [...msgs];
                        updated[idx] = { ...updated[idx], metadata };
                        return {
                            chats: { ...state.chats, [chatId]: updated },
                        };
                    }

                    const createdAt =
                        typeof payload.created_at === 'string'
                            ? Date.parse(payload.created_at) || Date.now()
                            : payload.created_at ?? Date.now();
                    const message: Message = {
                        id,
                        chat_id: chatId,
                        sender: 'system',
                        role: 'system',
                        text: '',
                        created_at: createdAt,
                        metadata,
                    };
                    return {
                        chats: { ...state.chats, [chatId]: [...msgs, message] },
                    };
                });
            },

            addMessage: (chatId, payload) => {
                // Check if this is a streaming text chunk that should be throttled
                const isStreamingChunk =
                    payload?.type === 'text' &&
                    payload?.delta &&
                    !payload?.done;

                if (isStreamingChunk) {
                    // Accumulate streaming chunks and throttle updates
                    if (!pendingUpdates.has(chatId)) {
                        pendingUpdates.set(chatId, []);
                    }
                    pendingUpdates.get(chatId)!.push({
                        payload,
                        timestamp: Date.now(),
                    });

                    const now = Date.now();
                    const lastFlush = lastFlushTime.get(chatId) || 0;
                    const timeSinceLastFlush = now - lastFlush;

                    // Calculate accumulated text length since last flush
                    const accumulatedLength = pendingUpdates
                        .get(chatId)!
                        .reduce(
                            (sum, u) => sum + (u.payload.delta?.length || 0),
                            0,
                        );

                    // Flush immediately if:
                    // 1. Enough time has passed since last flush, OR
                    // 2. We've accumulated enough characters
                    if (
                        timeSinceLastFlush >= STREAM_THROTTLE_MS ||
                        accumulatedLength >= STREAM_FLUSH_THRESHOLD
                    ) {
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
                if (
                    pendingUpdates.has(chatId) &&
                    pendingUpdates.get(chatId)!.length > 0
                ) {
                    flushPendingUpdates(chatId, set);
                }

                touchChatAccess(chatId);
                startTransition(() => {
                    set(state => {
                        const currentMessages = state.chats[chatId] || [];
                        let newMessages = onReceivedMessage(
                            payload,
                            currentMessages,
                            chatId,
                        );

                        if (newMessages === currentMessages) {
                            return state;
                        }

                        newMessages = trimMessages(
                            newMessages,
                            MAX_MESSAGES_PER_CHAT,
                        );
                        return {
                            chats: evictOldChats({
                                ...state.chats,
                                [chatId]: newMessages,
                            }),
                        };
                    });
                });
            },
        }),
        {
            name: 'chat-storage',
            storage: createJSONStorage(() => AsyncStorage),
            // Only persist a subset of chats with fewer messages to limit AsyncStorage size
            partialize: state => {
                const recentChatIds = chatAccessOrder.slice(
                    -MAX_PERSISTED_CHATS,
                );
                const persistedChats: Record<string, Message[]> = {};
                for (const chatId of recentChatIds) {
                    const messages = state.chats[chatId];
                    if (messages) {
                        persistedChats[chatId] = trimMessages(
                            messages,
                            MAX_PERSISTED_MESSAGES,
                        );
                    }
                }
                return { chats: persistedChats };
            },
        },
    ),
);

function onReceivedMessage(
    payload: any,
    prevMessages: Message[],
    activeChatID: string,
): Message[] {
    const messageID = payload.message_id;
    if (!messageID) {
        return prevMessages;
    }

    let needsCopy = false;
    let newMessages: Message[] = prevMessages;

    // Check for duplicate user messages without scanning entire array
    let messageIdx = -1;
    for (let i = 0; i < prevMessages.length; i++) {
        const item = prevMessages[i];
        if (item.id !== messageID) continue;
        if (payload.agent_name && item.agent_id) {
            if (
                item.agent_id.toLowerCase() !== payload.agent_name.toLowerCase()
            ) {
                continue;
            }
        }
        messageIdx = i;
        break;
    }

    if (messageIdx !== -1) {
        const existingMessage = prevMessages[messageIdx];

        // For user messages: if already exists, skip (optimistic duplicate)
        if (existingMessage.role === 'user') {
            return prevMessages;
        }

        // For assistant messages, update in place with lazy copy
        const messageRole = payload.role || existingMessage.role;
        if (messageRole === 'user') {
            if (payload.message) {
                if (!needsCopy) {
                    newMessages = [...prevMessages];
                    needsCopy = true;
                }
                newMessages[messageIdx] = {
                    ...newMessages[messageIdx],
                    text: payload.message,
                    context_items: payload.context_items,
                };
            }
            return newMessages;
        }

        // Dispatch to handler for existing assistant messages
        if (!needsCopy) {
            newMessages = [...prevMessages];
            needsCopy = true;
        }
        return dispatchPayload(payload, newMessages, messageIdx);
    }

    // New message
    if (!needsCopy) {
        newMessages = [...prevMessages];
        needsCopy = true;
    }
    const role = payload.role || 'assistant';
    const sender = payload.sender || (role === 'user' ? 'user' : 'assistant');

    // A fresh assistant turn must not inherit the previous turn's throttle window —
    // otherwise the first delta of the second message waits behind a stale
    // STREAM_THROTTLE_MS timer and the placeholder loader never gets a chance to render.
    if (role === 'assistant') {
        lastFlushTime.delete(activeChatID);
        const t = throttleTimers.get(activeChatID);
        if (t) {
            clearTimeout(t);
            throttleTimers.delete(activeChatID);
        }
    }

    // Map proactive_event from WebSocket payload → meta field on Message.
    // Python side (back/src/proactive/judge_worker.py) emits { proactive_event: { event_id, event_type } }.
    const proactiveMeta = payload.proactive_event
        ? {
              source: 'proactive' as const,
              event_id: payload.proactive_event.event_id as string | undefined,
              event_type: payload.proactive_event.event_type as
                  | 'calendar_upcoming'
                  | 'email_new'
                  | 'reminder_due'
                  | 'daily_brief'
                  | 'health_anomaly'
                  | 'watch_reminder'
                  | undefined,
              deep_link: payload.proactive_event.deep_link as
                  | string
                  | undefined,
          }
        : undefined;

    newMessages.push({
        id: messageID,
        chat_id: activeChatID,
        sender: sender,
        role: role,
        agent_id: payload.agent_name,
        text: role === 'user' ? payload.message || '' : ' ',
        created_at: Date.now(),
        content_parts: role === 'user' ? undefined : [],
        attachments: payload.attachments,
        context_items: payload.context_items,
        meta: proactiveMeta,
    });

    if (role === 'user') {
        return newMessages;
    }

    // An assistant turn has begun → the most recent unanswered user message is
    // now answered. Clear its 'pending' status so reconciliation won't resend it.
    for (let i = newMessages.length - 1; i >= 0; i--) {
        if (newMessages[i].role === 'user') {
            if (newMessages[i].status === 'pending') {
                newMessages[i] = { ...newMessages[i], status: 'complete' };
            }
            break;
        }
    }

    return dispatchPayload(payload, newMessages, newMessages.length - 1);
}
