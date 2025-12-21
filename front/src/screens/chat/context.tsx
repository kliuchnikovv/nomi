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
import { ChatContextType, Props, Model } from './models';
import { useAuth } from '../auth/context.tsx';
import { alertError } from '../auth/models.tsx';
import { ChatSocket } from '../../socket';
import { getApiUrl, API_URL } from '../../config.ts';
import { modelsApi, sidebarApi } from '../../apiClient';
import { AVAILABLE_TEAMS } from './teams';

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
    const [messages, setMessages] = useState<Message[]>([]);
    const [messagesLoading, setMessagesLoading] = useState(false);
    const [externalTitle, setExternalTitle] = useState<string | null>(null);
    const socketRef = useRef<ChatSocket | null>(null); // Declare socketRef
    const seededChatRef = useRef<string | null>(null);
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
    const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null);

    const { user, token, refreshToken } = useAuth(); // Destructure token and refreshToken

    // const API_URL = 'https://genie.com';

    // Keep getMessages for initial load and manual refresh if needed
    const getMessages = useCallback(async (chatID: string) => {
        setMessagesLoading(true);
        try {
            const data = await apiClient.get<Message[]>(
                `${getApiUrl()}/chats/${chatID}/messages`,
            );
            if (!data) {
                return;
            }

            setMessages(data);

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
    }, [setSelectedModel]);

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
        // Reset manual selection flag when switching chats
        manualModelSelectionRef.current = false;
        if (!activeChatID || activeChatID === emptyChatID) {
            setMessages([]);
            return;
        }
        getMessages(activeChatID);
    }, [activeChatID, getMessages, pluginThreadMeta]); // Dependency on activeChatID

    // Fetch available models on mount
    useEffect(() => {
        const fetchModels = async () => {
            try {
                const models = await modelsApi.getModels();
                if (models) {
                    setAvailableModels(models);
                }
            } catch (error) {
                console.error('Failed to fetch models:', error);
            }
        };
        fetchModels();
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
            // For dynamic teams, we might want to update participants' models too, 
            // but let's keep it simple: model picker overrides the main team/conductor model.
        };

        setTeamCommand((prev: any) => {
            try {
                if (JSON.stringify(prev) === JSON.stringify(next)) return prev;
            } catch { /* ignore */ }
            return next;
        });
    }, [chatMode, selectedModel, selectedTeamId]);

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
            console.log('WebSocket useEffect: Initializing ChatSocket.');
            socketRef.current = newWebSocket(token, activeChatID);
        }

        console.log(`WebSocket useEffect: socket ready`)

        return () => {
            console.log('WS cleanup: deps changed', { activeChatID, token: !!token });
            socketRef.current?.close();
            socketRef.current = null;
        };
    }, [activeChatID, token, refreshToken, API_URL]); // Dependencies for WebSocket lifecycle
    const refreshPluginThread = useCallback(async () => {
        if (!pluginThreadMeta) return;
        try {
            const resp = await sidebarApi.getChatMessages(
                pluginThreadMeta.provider,
                pluginThreadMeta.chatId,
                pluginThreadMeta.integrationId,
            );
            const converted = (resp?.messages || []).map(msg => mapPluginMessage(msg, pluginThreadMeta.provider));
            setMessages(converted);
        } catch (err) {
            console.error('Failed to refresh plugin thread', err);
        }
    }, [pluginThreadMeta, mapPluginMessage]);

    const sendStreamingMessage = useCallback(
        async (text: string, attachments: any[] = [], webSearch?: boolean) => {
            if (!text.trim() && attachments.length === 0) return;
            if (!user?.id) return;

            // Clear error when sending a new message
            setError(null);
            setLastFailedMessage(text.trim());

            let chatIdToUse = activeChatID;
            let messageID: string | undefined;
            const timestamp = Date.now();
            const attachmentIDs = attachments.map(a => a.id);

            // Map local attachments to model Attachment type
            const modelAttachments = attachments.map(a => ({
                id: a.id,
                file_name: a.name,
                file_type: a.mimeType,
                size: 0, // Unknown size for local
                uri: a.uri
            }));

            if (pluginThreadMeta) {
                chatIdToUse = String(pluginThreadMeta.chatId);
                messageID = generateUUID();

                const newUserMessage: Message = {
                    id: messageID,
                    chat_id: chatIdToUse,
                    sender: user.id,
                    role: 'user',
                    text: text.trim(),
                    created_at: timestamp,
                    attachments: modelAttachments,
                };
                setMessages(prev => [...prev, newUserMessage]);
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

                messageID = await createMessage(text, chatIdToUse, attachmentIDs, webSearch);
                if (!messageID) {
                    console.error('Failed to create message before sending via WebSocket');
                    setError('Не удалось создать сообщение');
                    return;
                }
                setCurrentMessageID(messageID!);

                const userMessage: Message = {
                    id: messageID!,
                    chat_id: chatIdToUse!,
                    sender: user.id,
                    role: 'user',
                    text: text.trim(),
                    created_at: timestamp,
                    attachments: modelAttachments,
                };

                setMessages(prevMessages => [
                    ...prevMessages,
                    userMessage,
                ]);
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
            socketRef.current!.sendMessage(text.trim(), sessionId, messageID, attachmentIDs, webSearch);
            console.log("WebSocket sendStreamingMessage: socketRef.current:", socketRef.current);
        },
        [activeChatID, user?.id, refreshToken, socketRef.current, pluginThreadMeta, mapPluginMessage, refreshPluginThread, token],
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
        setMessages([]);
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
            setMessages(converted);
        } catch (err) {
            console.error('Failed to load plugin chat on start', err);
        }
    }, [setActiveChatID, mapPluginMessage, setChatMode, setTeamCommand]);

    const clearPluginThread = useCallback(() => {
        setPluginThreadMeta(null);
        setExternalTitle(null);
        setMessages([]);
    }, []);

    async function createChat(title: string) {
        let chatID: string;

        try {
            const created = await apiClient.post<{ id: string }>(
                `${getApiUrl()}/chats`,
                {
                    "title": title,
                    "model": emptyChatID
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
    }

    async function createMessage(text: string, chatID: string, attachmentIDs?: string[], webSearch?: boolean) {
        let messageID: string;

        try {
            const model = selectedModelRef.current;
            console.log('Creating message with model:', model);

            const created = await apiClient.post<{ id: string }>(
                `${getApiUrl()}/chats/${chatID}/messages`,
                {
                    chat_id: chatID,
                    role: 'user',
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
    }

    // Modify sendMessage to use sendStreamingMessage
    const sendMessage = useCallback(
        async (text: string, attachments: any[] = [], webSearch?: boolean) => {
            await sendStreamingMessage(text, attachments, webSearch);
        },
        [sendStreamingMessage],
    );

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
                console.log('onMessage: received message', frame);
                setMessages(prevMessages =>
                    onReceivedMessage(frame, prevMessages)
                );
            },
            onMeta: (frame: Frame) => {
                console.log('onMeta: received message', frame);
                setMessages(prevMessages => onReceivedMeta(frame, prevMessages));
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

    function onReceivedMessage(frame: Frame, prevMessages: Message[]) {
        let newMessages: Message[] = [...prevMessages];

        const messageID = frame.payload.message_id
        if (!messageID) {
            console.error(`Frame got no message_id`, frame)
            return newMessages;
        }

        // Check if message already exists (deduplication for optimistic updates)
        const existingMessage = newMessages.find(m => m.id === messageID);

        // For user messages: if already exists with same text, skip (optimistic duplicate)
        if (existingMessage && existingMessage.role === 'user') {
            console.log('Dedup: skipping duplicate user message', messageID);
            return prevMessages; // Return unchanged
        }

        let messageIdx = newMessages.findIndex((item) => {
            return item.id === frame.payload.message_id;
        })

        if (messageIdx === -1) {
            messageIdx = newMessages.length
            // Use role from payload if available (for multi-device sync)
            const role = frame.payload.role || 'assistant';
            const sender = frame.payload.sender || (role === 'user' ? 'user' : 'assistant');
            newMessages[messageIdx] = {
                id: messageID,
                chat_id: activeChatID,
                sender: sender,
                role: role,
                text: role === 'user' ? (frame.payload.message || "") : "",
                created_at: Date.now(),
            };
            // For user messages from other devices, we're done - don't accumulate
            if (role === 'user') {
                console.log('Received user message from other device', messageID);
                return newMessages;
            }
        }

        if (!frame.payload.eof) {
            newMessages[messageIdx] = {
                ...newMessages[messageIdx],
                text: newMessages[messageIdx].text + frame.payload.message
            };
            console.log("frame captured", frame.payload.message, frame);
        } else {
            setAssistantWorking(false);
        }

        return newMessages;
    }

    function onReceivedMeta(frame: Frame, prevMessages: Message[]) {
        let newMessages: Message[] = [...prevMessages];
        const payload = frame.payload;

        if (!payload.message_id) return newMessages;

        const messageIdx = newMessages.findIndex(m => m.id === payload.message_id);
        if (messageIdx === -1) return newMessages;

        if (payload.type === 'metadata') { // Handling tool_calls and model
            newMessages[messageIdx] = {
                ...newMessages[messageIdx],
                tool_calls: payload.tool_calls,
                model: payload.model || newMessages[messageIdx].model
            };
        } else if (payload.type === 'usage') {
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

        return newMessages;
    }

    const retryLastMessage = useCallback(() => {
        if (lastFailedMessage) {
            setError(null);
            sendStreamingMessage(lastFailedMessage);
        }
    }, [lastFailedMessage, sendStreamingMessage]);

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
    };

    return (
        <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
    );
}
