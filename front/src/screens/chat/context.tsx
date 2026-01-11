import { Frame, Message } from '../main/models';
import { apiClient } from '../../apiClient';
import React, {
    createContext,
    useContext,
    useEffect,
    useRef,
    useState,
    useCallback,
} from 'react';
import { ChatContextType, Props, Model, DetailLevel } from './models';
import { useAuth } from '../auth/context.tsx';
import { socket } from '../../socket';
import { getApiUrl } from '../../config.ts';
import { modelsApi, sidebarApi } from '../../apiClient';
import { AVAILABLE_TEAMS } from './teams';
import { useMain } from '../main/context';
import { useConnectors } from '../settings/connectors/context';
import { useChatStore } from '../../store/chatStore';
import { AppState, AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

function generateUUID() {
    // RFC4122 version 4 compliant enough for client-side ids
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

const emptyChatID = '00000000-0000-0000-0000-000000000000';

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function useChat() {
    const context = useContext(ChatContext);
    if (!context) {
        throw new Error('useChat must be used within a ChatProvider');
    }
    return context;
}

export function ChatProvider({
    children,
    activeChatID,
    setActiveChatID,
}: Props) {
    // 1. Subscribe to Store instead of local state
    // Use selector to avoid re-renders on other chats changes
    const [pluginThreadMeta, setPluginThreadMeta] = useState<{ provider: string; chatId: string | number; integrationId?: string; integrationName?: string | null } | null>(null);

    // Select messages based on mode
    const chatKey = pluginThreadMeta ? `plugin_${pluginThreadMeta.provider}_${pluginThreadMeta.chatId}` : activeChatID;
    const messages = useChatStore(state => state.messages[chatKey] || []);

    // const [messages, setMessages] = useState<Message[]>([]);
    const [messagesLoading, setMessagesLoading] = useState(false);
    const { tools } = useConnectors();
    const [externalTitle, setExternalTitle] = useState<string | null>(null);
    const seededChatRef = useRef<string | null>(null);
    const newChatInitializedRef = useRef<boolean>(false);
    const mapPluginMessage = useCallback((msg: any, provider: string, fallbackRole: 'assistant' | 'user' = 'assistant'): Message => {
        const roleFromMsg = msg.role
            || (msg.sender && msg.sender !== provider ? 'user' : undefined)
            || (msg.metadata?.from === 'user' ? 'user' : undefined)
            || fallbackRole;
        const normalizedRole = roleFromMsg === 'daemon' ? 'assistant' : roleFromMsg;
        return {
            id: msg.id || `plugin-${Date.now()}`,
            chat_id: String(pluginThreadMeta?.chatId ?? msg.thread_id ?? msg.chat_id ?? ''),
            sender: msg.sender || provider,
            role: normalizedRole,
            text: msg.summary || msg.content || msg.title || '',
            created_at: msg.received_at ? new Date(msg.received_at).getTime() : Date.now(),
            actions: msg.actions,
            importance: msg.importance,
            metadata: {
                ...(msg.metadata || {}),
                originalRole: msg.role || roleFromMsg,
                title: msg.title,
                integrationId: msg.integration_id || pluginThreadMeta?.integrationId,
                integrationName: pluginThreadMeta?.integrationName,
                threadId: msg.thread_id,
            },
        };
    }, [pluginThreadMeta?.chatId, pluginThreadMeta?.integrationId, pluginThreadMeta?.integrationName]);

    const [currentMessageID, setCurrentMessageID] = useState<string | null>(null);
    const [assistantWorking, setAssistantWorking] = useState<boolean>(false);
    const [chatMode, setChatMode] = useState<'agent' | 'team'>('agent');
    const [teamCommand, setTeamCommand] = useState<any>(null);

    // Model selection state
    const [selectedModel, setSelectedModelInternal] = useState<string | null>('gemini-2.0-flash-exp');
    const selectedModelRef = useRef<string | null>('gemini-2.0-flash-exp');
    const manualModelSelectionRef = useRef<boolean>(false);

    const setSelectedModel = useCallback((model: string, isManual: boolean = true) => {
        console.log('setSelectedModel called with:', model, 'isManual:', isManual);
        setSelectedModelInternal(model);
        selectedModelRef.current = model;
        if (isManual) {
            manualModelSelectionRef.current = true;
        }

        // Notify WebSocket about model change if connection is active
        if (activeChatID) {
            console.log('Notifying WebSocket about model change to:', model);
            socket.changeModel(activeChatID, model);
        }
    }, [activeChatID]);
    const [availableModels, setAvailableModels] = useState<Model[]>([]);

    // Error state management
    const [error, setError] = useState<string | null>(null);
    const [lastFailedMessage, setLastFailedMessage] = useState<{
        text: string;
        attachments?: any[];
        messageId?: string;
        webSearch?: boolean;
        thinking?: string;
    } | null>(null);

    // Thinking mode state (persists within chat session)
    const [thinkingLevel, setThinkingLevel] = useState<string>('off');

    // Display settings (persists within chat session)
    const [showToolCalls, setShowToolCalls] = useState<boolean>(false);
    const [showReasoning, setShowReasoning] = useState<boolean>(false);
    const [showMemberResponses, setShowMemberResponses] = useState<boolean>(false);
    const [detailLevel, setDetailLevelInternal] = useState<DetailLevel>('hide');

    const setDetailLevel = useCallback((level: DetailLevel) => {
        setDetailLevelInternal(level);
        switch (level) {
            case 'hide':
                setShowToolCalls(false);
                setShowReasoning(false);
                setShowMemberResponses(false);
                break;
            case 'tool_calls':
                setShowToolCalls(true);
                setShowReasoning(false);
                setShowMemberResponses(false);
                break;
            case 'think':
                setShowToolCalls(false);
                setShowReasoning(true);
                setShowMemberResponses(false);
                break;
            case 'all':
                setShowToolCalls(true);
                setShowReasoning(true);
                setShowMemberResponses(true);
                break;
        }
    }, []);

    const { user, token, refreshToken } = useAuth();
    const { activeChat, pendingChatMode, clearPendingChatMode, sidebarFilter } = useMain();

    const [selectedTeamId, setSelectedTeamId] = useState<string | null>(AVAILABLE_TEAMS[0].id);

    const selectTeam = useCallback((teamId: string) => {
        setSelectedTeamId(teamId);
    }, []);


    // Keep getMessages for initial load and manual refresh if needed
    const getMessages = useCallback(async (chatID: string) => {
        if (!chatID || chatID === emptyChatID) return;
        setMessagesLoading(true);
        try {
            // First check local store if needed, or sync with it?
            // For now, fetch from API and update local store to keep sync
            const data = await apiClient.get<Message[]>(
                `${getApiUrl()}/chats/${chatID}/messages`,
            );
            if (!data) {
                return;
            }

            // setMessages(data); // Removed local state set

            // Update Store (Sync Source of Truth)
            const store = useChatStore.getState();
            data.forEach(m => store.addMessage(chatID, m));

            // Sync model from last assistant message or any message that has a model field
            if (!manualModelSelectionRef.current && data.length > 0) {
                // Find the last message that has a model defined
                let lastModel = null;
                for (let i = data.length - 1; i >= 0; i--) {
                    if (data[i].model) {
                        lastModel = data[i].model;
                        break;
                    }
                }

                if (lastModel) {
                    console.log('Syncing model from history:', lastModel);
                    setSelectedModel(lastModel, false);
                } else {
                    console.log('No model found in history, resetting to default');
                    setSelectedModel('gemini-2.0-flash-exp', false);
                }
            }

        } catch (error) {
            console.error(
                `Failed to fetch messages for chat ${chatID}:`,
                error,
            );
        } finally {
            setMessagesLoading(false);
        }
    }, [setSelectedModel, setMessagesToStore]);


    // Define createChat early so sendStreamingMessage can use it
    const createChat = useCallback(async (title: string) => {
        let chatID: string;

        try {
            const created = await apiClient.post<{ id: string }>(
                `${getApiUrl()}/chats`,
                {
                    "title": title,
                    "model": selectedModelRef.current || 'gemini-2.0-flash-exp',
                    "mode": chatMode,
                    "team_id": chatMode === 'team' ? selectedTeamId : null,
                    "project_id": activeChat?.project_id,
                    "task_id": activeChat?.task_id,
                },
            );
            if (created?.id) {
                chatID = created.id;
                setActiveChatID(created.id);
            } else {
                console.error('Chat create returned no id', created);
                return;
            }
        } catch (e) {
            console.error('Failed to create chat before sending:', e);
            return;
        }

        return chatID;
    }, [chatMode, selectedTeamId, setActiveChatID, activeChat]);

    // Define createMessage early so sendStreamingMessage can use it
    const createMessage = useCallback(async (text: string, chatID: string, attachmentIDs?: string[], webSearch?: boolean, role: string = 'user') => {
        let messageID: string;

        try {
            const model = selectedModelRef.current;
            const created = await apiClient.post<{ id: string }>(
                `${getApiUrl()}/chats/${chatID}/messages`,
                {
                    chat_id: chatID,
                    role: role,
                    text: text,
                    model: model,
                    attachment_ids: attachmentIDs,
                    web_search: webSearch,
                },
            );
            if (created?.id) {
                messageID = created.id;
                setCurrentMessageID(created.id);
            } else {
                console.error('Message create returned no id', created);
                return;
            }
        } catch (e) {
            console.error('Failed to create message before sending:', e);
            return;
        }

        return messageID;
    }, []);

    // We need to update how `messages` is selected to support plugins
    const messagesSelector = useCallback((state: any) => {
        if (pluginThreadMeta) {
            const pluginChatKey = `plugin_${pluginThreadMeta.provider}_${pluginThreadMeta.chatId}`;
            return state.chats[pluginChatKey] || [];
        }
        return activeChatID ? state.chats[activeChatID] || [] : [];
    }, [activeChatID, pluginThreadMeta]);

    const storeMessages = useChatStore(messagesSelector);

    const sendStreamingMessage = useCallback(
        async (text: string, attachments: any[] = [], webSearch?: boolean, thinking?: string, reuseMessageId?: string, role: string = 'user') => {
            if (!text.trim() && attachments.length === 0) return;
            if (!user?.id) return;

            setError(null);

            const attachmentIDs = attachments.map(a => a.id);
            const modelAttachments = attachments.map(a => ({
                id: a.id,
                file_name: a.name,
                file_type: a.mimeType,
                size: 0,
                uri: a.uri
            }));

            setLastFailedMessage({
                text: text.trim(),
                attachments: attachments,
                messageId: reuseMessageId,
                webSearch,
                thinking
            });

            let chatIdToUse = activeChatID;
            let messageID: string | undefined = reuseMessageId;
            const timestamp = Date.now();

            if (pluginThreadMeta) {
                // Plugin mode
                chatIdToUse = `plugin_${pluginThreadMeta.provider}_${pluginThreadMeta.chatId}`;
                // We don't really support sending to plugin via socket yet?
                // Previous code: "We rely on WebSocket to handle the message." for plugin?
                // Actually `socket.sendMessage` takes `chat_id`.
                // If the backend doesn't know about this synthetic ID, it won't work.
                // The previous code used `chatIdToUse = String(pluginThreadMeta.chatId)` which is the REAL ID on the provider?
                // Yes. But `socket` needs to route it.
                // If I use the real ID, the response will come back with that ID.
                // So my store needs to index by that ID.
                chatIdToUse = String(pluginThreadMeta.chatId);
            } else {
                if (!chatIdToUse || chatIdToUse === emptyChatID) {
                    chatIdToUse = await createChat(text) || activeChatID;
                }

                if (!chatIdToUse) {
                    console.error('Failed to resolve chat id before sending message');
                    setError('Не удалось создать чат');
                    return;
                }

                if (!reuseMessageId) {
                    messageID = await createMessage(text, chatIdToUse, attachmentIDs, webSearch, role);
                    if (!messageID) {
                        console.error('Failed to create message before sending via WebSocket');
                        setError('Не удалось создать сообщение');
                        return;
                    }
                    setCurrentMessageID(messageID!);
                    setLastFailedMessage(prev => prev ? { ...prev, messageId: messageID } : null);

                    const userMessage: Message = {
                        id: messageID!,
                        chat_id: chatIdToUse!,
                        sender: user.id,
                        role: role,
                        text: text.trim(),
                        created_at: timestamp,
                        attachments: modelAttachments,
                    };

                    // Update Store
                    useChatStore.getState().addMessage(chatIdToUse, {
                        message_id: messageID,
                        role: role,
                        message: text.trim(),
                        sender: user.id,
                        // eof: true // user message is complete
                    });
                } else {
                    console.log('Reusing existing message ID for retry:', reuseMessageId);
                    setCurrentMessageID(reuseMessageId);
                }
            }

            const sessionId = `sess_${timestamp}`;

            setAssistantWorking(true);

            // Use Global Socket
            if (!chatIdToUse || !messageID) {
                setAssistantWorking(false);
                setError('Ошибка отправки сообщения');
                return;
            }

            socket.sendMessage(
                text.trim(),
                chatIdToUse,
                sessionId,
                messageID,
                attachmentIDs,
                webSearch,
                thinking,
                role,
                selectedModelRef.current || undefined
            );
        },
        [activeChatID, user?.id, pluginThreadMeta, createChat, createMessage, setLastFailedMessage],
    );

    const sendMessage = useCallback(
        async (text: string, attachments: any[] = [], webSearch?: boolean, thinking?: string, role: string = 'user') => {
            await sendStreamingMessage(text, attachments, webSearch, thinking, undefined, role);
        },
        [sendStreamingMessage],
    );

    const retryLastMessage = useCallback(() => {
        if (lastFailedMessage) {
            setError(null);
            sendStreamingMessage(
                lastFailedMessage.text,
                lastFailedMessage.attachments,
                lastFailedMessage.webSearch,
                lastFailedMessage.thinking,
                lastFailedMessage.messageId // reusing the message ID!
            );
        }
    }, [lastFailedMessage, sendStreamingMessage]);

    // Fetch messages when activeChatID changes
    useEffect(() => {
        // In plugin mode we keep activeChatID as placeholder; skip resetting state
        if (pluginThreadMeta && activeChatID === emptyChatID) {
            return;
        }
        // If this chat was just seeded, skip fetching to preserve seed messages
        if (seededChatRef.current && seededChatRef.current === activeChatID) {
            seededChatRef.current = null;
            return;
        }
        // Leaving plugin thread when user selects a real chat
        if (pluginThreadMeta) {
            setPluginThreadMeta(null);
        }
        setExternalTitle(null);
        setError(null); // Clear error on chat switch
        // Reset manual selection flag when switching chats
        manualModelSelectionRef.current = false;

        // Sync mode from active chat or pending state
        if (activeChatID === emptyChatID) {
            // If we already initialized this new chat session and no new pending mode is provided, skip
            if (newChatInitializedRef.current && !pendingChatMode) {
                return;
            }

            let modeToUse: 'agent' | 'team';
            let teamIdToUse: string | null = null;

            if (pendingChatMode) {
                modeToUse = pendingChatMode.mode;
                teamIdToUse = pendingChatMode.teamId;
                clearPendingChatMode?.();
            } else {
                modeToUse = (sidebarFilter === 'all' || sidebarFilter === 'agent' ? 'agent' : 'team');
                teamIdToUse = (modeToUse === 'team' ? sidebarFilter : null);
            }

            setChatMode(modeToUse);
            if (teamIdToUse) {
                selectTeam(teamIdToUse);
            }
            newChatInitializedRef.current = true;
        } else if (activeChat) {
            newChatInitializedRef.current = false;

            // Check for initial message from pendingChatMode if it was just set
            if (pendingChatMode?.initialMessage && activeChatID === activeChat.id) {
                const initialMsg = pendingChatMode.initialMessage;
                // Clear it from state to prevent double-sending
                clearPendingChatMode?.();

                // Send after a short delay to ensure socket initialization
                setTimeout(() => {
                    console.log('Sending initial message for task-linked chat:', initialMsg);
                    sendMessage(initialMsg);
                }, 500);
            }

            // Existing chat - restore mode
            if (activeChat.mode) {
                setChatMode(activeChat.mode);
            } else {
                setChatMode('agent');
            }

            if (activeChat.team_id) {
                selectTeam(activeChat.team_id);
            }
        } else if (!activeChatID) {
            newChatInitializedRef.current = false;
        }

        if (!activeChatID || activeChatID === emptyChatID) {
            // setMessages([]); // Store handles it
            return;
        }
        // Only fetch if empty or user navigation
        // Actually, we should probably fetch to sync with backend?
        if (messages.length === 0) {
            getMessages(activeChatID);
        }
    }, [activeChatID, getMessages, pluginThreadMeta, activeChat, pendingChatMode, sidebarFilter, sendMessage, selectTeam, clearPendingChatMode]);

    // Fetch available models on mount with retry
    useEffect(() => {
        let mounted = true;
        const fetchModels = async (retryCount = 0) => {
            try {
                const models = await modelsApi.getModels();
                if (mounted && models && models.length > 0) {
                    setAvailableModels(models);
                } else if (mounted && retryCount < 3) {
                    console.log(`Fetch models returned empty list, retrying... (${retryCount + 1}/3)`);
                    setTimeout(() => fetchModels(retryCount + 1), 2000 * (retryCount + 1));
                }
            } catch (error) {
                console.error('Failed to fetch models:', error);
                if (mounted && retryCount < 3) {
                    console.log(`Fetch models failed, retrying... (${retryCount + 1}/3)`);
                    setTimeout(() => fetchModels(retryCount + 1), 2000 * (retryCount + 1));
                }
            }
        };
        fetchModels();
        return () => { mounted = false; };
    }, []);


    useEffect(() => {
        if (chatMode !== 'team') return;

        const team = AVAILABLE_TEAMS.find(t => t.id === selectedTeamId) || AVAILABLE_TEAMS[0];
        const baseCommand = team.command;

        const next = {
            ...baseCommand,
            model: selectedModel || baseCommand.model,
            auth_token: token,
            project_id: activeChat?.project_id,
            task_id: activeChat?.task_id,
        };

        setTeamCommand((prev: any) => {
            try {
                if (JSON.stringify(prev) === JSON.stringify(next)) return prev;
            } catch { /* ignore */ }
            return next;
        });
    }, [chatMode, selectedModel, selectedTeamId, token, activeChat]);

    // WebSocket lifecycle is now handled globally in App.tsx
    // But we still want to attach listeners for specific events like Done/Error?
    // The store updates automatically.
    // We can use a side effect to track "assistantWorking".

    useEffect(() => {
        // We set handlers to the global socket to update local state like 'assistantWorking'
        socket.setHandlers({
            onDone: () => {
                setAssistantWorking(false);
            },
            onError: (err: any) => {
                setAssistantWorking(false);
                const message = err?.message || 'Ошибка соединения';
                setError(message);
            },
            onUnauthorized: async () => {
                return await refreshToken();
            },
        });

        // No explicit cleanup to remove handlers for now as they are simple and global-ish.
        // Ideally we should manage multiple listeners.
        // For now, this component is the main consumer.
    }, [refreshToken]);


        return () => {
            console.log('WS cleanup: deps changed', { activeChatID, token: !!token });
            socketRef.current?.close();
            socketRef.current = null;
        };
    }, [activeChatID, token, refreshToken, chatMode, teamCommand, tools]); // Dependencies for WebSocket lifecycle

    // Global Lifecycle & Network Handling
    useEffect(() => {
        // 1. AppState Listener
        const handleAppStateChange = (nextAppState: AppStateStatus) => {
            if (nextAppState === 'active') {
                console.log('[ChatContext] App became active');
                if (socketRef.current) {
                    if (!socketRef.current.isConnected()) {
                         console.log('[ChatContext] Reconnecting socket...');
                         socketRef.current.open();
                    } else {
                         // Even if connected, ensure outbox is processed (maybe previous attempt failed silently)
                         socketRef.current.processOutbox();
                    }
                }
            }
        };
        const sub = AppState.addEventListener('change', handleAppStateChange);

        // 2. NetInfo Listener
        const unsubscribeNet = NetInfo.addEventListener(state => {
            if (state.isConnected && state.isInternetReachable) {
                console.log('[ChatContext] Network became reachable');
                if (socketRef.current) {
                    if (!socketRef.current.isConnected()) {
                        console.log('[ChatContext] Reconnecting socket due to network...');
                        socketRef.current.open();
                    } else {
                        socketRef.current.processOutbox();
                    }
                }
            }
        });

        return () => {
            sub.remove();
            unsubscribeNet();
        };
    }, []);
    const refreshPluginThread = useCallback(async () => {
        if (!pluginThreadMeta) return;
        try {
            const resp = await sidebarApi.getChatMessages(
                pluginThreadMeta.provider,
                pluginThreadMeta.chatId,
                pluginThreadMeta.integrationId,
            );
            const converted = (resp?.messages || []).map(msg => mapPluginMessage(msg, pluginThreadMeta.provider));
            // setMessages(converted);

            const store = useChatStore.getState();
            const key = `plugin_${pluginThreadMeta.provider}_${pluginThreadMeta.chatId}`;
            converted.forEach(m => store.addMessage(key, m));
        } catch (err) {
            console.error('Failed to refresh plugin thread', err);
        }
    }, [pluginThreadMeta, mapPluginMessage]);

    const sendStreamingMessage = useCallback(
        async (text: string, attachments: any[] = [], webSearch?: boolean, thinking?: string, reuseMessageId?: string, role: string = 'user') => {
            if (!text.trim() && attachments.length === 0) return;
            if (!user?.id) return;

            // Clear error when sending a new message
            setError(null);

            // Map local attachments to model Attachment type early for both cases
            const attachmentIDs = attachments.map(a => a.id);
            const modelAttachments = attachments.map(a => ({
                id: a.id,
                file_name: a.name,
                file_type: a.mimeType,
                size: 0, // Unknown size for local
                uri: a.uri
            }));

            // Save for retry with all details, but update messageId later if created
            setLastFailedMessage({
                text: text.trim(),
                attachments: attachments,
                messageId: reuseMessageId, // Will be updated if fresh send
                webSearch,
                thinking
            });

            let chatIdToUse = activeChatID;
            let messageID: string | undefined = reuseMessageId;
            const timestamp = Date.now();

            if (pluginThreadMeta) {
                chatIdToUse = String(pluginThreadMeta.chatId);
                const storeKey = `plugin_${pluginThreadMeta.provider}_${pluginThreadMeta.chatId}`;

                if (!messageID) {
                    messageID = generateUUID();
                }

                if (!reuseMessageId) {
                    const newUserMessage: Message = {
                        id: messageID,
                        chat_id: chatIdToUse,
                        sender: user.id,
                        role: role,
                        text: text.trim(),
                        created_at: timestamp,
                        attachments: modelAttachments,
                    };
                    // setMessages(prev => [...prev, newUserMessage]);
                    useChatStore.getState().addMessage(storeKey, newUserMessage);
                }
                // We do not call sidebarApi.sendChatMessage anymore.
                // We rely on WebSocket to handle the message.
            } else {
                // Если чата ещё нет, создаём его через REST и монтируем id
                if (!chatIdToUse || chatIdToUse === emptyChatID) {
                    chatIdToUse = await createChat(text) || activeChatID;
                }

                if (!chatIdToUse) {
                    console.error('Failed to resolve chat id before sending message');
                    setError('Не удалось создать чат');
                    return;
                }

                if (!reuseMessageId) {
                    // SOCKET-FIRST CHANGE: Generate ID locally and skip createMessage REST call
                    messageID = generateUUID();
                    setCurrentMessageID(messageID!);

                    // Update lastFailedMessage with the real messageID so retry can use it
                    setLastFailedMessage(prev => prev ? { ...prev, messageId: messageID } : null);

                    const userMessage: Message = {
                        id: messageID!,
                        chat_id: chatIdToUse!,
                        sender: user.id,
                        role: role,
                        text: text.trim(),
                        created_at: timestamp,
                        attachments: modelAttachments,
                        status: 'pending', // Pending status
                    };

                    // setMessages(prevMessages => [
                    //     ...prevMessages,
                    //     userMessage,
                    // ]);

                    // Add to Store (Optimistic)
                    useChatStore.getState().addMessage(chatIdToUse, userMessage);

                } else {
                    console.log('Reusing existing message ID for retry:', reuseMessageId);
                    setCurrentMessageID(reuseMessageId);
                }
            }

            const sessionId = `sess_${timestamp}`;
            console.log(
                'sendStreamingMessage: socketRef.current:',
                socketRef.current,
            ); // Add this log
            if (!socketRef.current) {
                if (!chatIdToUse || !messageID) {
                    console.error('Missing chatId or messageId when initializing WebSocket');
                    setError('Ошибка инициализации соединения');
                    return;
                }
                socketRef.current = newWebSocket(token!, chatIdToUse);
            }

            setAssistantWorking(true);
            // Теперь точно есть socketRef; sendMessage положит в outbox и откроет WS
            if (!chatIdToUse || !messageID) {
                console.error('Missing chatId or messageId before sending message via WebSocket');
                setAssistantWorking(false);
                setError('Ошибка отправки сообщения');
                return;
            }
            socketRef.current!.sendMessage(text.trim(), sessionId, messageID, attachmentIDs, webSearch, thinking, role);
            console.log("WebSocket sendStreamingMessage: socketRef.current:", socketRef.current);
        },
        [activeChatID, user?.id, refreshToken, socketRef.current, pluginThreadMeta, mapPluginMessage, refreshPluginThread, token, createChat], // createMessage removed from deps
    ); // Dependencies for sendStreamingMessage

    const executeMessageAction = useCallback(async (action: { command: string; url?: string | null; prompt?: string | null; agent?: string | null }, messageId: string) => {
        if (!pluginThreadMeta) return;
        try {
            await sidebarApi.executeMessageAction(pluginThreadMeta.provider, messageId, {
                command: action.command,
                url: action.url,
                prompt: action.prompt,
                agent: action.agent,
            });
            await refreshPluginThread();
        } catch (err) {
            console.error('Failed to execute plugin action', err);
        }
    }, [pluginThreadMeta, refreshPluginThread]);

    const startPluginThread = useCallback(async ({ provider, chatId, title, integrationId, integrationName, messages: preloadedMessages }: { provider: string; chatId: string | number; title?: string | null; integrationId?: string; integrationName?: string | null; messages?: any[] }) => {
        setPluginThreadMeta({ provider, chatId, integrationId, integrationName });
        setChatMode('agent');
        setTeamCommand(null);
        setExternalTitle(title || null);
        setAssistantWorking(false);
        // setMessages([]); // Store handles
        setActiveChatID(emptyChatID);
        try {
            let incomingMessages: any[] = [];
            if (preloadedMessages && Array.isArray(preloadedMessages)) {
                incomingMessages = preloadedMessages;
            } else {
                const resp = await sidebarApi.getChatMessages(provider, chatId, integrationId);
                incomingMessages = resp?.messages || [];
            }
            const converted = (incomingMessages || []).map(msg => mapPluginMessage(msg, provider));
            // setMessages(converted);

            const store = useChatStore.getState();
            const key = `plugin_${provider}_${chatId}`;
            converted.forEach(m => store.addMessage(key, m));
        } catch (err) {
            console.error('Failed to load plugin chat on start', err);
        }
    }, [setActiveChatID, mapPluginMessage, setChatMode, setTeamCommand, setMessagesToStore]);

    const clearPluginThread = useCallback(() => {
        setPluginThreadMeta(null);
        setExternalTitle(null);
        // setMessages([]);
    }, []);

    const createChat = useCallback(async (title: string) => {
        let chatID: string;

        try {
            const created = await apiClient.post<{ id: string }>(
                `${getApiUrl()}/chats`,
                {
                    "title": title,
                    "model": selectedModelRef.current || 'gemini-2.0-flash-exp',
                    "mode": chatMode,
                    "team_id": chatMode === 'team' ? selectedTeamId : null,
                    "project_id": activeChat?.project_id,
                    "task_id": activeChat?.task_id,
                },
            );
            if (created?.id) {
                chatID = created.id;
                setActiveChatID(created.id);
                // getChats();
            } else {
                console.error('Chat create returned no id', created);
                return;
            }
        } catch (e) {
            console.error('Failed to create chat before sending:', e);
            return;
        }

        return chatID;
    }, [chatMode, selectedTeamId, setActiveChatID]);

    const createMessage = useCallback(async (text: string, chatID: string, attachmentIDs?: string[], webSearch?: boolean, role: string = 'user') => {
        let messageID: string;

        try {
            const model = selectedModelRef.current;
            console.log('Creating message with model:', model);

            const created = await apiClient.post<{ id: string }>(
                `${getApiUrl()}/chats/${chatID}/messages`,
                {
                    chat_id: chatID,
                    role: role,
                    text: text,
                    model: model,
                    attachment_ids: attachmentIDs,
                    web_search: webSearch,
                },
            );
            if (created?.id) {
                messageID = created.id;
                setCurrentMessageID(created.id);
                console.log('messageID:', messageID);
            } else {
                console.error('Message create returned no id', created);
                return;
            }
        } catch (e) {
            console.error('Failed to create message before sending:', e);
            return;
        }

        return messageID;
    }, []);

    const handleClientAction = useCallback(async (payload: any) => {
        console.log('[ChatContext] Handling client action:', payload);
        const { tool, method, params } = payload;

        try {
            const { clientToolExecutor } = await import('../../services/tools/ClientToolExecutor');
            const result = await clientToolExecutor.execute({ tool, method, params });

            console.log('[ChatContext] Action executed, sending result:', result);
            await sendMessage(`[System] Tool ${tool}.${method} Output:\n${result}`, [], false, undefined, 'system');

        } catch (error) {
            console.error('[ChatContext] Action failed:', error);
            await sendMessage(`[System] Tool ${tool}.${method} Failed: ${error}`, [], false, undefined, 'system');
        }
    }, [sendMessage]);

    function newWebSocket(tkn: string, chatID: string) {
        console.log('Creating new WebSocket with model:', selectedModel);
        const sock = new ChatSocket(
            getApiUrl(),
            () => tkn,
            () => pluginThreadMeta ? String(pluginThreadMeta.chatId) : chatID,
            () => currentMessageID,
            () => {
                const model = selectedModelRef.current;
                console.log('getModel() returning:', model);
                return model;
            },
            () => pluginThreadMeta ? 'inbox' : 'chat',
            () => chatMode,
            () => teamCommand,
        )

        sock.setHandlers({
            onMessage: (frame: Frame) => {
                // console.log('onMessage: received message', frame);
                if (frame.payload?.type === 'actions') {
                    console.log('>>> ACTIONS FRAME RECEIVED:', frame.payload);
                }

                // Handle Client Actions (Remote Brain -> Local Hands)
                if (frame.payload?.type === 'client_action') {
                    handleClientAction(frame.payload);
                    return; // Don't add to messages list as a display message
                }

                // setMessages(prevMessages =>
                //    onReceivedMessage(frame, prevMessages)
                // );
                onReceivedMessage(frame);
            },
            onMeta: (frame: Frame) => {
                // console.log('onMeta: received message', frame);
                if (frame.payload?.type === 'chat_update' && frame.payload.message) {
                    console.log('Updating chat title:', frame.payload.message);
                    setExternalTitle(frame.payload.message);
                    return;
                }
                // setMessages(prevMessages => onReceivedMeta(frame, prevMessages));
                onReceivedMeta(frame);
            },
            onDone: (frame: Frame) => {
                console.log(`onDone: received message`, frame);
                setAssistantWorking(false);
                // getMessages();
            },
            onError: (err: any) => {
                console.error('WebSocket error:', err);
                setAssistantWorking(false);
                const message =
                    err?.message ||
                    err?.error?.message ||
                    err?.payload?.message ||
                    err?.payload?.error ||
                    (typeof err === 'string' ? err : null) ||
                    'Ошибка соединения';
                setError(message);
                // alertError(message);
            },
            onUnauthorized: async () => {
                return await refreshToken();
            },
        });

        return sock
    }

    function onReceivedMessage(frame: Frame) {
        const store = useChatStore.getState();
        const chatKey = pluginThreadMeta ? `plugin_${pluginThreadMeta.provider}_${pluginThreadMeta.chatId}` : activeChatID;
        const currentMessages = store.messages[chatKey] || [];

        let newMessages = [...currentMessages];
        const messageID = frame.payload.message_id;
        if (!messageID) return;

        const existingMessage = newMessages.find(m => m.id === messageID);
         if (existingMessage && existingMessage.role === 'user') {
            console.log('Dedup: skipping duplicate user message', messageID);
            return;
        }

        let messageIdx = newMessages.findIndex((item) => {
            return item.id === frame.payload.message_id;
        })

        if (messageIdx === -1) {
             messageIdx = newMessages.length;
             const role = frame.payload.role || 'assistant';
             const sender = frame.payload.sender || (role === 'user' ? 'user' : 'assistant');

             newMessages[messageIdx] = {
                id: messageID,
                chat_id: chatKey,
                sender: sender,
                role: role,
                text: role === 'user' ? (frame.payload.message || "") : " ",
                created_at: Date.now(),
                content_parts: role === 'user' ? undefined : [],
            };
            if (role === 'user') {
                store.addMessage(chatKey, newMessages[messageIdx]);
                return;
            }
        }

         if (frame.payload.role !== 'user' && !frame.payload.eof) {
             const msg = newMessages[messageIdx];
             const existingParts = msg.content_parts || [];
             let updatedParts = [...existingParts];
             let updatedText = msg.text;
             let updatedToolCalls = [...(msg.tool_calls || [])];
             let updatedReasoningSteps = [...(msg.reasoning_steps || [])];

             if (frame.payload.type === 'tool_call' && frame.payload.tool) {
                 updatedParts.push({ type: 'tool_call', tool_call: frame.payload.tool });
                 updatedToolCalls.push(frame.payload.tool);
             } else if (frame.payload.type === 'member_response') {
                 const memberText = frame.payload.message || '';
                 const agentName = frame.payload.agent_name || 'Member';
                 if (memberText) {
                     const lastPart = updatedParts.length > 0 ? updatedParts[updatedParts.length - 1] : null;
                     if (lastPart && (lastPart as any).type === 'member_response' && (lastPart as any).agent_name === agentName) {
                          updatedParts[updatedParts.length - 1] = { ...lastPart, text: (lastPart as any).text + memberText } as any;
                     } else {
                          updatedParts.push({ type: 'member_response', agent_name: agentName, text: memberText } as any);
                     }
                 }
             } else if (frame.payload.type === 'reasoning') {
                  const reasoningText = frame.payload.content || frame.payload.message || '';
                  if (reasoningText) {
                       if (updatedParts.length > 0 && updatedParts[updatedParts.length - 1].type === 'reasoning') {
                           const lastPart = updatedParts[updatedParts.length - 1] as any;
                           updatedParts[updatedParts.length - 1] = { ...lastPart, reasoning: lastPart.reasoning + reasoningText };
                       } else {
                           updatedParts.push({ type: 'reasoning', reasoning: reasoningText });
                       }

                       if (updatedReasoningSteps.length > 0) {
                           updatedReasoningSteps[updatedReasoningSteps.length - 1] += reasoningText;
                       } else {
                           updatedReasoningSteps.push(reasoningText);
                       }
                  }
             } else if (frame.payload.type === 'client_action') {
                  // Client action execution is handled in effect hook, just render here
                  updatedParts.push({
                    type: 'tool_call',
                    tool_call: {
                        name: `${frame.payload.tool}:${frame.payload.method}`,
                        arguments: frame.payload.params,
                        result: "Executed on client"
                    }
                });
             } else {
                 const newText = frame.payload.message || '';
                 if (newText) {
                     updatedParts.push({ type: 'text', text: newText });
                     updatedText = (updatedText === " " ? "" : updatedText) + newText;
                 }
             }

             newMessages[messageIdx] = {
                 ...msg,
                 text: updatedText,
                 content_parts: updatedParts,
                 tool_calls: updatedToolCalls,
                 reasoning_steps: updatedReasoningSteps
             };
         } else {
             setAssistantWorking(false);
         }

         store.addMessage(chatKey, newMessages[messageIdx]);
    }

    function onReceivedMeta(frame: Frame) {
         const store = useChatStore.getState();
         const chatKey = pluginThreadMeta ? `plugin_${pluginThreadMeta.provider}_${pluginThreadMeta.chatId}` : activeChatID;
         const currentMessages = store.messages[chatKey] || [];
         const payload = frame.payload;

         if (!payload.message_id) return;
         const messageIdx = currentMessages.findIndex(m => m.id === payload.message_id);
         if (messageIdx === -1) return;

         const msg = currentMessages[messageIdx];
         let updatedMsg = { ...msg };

         if (payload.type === 'metadata') {
             updatedMsg.model = payload.model || msg.model;
             // Handle tool calls in metadata if necessary (legacy)
         } else if (payload.type === 'usage') {
             updatedMsg.metadata = {
                 ...msg.metadata,
                 usage: {
                        prompt_tokens: payload.prompt_tokens,
                        completion_tokens: payload.completion_tokens,
                        elapsed_ms: payload.elapsed_ms
                    }
             };
         }

         store.addMessage(chatKey, updatedMsg);
    }

    const retryLastMessage = useCallback(() => {
        if (lastFailedMessage) {
            setError(null);
            sendStreamingMessage(
                lastFailedMessage.text,
                lastFailedMessage.attachments,
                lastFailedMessage.webSearch,
                lastFailedMessage.thinking,
                lastFailedMessage.messageId // reusing the message ID!
            );
        }
    }, [lastFailedMessage, sendStreamingMessage]);

    const stopGeneration = useCallback(() => {
        console.log('Stopping generation');
        if (activeChatID) {
            socket.sendStop(activeChatID);
        }
        setAssistantWorking(false);
    }, [activeChatID]);

    const value: ChatContextType = {
        messages: storeMessages, // Use the selected messages
        messagesLoading,
        getMessages,
        sendMessage,
        executeMessageAction,
        assistantWorking,
        externalTitle,
        startPluginThread,
        isPluginThread: !!pluginThreadMeta,
        pluginThreadMeta,
        clearPluginThread,
        selectedModel,
        setSelectedModel,
        availableModels,
        chatMode,
        setChatMode,
        teamCommand,
        setTeamCommand,
        error,
        setError,
        retryLastMessage,
        selectedTeamId,
        selectTeam,
        thinkingLevel,
        setThinkingLevel,
        stopGeneration,
        showToolCalls,
        setShowToolCalls,
        showReasoning,
        setShowReasoning,
        showMemberResponses,
        setShowMemberResponses,
        detailLevel,
        setDetailLevel,
    };


    return (
        <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
    );
}
