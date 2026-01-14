import { Frame, Message } from '../main/models';
import { apiClient } from '../../apiClient';
import React, {
    createContext,
    useContext,
    useEffect,
    useRef,
    useState,
    useCallback,
    useMemo,
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
import { v4 as uuidv4 } from 'uuid';

const emptyChatID = '00000000-0000-0000-0000-000000000000';

// Stable empty array reference to prevent infinite re-renders in Zustand selectors
const EMPTY_MESSAGES: Message[] = [];

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
    // Select messages from global store
    const messages = useChatStore(
        useCallback(
            (state) => (activeChatID ? state.chats[activeChatID] ?? EMPTY_MESSAGES : EMPTY_MESSAGES),
            [activeChatID]
        )
    );
    const setMessagesToStore = useChatStore((state) => state.setMessages);

    const [messagesLoading, setMessagesLoading] = useState(false);
    const { tools } = useConnectors();
    const [externalTitle, setExternalTitle] = useState<string | null>(null);
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
    const [activeAgentsCount, setActiveAgentsCount] = useState<number>(0);

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
        setChatMode('team');
    }, []);


    // Keep getMessages for initial load and manual refresh if needed
    const getMessages = useCallback(async (chatID: string) => {
        if (!chatID || chatID === emptyChatID) return;
        setMessagesLoading(true);
        try {
            const data = await apiClient.get<Message[]>(
                `${getApiUrl()}/chats/${chatID}/messages`,
            );
            if (!data) {
                return;
            }

            // Update store
            setMessagesToStore(chatID, data);

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
            // Sanitize payload: don't send team_id if mode is agent, unless it's a specific agent-as-team
            let teamIdToSend = selectedTeamId || null;
            if (chatMode === 'agent') {
                // Check if the selectedTeamId is actually an agent
                const teamDef = AVAILABLE_TEAMS.find(t => t.id === selectedTeamId);
                if (teamDef && !teamDef.isAgent) {
                    // If it's a TEAM (like development_team) but we are in AGENT mode, sanitize it.
                    // Agents shouldn't have a team_id unless they are specific agent-types.
                    teamIdToSend = null;
                }
            }

            const created = await apiClient.post<{ id: string }>(
                `${getApiUrl()}/chats`,
                {
                    "title": title,
                    "model": selectedModelRef.current || 'gemini-2.0-flash-exp',
                    "mode": chatMode,
                    // Pass team_id for teams, OR for individual agents (agent_type)
                    "team_id": teamIdToSend,
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
            return state.chats[pluginChatKey] ?? EMPTY_MESSAGES;
        }
        return activeChatID ? state.chats[activeChatID] ?? EMPTY_MESSAGES : EMPTY_MESSAGES;
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
                // Using the provider ID for the socket routing if needed, but since we are in plugin mode,
                // we might need to route differently or just use the local display.
                // For now, let's assume we use the real ID for the socket too.
                chatIdToUse = String(pluginThreadMeta.chatId);

                // For plugin mode, we generate ID locally if not provided
                if (!messageID) {
                    messageID = uuidv4();
                }
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
                selectedModelRef.current || undefined,
                tools // Pass enabled integrations to backend
            );
        },
        [activeChatID, user?.id, pluginThreadMeta, createChat, createMessage, setLastFailedMessage, tools],
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
                // Use setSelectedTeamId to avoid side-effect of switching mode to 'team' if we are in 'agent' mode
                setSelectedTeamId(activeChat.team_id);
            }
        } else if (!activeChatID) {
            newChatInitializedRef.current = false;
        }

        if (!activeChatID || activeChatID === emptyChatID) {
            // Clear store for current chat or just ignore?
            // We shouldn't clear the store because we want persistence.
            return;
        }
        // Only fetch if empty or user navigation
        // Actually, we should probably fetch to sync with backend?
        if (messages.length === 0) {
            getMessages(activeChatID);
        }
    }, [activeChatID, getMessages, pluginThreadMeta, activeChat, pendingChatMode, sidebarFilter, sendMessage, clearPendingChatMode]);

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
                setActiveAgentsCount(0);
            },
            onSignal: (payload: any) => {
                if (payload.type === 'system_status' && typeof payload.active_agents_count === 'number') {
                    setActiveAgentsCount(payload.active_agents_count);
                }
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


    const refreshPluginThread = useCallback(async () => {
        if (!pluginThreadMeta) return;
        try {
            const resp = await sidebarApi.getChatMessages(
                pluginThreadMeta.provider,
                pluginThreadMeta.chatId,
                pluginThreadMeta.integrationId,
            );
            const converted = (resp?.messages || []).map(msg => mapPluginMessage(msg, pluginThreadMeta.provider));
            // Update store directly or local state? Plugin threads might not be in chat store yet.
            // For now, plugins use local `messages` state in previous code, but here we bound `messages` to store.
            // If pluginThreadMeta is set, `activeChatID` is likely emptyChatID.
            // So `messages` from store is [].

            // Wait! The refactoring to use store makes `messages` derived from store.
            // But plugin messages are not in `chats` store necessarily, or they are?
            // If we use store for plugins, we need to generate a unique ID for the key.
            // Previous code used `setMessages` (local state).

            // To support plugins with the new store:
            // We can use a synthetic chatID for the plugin thread.
            const pluginChatKey = `plugin_${pluginThreadMeta.provider}_${pluginThreadMeta.chatId}`;
            setMessagesToStore(pluginChatKey, converted);

            // BUT: activeChatID is emptyChatID. We need to point it to pluginChatKey?
            // Or we need `messages` to select from pluginChatKey if pluginThreadMeta is set.
            // Let's update the selector.
        } catch (err) {
            console.error('Failed to refresh plugin thread', err);
        }
    }, [pluginThreadMeta, mapPluginMessage, setMessagesToStore]);

    const startPluginThread = useCallback(async ({ provider, chatId, title, integrationId, integrationName, messages: preloadedMessages }: { provider: string; chatId: string | number; title?: string | null; integrationId?: string; integrationName?: string | null; messages?: any[] }) => {
        setPluginThreadMeta({ provider, chatId, integrationId, integrationName });
        setChatMode('agent');
        setTeamCommand(null);
        setExternalTitle(title || null);
        setAssistantWorking(false);
        setActiveChatID(emptyChatID); // Deselect main chat

        try {
            let incomingMessages: any[] = [];
            if (preloadedMessages && Array.isArray(preloadedMessages)) {
                incomingMessages = preloadedMessages;
            } else {
                const resp = await sidebarApi.getChatMessages(provider, chatId, integrationId);
                incomingMessages = resp?.messages || [];
            }
            const converted = (incomingMessages || []).map(msg => mapPluginMessage(msg, provider));
            // Update Store for this plugin chat
            // Key: String(chatId) which is the real ID
            setMessagesToStore(String(chatId), converted);
        } catch (err) {
            console.error('Failed to load plugin chat on start', err);
        }
    }, [setActiveChatID, mapPluginMessage, setChatMode, setTeamCommand, setMessagesToStore]);

    const clearPluginThread = useCallback(() => {
        setPluginThreadMeta(null);
        setExternalTitle(null);
        // Messages will clear because selector depends on pluginThreadMeta
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

    const executeMessageAction = useCallback(async (action: any, messageId: string) => {
        console.log('[ChatContext] Executing action:', action.label, 'for message:', messageId);
        // For now, just send the action label as a new message
        await sendMessage(action.label || action.action, [], false, undefined, 'user');
    }, [sendMessage]);

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
        detailLevel,
        setDetailLevel,
        activeAgentsCount,
    };


    return (
        <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
    );
}
