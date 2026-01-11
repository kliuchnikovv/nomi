import { Frame, Message } from '../main/models';
import { apiClient } from '../../apiClient';
import React, {
    createContext,
    useContext,
    useEffect,
    useRef,
    useState,
    useCallback,
    useMemo
} from 'react';
import { ChatContextType, Props, Model } from './models';
import { useAuth } from '../auth/context.tsx';
import { alertError } from '../auth/models.tsx';
import { ChatSocket } from '../../socket';
import { getApiUrl, API_URL } from '../../config.ts';
import { modelsApi, sidebarApi } from '../../apiClient';
import { AVAILABLE_TEAMS } from './teams';
import { useMain } from '../main/context';
import { gmailClient } from '../../services/integrations/clients/GmailClient';
import { calendarClient } from '../../services/integrations/clients/CalendarClient';
import { useConnectors } from '../settings/connectors/context';
import { v4 as uuidv4 } from 'uuid';
import { useChatStore } from '../../store/chatStore';

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
    const { chats, addMessage, setMessages: setStoreMessages, updateMessageStatus, updateMessage } = useChatStore();

    // Derived state for current chat messages
    const messages = useMemo(() => {
        if (!activeChatID) return [];
        return chats[activeChatID] || [];
    }, [chats, activeChatID]);

    const [messagesLoading, setMessagesLoading] = useState(false);
    const { tools } = useConnectors();
    const [externalTitle, setExternalTitle] = useState<string | null>(null);
    const socketRef = useRef<ChatSocket | null>(null); // Declare socketRef
    const seededChatRef = useRef<string | null>(null);
    const newChatInitializedRef = useRef<boolean>(false);
    const [pluginThreadMeta, setPluginThreadMeta] = useState<{ provider: string; chatId: string | number; integrationId?: string; integrationName?: string | null } | null>(null);
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
    const buildTeamCommand = useCallback((modelId: string | null) => {
        const model = modelId || 'gemini-1.5-pro';
        return {
            name: 'Default Team',
            model,
            participants: [
                { type: 'mailer', model },
                { type: 'rag', model },
                { type: 'memoriser', model },
            ],
        };
    }, []);

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
        if (socketRef.current) {
            console.log('Notifying WebSocket about model change to:', model);
            socketRef.current.changeModel(model);
        }
    }, []);
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
            case 'reasoning_only': // Ensure this matches UI options if present
                setShowReasoning(true);
                setShowToolCalls(false);
                setShowMemberResponses(false);
                break;
        }
    }, []);

    const { user, token, refreshToken } = useAuth(); // Destructure token and refreshToken

    // const API_URL = 'https://genie.com';

    // Keep getMessages for initial load and manual refresh if needed
    const getMessages = useCallback(async (chatID: string) => {
        // If we have persisted messages, don't show loading spinner, just background refresh
        // But for initial implementation, let's keep loading state behavior similar
        setMessagesLoading(true);
        try {
            const data = await apiClient.get<Message[]>(
                `${getApiUrl()}/chats/${chatID}/messages`,
            );
            if (!data) {
                return;
            }

            // setMessages(data);
            setStoreMessages(chatID, data);

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
            // alertError(`Failed to fetch messages for chat: ${error}`);
            console.error(
                `Failed to fetch messages for chat ${chatID}:`,
                error,
            );
        } finally {
            setMessagesLoading(false);
        }
    }, [setSelectedModel, setStoreMessages]);

    const { activeChat, pendingChatMode, clearPendingChatMode, sidebarFilter } = useMain();

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

                // If there's an initial message, we'll send it after the chat is fully switched
                if (pendingChatMode.initialMessage) {
                    const messageToSend = pendingChatMode.initialMessage;
                    const chatIDToSend = activeChatID;
                    // We need a small delay or a way to ensure the chat switch is complete
                    // Actually, if we are at emptyChatID, we are just PREPARING.
                    // The message should be sent when we land on the REAL ID.
                }

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
            // setMessages([]);
            // Don't clear store messages if ID is null, but UI will show empty because messages uses activeChatID
            return;
        }
        getMessages(activeChatID);
    }, [activeChatID, getMessages, pluginThreadMeta, activeChat, pendingChatMode, sidebarFilter]);

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

    const [selectedTeamId, setSelectedTeamId] = useState<string | null>(AVAILABLE_TEAMS[0].id);

    const selectTeam = useCallback((teamId: string) => {
        setSelectedTeamId(teamId);
    }, []);

    useEffect(() => {
        if (chatMode !== 'team') return;

        const team = AVAILABLE_TEAMS.find(t => t.id === selectedTeamId) || AVAILABLE_TEAMS[0];
        const baseCommand = team.command;

        // Apply model override if the team is dynamic or allows it. 
        // For now, let's assume all teams can have their primary model overridden by the UI picker
        // provided the backend team implementation respects it (TravelPlanning/GenieTeam take a 'model' param).
        const next = {
            ...baseCommand,
            model: selectedModel || baseCommand.model,
            auth_token: token,
            project_id: activeChat?.project_id,
            task_id: activeChat?.task_id,
            // For dynamic teams, we might want to update participants' models too, 
            // but let's keep it simple: model picker overrides the main team/conductor model.
        };

        setTeamCommand((prev: any) => {
            try {
                if (JSON.stringify(prev) === JSON.stringify(next)) return prev;
            } catch { /* ignore */ }
            return next;
        });
    }, [chatMode, selectedModel, selectedTeamId, token]);

    useEffect(() => {
        console.log('WebSocket useEffect: activeChatID:', activeChatID);
        console.log(
            'WebSocket useEffect: token:',
            token ? token.substring(0, 10) + '...' : 'null',
        );
        console.log('WebSocket useEffect: condition result:', !token); // Only check for token

        if (!token) {
            // Only check for token
            console.warn(
                'WebSocket useEffect: Returning early due to missing token.',
            );
            socketRef.current?.close();
            socketRef.current = null;
            return;
        }

        // Не открываем сокет, пока у нас placeholder chat_id или в режиме плагина
        if ((!activeChatID || activeChatID === emptyChatID) && !pluginThreadMeta) {
            // console.warn('WebSocket useEffect: Skipping WS init until real chat_id is set');
            socketRef.current?.close();
            socketRef.current = null;
            return;
        }

        if (!socketRef.current) {
            const socketId = Math.random().toString(36).substring(7);
            console.log(`[WS-${socketId}] Creating new ChatSocket. socketRef was null.`);
            socketRef.current = newWebSocket(token, activeChatID);
            (socketRef.current as any).__debugId = socketId;
        } else {
            console.log(`[WS-${(socketRef.current as any).__debugId}] socketRef.current already exists, not creating new.`);
        }

        console.log(`WebSocket useEffect: socket ready`)
        // Send current tools configuration to the backend
        socketRef.current?.sendTools(tools);

        return () => {
            console.log('WS cleanup: deps changed', { activeChatID, token: !!token });
            socketRef.current?.close();
            socketRef.current = null;
        };
    }, [activeChatID, token, refreshToken, chatMode, teamCommand, tools]); // Dependencies for WebSocket lifecycle
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
            // Plugin thread messages are not currently stored in the persisted store (chat_id logic is different)
            // But for now, let's keep plugin messages separate or rethink plugin thread persistence later.
            // Current code used setMessages local state.
            // Since we replaced local state, we need a way to show plugin messages.
            // Hack: we can use a special ID for plugin thread in store, but we need to clear it.
            // Or, keep using setMessages if activeChatID is empty/plugin?
            // The requirement was Global Store for main chat.
            // Let's use setStoreMessages with a special key if plugin?
            // Or just keep using local state for plugins if not required by persistent outbox task?
            // The task is about "chat implementation", usually meaning the main chat.
            // But I removed `const [messages, setMessages] = useState`.
            // So I MUST use the store.

            // If pluginThreadMeta is set, activeChatID is emptyChatID.
            // We can use a key like `plugin:${pluginThreadMeta.chatId}`?
            if (pluginThreadMeta) {
                 const key = `plugin:${pluginThreadMeta.chatId}`;
                 setStoreMessages(key, converted);
                 // And we need to make sure `messages` derived state picks it up.
                 // But `activeChatID` is emptyChatID.
                 // We need to update `messages` useMemo to handle plugin mode.
            }
        } catch (err) {
            console.error('Failed to refresh plugin thread', err);
        }
    }, [pluginThreadMeta, mapPluginMessage, setStoreMessages]);

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
        // setMessages([]);
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
            // Use store for plugin messages too?
            const key = `plugin:${chatId}`;
            setStoreMessages(key, converted);
        } catch (err) {
            console.error('Failed to load plugin chat on start', err);
        }
    }, [setActiveChatID, mapPluginMessage, setChatMode, setTeamCommand, setStoreMessages]);

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
                // Handle plugin mode if needed, for now focusing on main flow
                if (!messageID) {
                    messageID = uuidv4();
                }

                const storeKey = `plugin:${pluginThreadMeta.chatId}`;
                const newUserMessage: Message = {
                    id: messageID,
                    chat_id: chatIdToUse,
                    sender: user.id,
                    role: role,
                    text: text.trim(),
                    created_at: timestamp,
                    attachments: modelAttachments,
                    pending: true,
                };

                addMessage(storeKey, newUserMessage);

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
                    // Generate ID locally for Optimistic UI
                    if (!messageID) {
                         messageID = uuidv4();
                    }

                    // Assign local ID
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
                        pending: true, // Optimistic pending state
                    };

                    // Optimistic update via store
                    addMessage(chatIdToUse!, userMessage);
                } else {
                    console.log('Reusing existing message ID for retry:', reuseMessageId);
                    setCurrentMessageID(reuseMessageId);
                    updateMessageStatus(chatIdToUse!, reuseMessageId, 'pending');
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
        [activeChatID, user?.id, refreshToken, socketRef.current, pluginThreadMeta, mapPluginMessage, refreshPluginThread, token, createChat, createMessage, addMessage, updateMessageStatus],
    );

    const sendMessage = useCallback(
        async (text: string, attachments: any[] = [], webSearch?: boolean, thinking?: string, role: string = 'user') => {
            await sendStreamingMessage(text, attachments, webSearch, thinking, undefined, role);
        },
        [sendStreamingMessage],
    );

    const handleClientAction = useCallback(async (payload: any) => {
        console.log('[ChatContext] Handling client action:', payload);
        console.log('[ChatContext] Raw payload string:', JSON.stringify(payload));
        const { tool, method, params } = payload;

        try {
            const { clientToolExecutor } = await import('../../services/tools/ClientToolExecutor');
            const result = await clientToolExecutor.execute({ tool, method, params });

            console.log('[ChatContext] Action executed, sending result:', result);

            // Send result back to the agent as a system message
            // We use a prefix to help the agent understand it's a tool result
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

                onReceivedMessage(frame);
            },
            onMeta: (frame: Frame) => {
                // console.log('onMeta: received message', frame);
                if (frame.payload?.type === 'chat_update' && frame.payload.message) {
                    console.log('Updating chat title:', frame.payload.message);
                    setExternalTitle(frame.payload.message);
                    return;
                }
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
            onAck: (messageId: string) => {
                // Mark message as not pending
                if (pluginThreadMeta) {
                    updateMessageStatus(`plugin:${pluginThreadMeta.chatId}`, messageId, 'sent');
                } else if (activeChatID) {
                    updateMessageStatus(activeChatID, messageId, 'sent');
                }
            }
        });

        return sock
    }

    function onReceivedMessage(frame: Frame) {
        const messageID = frame.payload.message_id
        if (!messageID) {
            console.error(`Frame got no message_id`, frame)
            return;
        }

        const currentChatID = activeChatID || (pluginThreadMeta ? `plugin:${pluginThreadMeta.chatId}` : null);
        if (!currentChatID) return;

        const currentMessages = useChatStore.getState().chats[currentChatID] || [];
        const existingMessage = currentMessages.find(m => m.id === messageID);

        // For user messages: if already exists with same text, skip (optimistic duplicate)
        if (existingMessage && existingMessage.role === 'user') {
            console.log('Dedup: skipping duplicate user message', messageID);
            return;
        }

        // Helper to update store
        const updateStore = (msg: Message) => {
            if (existingMessage) {
                // Update existing
                // Since updateMessage expects partial, we need to construct it
                // Ideally we shouldn't pass full object if we only update fields
                // But for now replacing works if ID matches
                // Actually `updateMessage` implementation iterates map.
                // Let's use `addMessage` logic which checks exists? No, addMessage ignores if exists.
                // We need to use `updateMessage` for streaming updates.
                useChatStore.getState().updateMessage(currentChatID, messageID, msg);
            } else {
                addMessage(currentChatID, msg);
            }
        };

        let messageIdx = currentMessages.findIndex((item) => {
            return item.id === frame.payload.message_id;
        })

        let newMessage: Message;

        if (messageIdx === -1) {
            // New message
            const role = frame.payload.role || 'assistant';
            const sender = frame.payload.sender || (role === 'user' ? 'user' : 'assistant');

            newMessage = {
                id: messageID,
                chat_id: activeChatID || '', // Assuming frame comes for active chat
                sender: sender,
                role: role,
                text: role === 'user' ? (frame.payload.message || "") : " ",
                created_at: Date.now(),
                content_parts: role === 'user' ? undefined : [],
            };

            if (role === 'user') {
                addMessage(currentChatID, newMessage);
                return;
            }

            // For assistant, add initial placeholder
            addMessage(currentChatID, newMessage);
        } else {
            newMessage = { ...currentMessages[messageIdx] };
        }

        // For ANY user message (new or existing), don't do text accumulation
        const messageRole = frame.payload.role || newMessage.role;
        if (messageRole === 'user') {
            if (frame.payload.message) {
                updateMessage(currentChatID, messageID, { text: frame.payload.message });
            }
            return;
        }

        if (frame.payload.type === 'actions') {
            const actions = frame.payload.actions || [];
            if (actions.length > 0) {
                const mappedActions = actions.map((a: any) => ({
                    ...a,
                    message_id: frame.payload.message_id
                }));
                updateMessage(currentChatID, messageID, { actions: mappedActions });
            }
            return;
        }

        // Only accumulate text for assistant messages (streaming)
        if (!frame.payload.eof) {
            const existingParts = newMessage.content_parts || [];
            let updatedParts = [...existingParts];
            let updatedText = newMessage.text || '';
            let updatedToolCalls = newMessage.tool_calls || [];
            let updatedReasoningSteps = newMessage.reasoning_steps || [];

            // Handle streaming tool call
            if (frame.payload.type === 'tool_call' && frame.payload.tool) {
                updatedParts.push({ type: 'tool_call', tool_call: frame.payload.tool });
                updatedToolCalls = [...updatedToolCalls, frame.payload.tool];
            } else if (frame.payload.type === 'member_response') {
                const memberText = frame.payload.message || '';
                const agentName = frame.payload.agent_name || 'Member';

                if (memberText) {
                    const lastPart = updatedParts.length > 0 ? updatedParts[updatedParts.length - 1] : null;
                    if (lastPart && (lastPart as any).type === 'member_response' && (lastPart as any).agent_name === agentName) {
                        updatedParts[updatedParts.length - 1] = {
                            type: 'member_response',
                            agent_name: agentName,
                            text: (lastPart as any).text + memberText
                        } as any;
                    } else {
                        updatedParts.push({ type: 'member_response', agent_name: agentName, text: memberText } as any);
                    }
                }
            } else if (frame.payload.type === 'reasoning') {
                const reasoningText = frame.payload.content || frame.payload.message || '';
                if (reasoningText) {
                    if (updatedParts.length > 0 && updatedParts[updatedParts.length - 1].type === 'reasoning') {
                        const lastPart = updatedParts[updatedParts.length - 1] as { type: 'reasoning', reasoning: string };
                        updatedParts[updatedParts.length - 1] = { type: 'reasoning', reasoning: lastPart.reasoning + reasoningText };
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
                const { tool, method, params } = frame.payload;
                (async () => {
                    try {
                        const { clientToolExecutor } = await import('../../services/tools/ClientToolExecutor');
                        const result = await clientToolExecutor.execute({ tool, method, params });
                        const responseText = `[System: Tool Result for ${tool}.${method}]\n${result}`;
                        sendMessage(responseText, [], false, false);
                    } catch (error: any) {
                        const errorMessage = `[System: Tool Execution Failed]\nError: ${error.message || String(error)}`;
                        sendMessage(errorMessage, [], false, false);
                    }
                })();

                updatedParts.push({
                    type: 'tool_call',
                    tool_call: {
                        name: `${tool}:${method}`,
                        arguments: params,
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

            updateMessage(currentChatID, messageID, {
                text: updatedText,
                content_parts: updatedParts,
                tool_calls: updatedToolCalls,
                reasoning_steps: updatedReasoningSteps
            });
        } else {
            setAssistantWorking(false);
        }
    }

    function onReceivedMeta(frame: Frame) {
        const payload = frame.payload;
        if (!payload.message_id) return;

        const currentChatID = activeChatID || (pluginThreadMeta ? `plugin:${pluginThreadMeta.chatId}` : null);
        if (!currentChatID) return;

        const currentMessages = useChatStore.getState().chats[currentChatID] || [];
        const messageIdx = currentMessages.findIndex(m => m.id === payload.message_id);
        if (messageIdx === -1) return;

        const currentMessage = currentMessages[messageIdx];

        if (payload.type === 'metadata') {
            const existingParts = currentMessage.content_parts || [];
            let updatedParts = [...existingParts];
            let updatedReasoningSteps = [...(currentMessage.reasoning_steps || [])];

            if (payload.reasoning_steps && Array.isArray(payload.reasoning_steps) && payload.reasoning_steps.length > 0) {
                for (const chunk of payload.reasoning_steps) {
                    if (updatedParts.length > 0 && updatedParts[updatedParts.length - 1].type === 'reasoning') {
                        const lastPart = updatedParts[updatedParts.length - 1] as { type: 'reasoning', reasoning: string };
                        updatedParts[updatedParts.length - 1] = { type: 'reasoning', reasoning: lastPart.reasoning + chunk };

                        if (updatedReasoningSteps.length > 0) {
                            updatedReasoningSteps[updatedReasoningSteps.length - 1] += chunk;
                        } else {
                            updatedReasoningSteps.push(chunk);
                        }
                    } else {
                        updatedParts.push({ type: 'reasoning', reasoning: chunk });
                        updatedReasoningSteps.push(chunk);
                    }
                }
            }

            const hasToolCalls = updatedParts.some(p => p.type === 'tool_call');
            if (!hasToolCalls && payload.tool_calls && Array.isArray(payload.tool_calls)) {
                for (const tc of payload.tool_calls) {
                    updatedParts.push({ type: 'tool_call', tool_call: tc });
                }
            }

            updateMessage(currentChatID, payload.message_id, {
                tool_calls: payload.tool_calls || currentMessage.tool_calls,
                reasoning_steps: updatedReasoningSteps,
                content_parts: updatedParts,
                model: payload.model || currentMessage.model
            });

        } else if (payload.type === 'usage') {
            updateMessage(currentChatID, payload.message_id, {
                metadata: {
                    ...currentMessage.metadata,
                    usage: {
                        prompt_tokens: payload.prompt_tokens,
                        completion_tokens: payload.completion_tokens,
                        elapsed_ms: payload.elapsed_ms
                    }
                }
            });
        }
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
        if (socketRef.current) {
            socketRef.current.sendStop();
            socketRef.current = null;
        }
        setAssistantWorking(false);
    }, []);

    const value: ChatContextType = {
        messages,
        messagesLoading,
        getMessages,
        sendMessage, // Now uses the WebSocket version
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
        // Display settings
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
