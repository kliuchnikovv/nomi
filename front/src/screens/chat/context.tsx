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

    // Thinking mode state (persists within chat session)
    const [thinkingLevel, setThinkingLevel] = useState<string>('off');

    // Display settings (persists within chat session)
    const [showToolCalls, setShowToolCalls] = useState<boolean>(true);
    const [showReasoning, setShowReasoning] = useState<boolean>(true);
    const [showMemberResponses, setShowMemberResponses] = useState<boolean>(true);

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
            const socketId = Math.random().toString(36).substring(7);
            console.log(`[WS-${socketId}] Creating new ChatSocket. socketRef was null.`);
            socketRef.current = newWebSocket(token, activeChatID);
            (socketRef.current as any).__debugId = socketId;
        } else {
            console.log(`[WS-${(socketRef.current as any).__debugId}] socketRef.current already exists, not creating new.`);
        }

        console.log(`WebSocket useEffect: socket ready`)

        return () => {
            console.log('WS cleanup: deps changed', { activeChatID, token: !!token });
            socketRef.current?.close();
            socketRef.current = null;
        };
    }, [activeChatID, token, refreshToken, chatMode, teamCommand]); // Dependencies for WebSocket lifecycle
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
        async (text: string, attachments: any[] = [], webSearch?: boolean, thinking?: string) => {
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
            socketRef.current!.sendMessage(text.trim(), sessionId, messageID, attachmentIDs, webSearch, thinking);
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

    const sendMessage = useCallback(
        async (text: string, attachments: any[] = [], webSearch?: boolean, thinking?: string) => {
            await sendStreamingMessage(text, attachments, webSearch, thinking);
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
                if (frame.payload?.type === 'actions') {
                    console.log('>>> ACTIONS FRAME RECEIVED:', frame.payload);
                }
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
            console.log('[DEBUG] New message received:', {
                messageID,
                payloadRole: frame.payload.role,
                resolvedRole: role,
                payloadSender: frame.payload.sender,
                message: frame.payload.message?.substring(0, 50),
            });
            newMessages[messageIdx] = {
                id: messageID,
                chat_id: activeChatID,
                sender: sender,
                role: role,
                text: role === 'user' ? (frame.payload.message || "") : "",
                created_at: Date.now(),
                content_parts: role === 'user' ? undefined : [], // Initialize content_parts for assistant
            };
            // For user messages from other devices, we're done - don't accumulate
            if (role === 'user') {
                console.log('Received user message from other device', messageID);
                return newMessages;
            }
        }

        // For ANY user message (new or existing), don't do text accumulation
        // User messages arrive complete in a single frame, not streamed
        const messageRole = frame.payload.role || newMessages[messageIdx]?.role;
        if (messageRole === 'user') {
            // User messages don't stream - they're complete
            // Just update text if needed and return
            if (frame.payload.message && newMessages[messageIdx]) {
                newMessages[messageIdx] = {
                    ...newMessages[messageIdx],
                    text: frame.payload.message, // Replace, don't append
                };
            }
            return newMessages;
        }

        // Only accumulate text for assistant messages (streaming)
        if (!frame.payload.eof) {
            const existingParts = newMessages[messageIdx].content_parts || [];
            let updatedParts = [...existingParts];

            // Handle streaming tool call
            if (frame.payload.type === 'tool_call' && frame.payload.tool) {
                updatedParts.push({ type: 'tool_call', tool_call: frame.payload.tool });

                // Also update top-level tool_calls array for backward compatibility
                const currentToolCalls = newMessages[messageIdx].tool_calls || [];
                newMessages[messageIdx] = {
                    ...newMessages[messageIdx],
                    content_parts: updatedParts,
                    tool_calls: [...currentToolCalls, frame.payload.tool]
                };
            } else if (frame.payload.type === 'member_response') {
                // Handle team member agent response - accumulate into collapsible part
                const memberText = frame.payload.message || '';
                const agentName = frame.payload.agent_name || 'Member';

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
                        content_parts: updatedParts,
                    };
                }
            } else if (frame.payload.type === 'actions') {
                // Handle D&D action buttons from suggest_actions tool
                const actions = frame.payload.actions || [];
                console.log('[ChatContext] Received actions frame:', actions);
                if (actions.length > 0) {
                    // Set actions on the message for button rendering
                    newMessages[messageIdx] = {
                        ...newMessages[messageIdx],
                        actions: actions.map((a: any) => ({
                            ...a,
                            message_id: frame.payload.message_id
                        })),
                    };
                    console.log('[ChatContext] Set actions on message:', newMessages[messageIdx].actions);
                }
            } else {
                // Handle text streaming
                const newText = frame.payload.message || '';
                if (newText) {
                    // Append to last text part or create new one
                    if (updatedParts.length > 0 && updatedParts[updatedParts.length - 1].type === 'text') {
                        // Append to existing text part
                        const lastPart = updatedParts[updatedParts.length - 1] as { type: 'text'; text: string };
                        updatedParts[updatedParts.length - 1] = { type: 'text', text: lastPart.text + newText };
                    } else {
                        // Create new text part
                        updatedParts.push({ type: 'text', text: newText });
                    }

                    newMessages[messageIdx] = {
                        ...newMessages[messageIdx],
                        text: newMessages[messageIdx].text + newText,
                        content_parts: updatedParts,
                    };
                }
            }
            console.log("frame captured", frame.payload.type || "text", frame);
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

        if (payload.type === 'metadata') { // Handling tool_calls, reasoning, and model
            const existingParts = newMessages[messageIdx].content_parts || [];
            let updatedParts = [...existingParts];
            let updatedReasoningSteps = [...(newMessages[messageIdx].reasoning_steps || [])];

            // Handle streaming reasoning steps
            if (payload.reasoning_steps && Array.isArray(payload.reasoning_steps) && payload.reasoning_steps.length > 0) {
                // Assuming payload contains chunks of reasoning
                for (const chunk of payload.reasoning_steps) {
                    // Append to last reasoning part or create new one
                    if (updatedParts.length > 0 && updatedParts[updatedParts.length - 1].type === 'reasoning') {
                        const lastPart = updatedParts[updatedParts.length - 1] as { type: 'reasoning', reasoning: string };
                        updatedParts[updatedParts.length - 1] = { type: 'reasoning', reasoning: lastPart.reasoning + chunk };

                        // Also update top-level array (update last element)
                        if (updatedReasoningSteps.length > 0) {
                            updatedReasoningSteps[updatedReasoningSteps.length - 1] += chunk;
                        } else {
                            updatedReasoningSteps.push(chunk);
                        }
                    } else {
                        // Create new reasoning part
                        updatedParts.push({ type: 'reasoning', reasoning: chunk });
                        updatedReasoningSteps.push(chunk);
                    }
                }
            }

            // Legacy tool_calls handling (if sent as a block in metadata, e.g. at end)
            // Note: Our new streaming approach sends them as data frames.
            // This block handles the case if they are sent in metadata (e.g. legacy or redundancy).
            // To avoid duplication, we should check if they are already in content_parts.
            // But usually payload.tool_calls in metadata means "all tool calls so far" or "final list".
            // If we are streaming, we probably shouldn't blindly append.
            // Let's rely on streaming data frames for tool calls, and use metadata only for model info
            // or if we trust it doesn't duplicate.
            // The Go backend sends tool calls in metadata at the end if accumulated.

            // If we receive tool_calls in metadata, let's assume it's the COMPLETE list and sync if needed,
            // OR just ignore if we are building incrementally.
            // Since we implemented streaming tool calls, we should prioritize that.
            // However, the previous code handled it here.

            // Checking if we already have tool calls in content parts
            const hasToolCalls = updatedParts.some(p => p.type === 'tool_call');
            if (!hasToolCalls && payload.tool_calls && Array.isArray(payload.tool_calls)) {
                for (const tc of payload.tool_calls) {
                    updatedParts.push({ type: 'tool_call', tool_call: tc });
                }
            }

            newMessages[messageIdx] = {
                ...newMessages[messageIdx],
                // tool_calls: payload.tool_calls, // Don't overwrite with payload if we are streaming
                tool_calls: payload.tool_calls || newMessages[messageIdx].tool_calls,
                reasoning_steps: updatedReasoningSteps,
                content_parts: updatedParts,
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
    };

    return (
        <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
    );
}
