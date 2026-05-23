import { Frame, Message } from '../main/models';
import { apiClient } from '../../apiClient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
    createContext,
    useContext,
    useEffect,
    useRef,
    useState,
    useCallback,
    useMemo,
    startTransition,
} from 'react';
import { InteractionManager } from 'react-native';
import { ChatContextType, Props, Model, DetailLevel } from './models';
import { useAuth } from '../auth/context.tsx';
import { socket } from '../../socket';
import { getApiUrl } from '../../config.ts';
import { modelsApi, sidebarApi, projectsApi } from '../../apiClient';
import { classifyMessageForProject } from '../../services/projects/ProjectClassifier';
import { AVAILABLE_TEAMS } from './teams';
import { useMain } from '../main/context';
import { useConnectors } from '../settings/connectors/context';
import { useChatStore } from '../../store/chatStore';
import { useShallow } from 'zustand/shallow';
import { subscribeGenerationDone } from '../../store/generationDoneStore';
import {
    generateChatTitle,
    generateChatEmoji,
} from '../../services/chatTitleGenerator';
import { extractActions } from '../../services/actionExtractor';
import { getStoredLocation } from '../../services/location/locationService';

function generateId(): string {
    return `${Date.now().toString(36)}-${Math.random()
        .toString(16)
        .slice(2, 10)}`;
}

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

export function useChatOptional(): ChatContextType | undefined {
    return useContext(ChatContext);
}

export function ChatProvider({
    children,
    activeChatID,
    setActiveChatID,
    initialProjectId,
    initialPendingText,
    isNewSession = false,
    onSessionStarted,
}: Props) {
    // Select messages from global store with shallow comparison to prevent re-renders
    // when message content hasn't actually changed
    const messages = useChatStore(
        useShallow(
            useCallback(
                state =>
                    activeChatID
                        ? state.chats[activeChatID] ?? EMPTY_MESSAGES
                        : EMPTY_MESSAGES,
                [activeChatID],
            ),
        ),
    );
    const setMessagesToStore = useChatStore(state => state.setMessages);

    const [messagesLoading, setMessagesLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const { tools } = useConnectors();
    const [externalTitle, setExternalTitle] = useState<string | null>(null);
    const seededChatRef = useRef<string | null>(null);
    const newChatInitializedRef = useRef<boolean>(false);
    const [pluginThreadMeta, setPluginThreadMeta] = useState<{
        provider: string;
        chatId: string | number;
        integrationId?: string;
        integrationName?: string | null;
    } | null>(null);

    const mapPluginMessage = useCallback(
        (
            msg: any,
            provider: string,
            fallbackRole: 'assistant' | 'user' = 'assistant',
        ): Message => {
            const roleFromMsg =
                msg.role ||
                (msg.sender && msg.sender !== provider ? 'user' : undefined) ||
                (msg.metadata?.from === 'user' ? 'user' : undefined) ||
                fallbackRole;
            const normalizedRole =
                roleFromMsg === 'daemon' ? 'assistant' : roleFromMsg;
            return {
                id: msg.id || `plugin-${Date.now()}`,
                chat_id: String(
                    pluginThreadMeta?.chatId ??
                        msg.thread_id ??
                        msg.chat_id ??
                        '',
                ),
                sender: msg.sender || provider,
                role: normalizedRole,
                text: msg.summary || msg.content || msg.title || '',
                created_at: msg.received_at
                    ? new Date(msg.received_at).getTime()
                    : Date.now(),
                actions: msg.actions,
                importance: msg.importance,
                metadata: {
                    ...(msg.metadata || {}),
                    originalRole: msg.role || roleFromMsg,
                    title: msg.title,
                    integrationId:
                        msg.integration_id || pluginThreadMeta?.integrationId,
                    integrationName: pluginThreadMeta?.integrationName,
                    threadId: msg.thread_id,
                },
            };
        },
        [
            pluginThreadMeta?.chatId,
            pluginThreadMeta?.integrationId,
            pluginThreadMeta?.integrationName,
        ],
    );

    const [currentMessageID, setCurrentMessageID] = useState<string | null>(
        null,
    );
    const [assistantWorking, setAssistantWorking] = useState<boolean>(false);
    const [chatMode, setChatMode] = useState<'agent' | 'team'>('agent');
    const [teamCommand, setTeamCommand] = useState<any>(null);
    const [activeAgentsCount, setActiveAgentsCount] = useState<number>(0);
    const [generationStatus, setGenerationStatus] = useState<string | null>(
        null,
    );
    const [suggestedProjectId, setSuggestedProjectId] = useState<string | null>(
        null,
    );
    const [classifiedText, setClassifiedText] = useState<string | null>(null);
    // Track which chatId we already attempted classification for (avoid repeated API calls).
    const classifiedChatIdRef = useRef<string | null>(null);
    // Session-level classification state (blocks first send in a new session until project resolved)
    const [pendingMessage, setPendingMessage] = useState<string | null>(null);
    const [suggestedProjectForSession, setSuggestedProjectForSession] =
        useState<import('../main/models').Project | null>(null);
    const [sessionClassified, setSessionClassified] = useState(false);
    const responseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
        null,
    );
    const generatingForChatRef = useRef<string | null>(null);
    const skipReconnectResetRef = useRef(false);
    const RESPONSE_TIMEOUT_MS = 300_000; // 5 minutes — safety net if DONE/ERROR never arrives

    // Model selection state
    const [selectedModel, setSelectedModelInternal] = useState<string | null>(
        null,
    );
    const selectedModelRef = useRef<string | null>(null);
    const selectedProviderRef = useRef<string | undefined>(undefined);
    const manualModelSelectionRef = useRef<boolean>(false);
    const [availableModels, setAvailableModels] = useState<Model[]>([]);

    const setSelectedModel = useCallback(
        (model: string, isManual: boolean = true) => {
            console.log(
                'setSelectedModel called with:',
                model,
                'isManual:',
                isManual,
            );
            setSelectedModelInternal(model);
            selectedModelRef.current = model;

            // Keep provider in sync with model selection (best-effort)
            const nextProvider = availableModels.find(
                m => m.id === model,
            )?.provider;
            selectedProviderRef.current = nextProvider;

            if (isManual) {
                manualModelSelectionRef.current = true;
            }

            // Notify WebSocket about model change if connection is active
            if (activeChatID) {
                console.log(
                    'Notifying WebSocket about model change to:',
                    model,
                );
                socket.changeModel(activeChatID, model);
            }
        },
        [activeChatID, availableModels],
    );

    // Error state management
    const [error, setError] = useState<string | null>(null);
    const [isRateLimited, setIsRateLimited] = useState(false);
    const [pendingInputText, setPendingInputText] = useState<string | null>(
        initialPendingText ?? null,
    );
    const [lastFailedMessage, setLastFailedMessage] = useState<{
        text: string;
        attachments?: any[];
        messageId?: string;
        webSearch?: boolean;
        thinking?: string;
        contextItems?: any[];
    } | null>(null);

    // Helper: report error, remove the failed message from store, restore text to input
    const reportMessageError = useCallback(
        (errorMessage: string) => {
            setError(errorMessage);
            setLastFailedMessage(current => {
                if (current) {
                    if (current.messageId && activeChatID) {
                        useChatStore
                            .getState()
                            .removeMessage(activeChatID, current.messageId);
                    }
                    setPendingInputText(current.text);
                }
                return null;
            });
        },
        [activeChatID],
    );

    // Thinking mode state (persists within chat session)
    const [thinkingLevel, setThinkingLevel] = useState<string>('off');

    // Display settings (persists within chat session)
    const [showToolCalls, setShowToolCalls] = useState<boolean>(true);
    const [showReasoning, setShowReasoning] = useState<boolean>(true);
    const [showMemberResponses, setShowMemberResponses] =
        useState<boolean>(true);
    const [detailLevel, setDetailLevelInternal] = useState<DetailLevel>('all');

    // Load persisted detail level on mount
    useEffect(() => {
        AsyncStorage.getItem('@genie_detail_level').then(saved => {
            if (
                saved &&
                ['hide', 'tool_calls', 'think', 'all'].includes(saved)
            ) {
                setDetailLevel(saved as DetailLevel);
            }
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Reset session classification state whenever a new session begins
    useEffect(() => {
        if (isNewSession) {
            setSessionClassified(false);
            setPendingMessage(null);
            setSuggestedProjectForSession(null);
        }
    }, [isNewSession]);

    const setDetailLevel = useCallback((level: DetailLevel) => {
        setDetailLevelInternal(level);
        AsyncStorage.setItem('@genie_detail_level', level);
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
                setShowMemberResponses(true); // Agent thinking should show in think mode
                break;
            case 'all':
                setShowToolCalls(true);
                setShowReasoning(true);
                setShowMemberResponses(true);
                break;
        }
    }, []);

    const { user, token, refreshToken } = useAuth();
    const {
        activeChat,
        pendingChatMode,
        clearPendingChatMode,
        sidebarFilter,
        renameChat,
        setChatIcon,
        getChats,
    } = useMain();

    // Ensure chat socket is connected to the active chat room (RoomTypeChat).
    // Reconnect when activeChatID changes so we join the new room (avoid DONE only on user channel).
    // Deferred via InteractionManager so screen transition animations complete before
    // the socket connection (and any initial data processing) begins.
    useEffect(() => {
        if (!activeChatID || activeChatID === emptyChatID) return;
        if (!token) return;
        // Reset loading state from previous chat immediately (before animation),
        // but skip if we're actively generating (e.g. new chat created during sendStreamingMessage)
        const isGenerating = generatingForChatRef.current !== null;
        console.log(
            '[ChatContext] useEffect activeChatID changed:',
            activeChatID,
            'isGenerating=',
            isGenerating,
        );
        skipReconnectResetRef.current = isGenerating;
        if (!isGenerating) {
            setAssistantWorking(false);
            setActiveAgentsCount(0);
        }
        // Directly run socket setup without InteractionManager to avoid async issues
        socket.setChannel('chat');
        socket.setChatId(activeChatID);
        if (socket.isReady()) {
            socket.close();
        }
        if (!socket.isReady()) {
            socket.connect();
        }
    }, [activeChatID, token]);

    const [selectedTeamId, setSelectedTeamId] = useState<string | null>(
        AVAILABLE_TEAMS[0]?.id ?? null,
    );

    const selectTeam = useCallback((teamId: string) => {
        setSelectedTeamId(teamId);
        setChatMode('team');
    }, []);

    // Keep getMessages for initial load and manual refresh if needed
    const getMessages = useCallback(
        async (chatID: string, opts?: { isRefresh?: boolean }) => {
            if (!chatID || chatID === emptyChatID) return;
            const isRefresh = opts?.isRefresh === true;
            if (isRefresh) {
                setRefreshing(true);
            } else {
                setMessagesLoading(true);
            }
            try {
                const data = await apiClient.get<Message[]>(
                    `${getApiUrl()}/chats/${chatID}/messages`,
                    isRefresh
                        ? { headers: { 'Cache-Control': 'no-cache, no-store' } }
                        : undefined,
                );
                if (!data) {
                    return;
                }

                // Update store (always replace so refresh shows latest from server)
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
                        console.log(
                            'No model found in history, resetting to default',
                        );
                        setSelectedModel(
                            availableModels[0]?.id || 'glm-5',
                            false,
                        );
                    }
                }
            } catch (error) {
                console.error(
                    `Failed to fetch messages for chat ${chatID}:`,
                    error,
                );
            } finally {
                if (isRefresh) {
                    setRefreshing(false);
                } else {
                    setMessagesLoading(false);
                }
            }
        },
        [setSelectedModel, setMessagesToStore],
    );

    // Define createChat early so sendStreamingMessage can use it
    const createChat = useCallback(
        async (title: string) => {
            let chatID: string;

            try {
                // Sanitize payload: don't send team_id if mode is agent, unless it's a specific agent-as-team
                let teamIdToSend = selectedTeamId || null;
                if (chatMode === 'agent') {
                    // Check if the selectedTeamId is actually an agent
                    const teamDef = AVAILABLE_TEAMS.find(
                        t => t.id === selectedTeamId,
                    );
                    if (teamDef && !teamDef.isAgent) {
                        // If it's a TEAM but we are in AGENT mode, sanitize it.
                        // Agents shouldn't have a team_id unless they are specific agent-types.
                        teamIdToSend = null;
                    }
                }

                const created = await apiClient.post<{ id: string }>(
                    `${getApiUrl()}/chats`,
                    {
                        title: title,
                        model: selectedModelRef.current || 'glm-5',
                        mode: chatMode,
                        team_id: teamIdToSend,
                        project_id: activeChat?.project_id ?? initialProjectId,
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
        },
        [chatMode, selectedTeamId, setActiveChatID, activeChat],
    );

    // Define createMessage early so sendStreamingMessage can use it
    const createMessage = useCallback(
        async (
            text: string,
            chatID: string,
            attachmentIDs?: string[],
            webSearch?: boolean,
            role: string = 'user',
            contextItems?: any[],
        ) => {
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
                        context_items: contextItems, // Add context items to message
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
        },
        [],
    );

    // We need to update how `messages` is selected to support plugins
    const messagesSelector = useCallback(
        (state: any) => {
            if (pluginThreadMeta) {
                const pluginChatKey = `plugin_${pluginThreadMeta.provider}_${pluginThreadMeta.chatId}`;
                return state.chats[pluginChatKey] ?? EMPTY_MESSAGES;
            }
            return activeChatID
                ? state.chats[activeChatID] ?? EMPTY_MESSAGES
                : EMPTY_MESSAGES;
        },
        [activeChatID, pluginThreadMeta],
    );

    const storeMessages = useChatStore(messagesSelector);

    const sendStreamingMessage = useCallback(
        async (
            text: string,
            attachments: any[] = [],
            webSearch?: boolean,
            thinking?: string,
            reuseMessageId?: string,
            role: string = 'user',
            contextItems?: any[],
            chatIdOverride?: string,
        ) => {
            if (!text.trim() && attachments.length === 0) return;
            if (!user?.id) return;

            setError(null);

            const attachmentIDs = attachments.map(a => a.id);
            const modelAttachments = attachments.map(a => ({
                id: a.id,
                file_name: a.name,
                file_type: a.mimeType,
                size: a.size ?? 0,
                uri: a.uri,
            }));

            setLastFailedMessage({
                text: text.trim(),
                attachments: attachments,
                messageId: reuseMessageId,
                webSearch,
                thinking,
                contextItems,
            });

            let chatIdToUse = chatIdOverride || activeChatID;
            let messageID: string | undefined = reuseMessageId;
            const timestamp = Date.now();

            // Mark that we're about to generate — must be set BEFORE any await that
            // might trigger setActiveChatID (e.g. createChat), so the useEffect guard sees it.
            generatingForChatRef.current = chatIdToUse || 'pending';

            if (pluginThreadMeta) {
                // Plugin mode
                chatIdToUse = `plugin_${pluginThreadMeta.provider}_${pluginThreadMeta.chatId}`;
                // Using the provider ID for the socket routing if needed, but since we are in plugin mode,
                // we might need to route differently or just use the local display.
                // For now, let's assume we use the real ID for the socket too.
                chatIdToUse = String(pluginThreadMeta.chatId);

                // For plugin mode, we generate ID locally if not provided
                if (!messageID) {
                    messageID = generateId();
                }
            } else {
                if (!chatIdToUse || chatIdToUse === emptyChatID) {
                    chatIdToUse =
                        (await createChat('New Chat')) || activeChatID;
                    if (chatIdToUse) {
                        console.log(
                            '[ChatContext] New chat created, starting title generation for',
                            chatIdToUse,
                        );
                        generateChatTitle(text)
                            .then(title => {
                                if (title) {
                                    console.log(
                                        '[ChatContext] Title generated, renaming chat to:',
                                        title,
                                    );
                                    renameChat(chatIdToUse!, title);
                                } else {
                                    console.log(
                                        '[ChatContext] No title from generator (e.g. Android or fallback empty)',
                                    );
                                }
                            })
                            .catch(e => {
                                console.warn(
                                    '[ChatContext] Title generation failed:',
                                    e,
                                );
                            });
                        generateChatEmoji(text)
                            .then(emoji => {
                                if (emoji) {
                                    setChatIcon(chatIdToUse!, emoji);
                                }
                            })
                            .catch(e => {
                                console.warn(
                                    '[ChatContext] Emoji generation failed:',
                                    e,
                                );
                            });
                        // Classify new chat against projects
                        projectsApi
                            .list()
                            .then(projects => {
                                console.log(
                                    '[ProjectSuggest] projects loaded:',
                                    projects?.length ?? 0,
                                );
                                if (!projects || projects.length === 0)
                                    return null;
                                return classifyMessageForProject(
                                    text,
                                    projects,
                                );
                            })
                            .then(projectId => {
                                console.log(
                                    '[ProjectSuggest] classified:',
                                    projectId,
                                );
                                if (projectId) {
                                    setSuggestedProjectId(projectId);
                                    setClassifiedText(text);
                                }
                            })
                            .catch(e => {
                                console.warn('[ProjectSuggest] failed:', e);
                            });
                    }
                }

                // Also classify existing chats that have no project yet (first attempt only).
                if (
                    chatIdToUse &&
                    chatIdToUse !== emptyChatID &&
                    !activeChat?.project_id &&
                    !suggestedProjectId &&
                    classifiedChatIdRef.current !== chatIdToUse
                ) {
                    classifiedChatIdRef.current = chatIdToUse;
                    projectsApi
                        .list()
                        .then(projects => {
                            console.log(
                                '[ProjectSuggest] existing-chat projects loaded:',
                                projects?.length ?? 0,
                            );
                            if (!projects || projects.length === 0) return null;
                            return classifyMessageForProject(text, projects);
                        })
                        .then(projectId => {
                            console.log(
                                '[ProjectSuggest] existing-chat classified:',
                                projectId,
                            );
                            if (projectId) {
                                setSuggestedProjectId(projectId);
                                setClassifiedText(text);
                            }
                        })
                        .catch(e => {
                            console.warn(
                                '[ProjectSuggest] existing-chat failed:',
                                e,
                            );
                        });
                }

                if (!chatIdToUse) {
                    console.error(
                        'Failed to resolve chat id before sending message',
                    );
                    setError('Failed to create chat');
                    return;
                }

                if (!reuseMessageId) {
                    messageID = await createMessage(
                        text,
                        chatIdToUse,
                        attachmentIDs,
                        webSearch,
                        role,
                        contextItems,
                    );
                    if (!messageID) {
                        console.error(
                            'Failed to create message before sending via WebSocket',
                        );
                        setError('Failed to create message');
                        return;
                    }
                    setCurrentMessageID(messageID!);
                    setLastFailedMessage(prev =>
                        prev ? { ...prev, messageId: messageID } : null,
                    );

                    const userMessage: Message = {
                        id: messageID!,
                        chat_id: chatIdToUse!,
                        sender: user.id,
                        role: role,
                        text: text.trim(),
                        created_at: timestamp,
                        attachments: modelAttachments,
                        context_items: contextItems, // Include context items in message
                    };

                    // Update Store
                    useChatStore.getState().addMessage(chatIdToUse, {
                        message_id: messageID,
                        role: role,
                        message: text.trim(),
                        sender: user.id,
                        attachments: modelAttachments,
                        context_items: contextItems,
                        // eof: true // user message is complete
                    });
                } else {
                    console.log(
                        'Reusing existing message ID for retry:',
                        reuseMessageId,
                    );
                    setCurrentMessageID(reuseMessageId);
                }
            }

            const sessionId = `sess_${timestamp}`;

            generatingForChatRef.current = chatIdToUse;
            console.log(
                '[ChatContext] Setting assistantWorking=true, chatId=',
                chatIdToUse,
            );
            setAssistantWorking(true);

            // Use Global Socket
            if (!chatIdToUse || !messageID) {
                generatingForChatRef.current = null;
                setAssistantWorking(false);
                setError('Error sending message');
                return;
            }

            // Clear any existing timeout
            if (responseTimeoutRef.current) {
                clearTimeout(responseTimeoutRef.current);
                responseTimeoutRef.current = null;
            }

            // Safety-net timeout: if DONE/ERROR never arrives (e.g. connection lost),
            // auto-clear assistantWorking so the UI doesn't stay stuck forever.
            responseTimeoutRef.current = setTimeout(() => {
                generatingForChatRef.current = null;
                setAssistantWorking(current => {
                    if (current) {
                        setActiveAgentsCount(0);
                        reportMessageError(
                            'No response received. Check your connection and try again.',
                        );
                        responseTimeoutRef.current = null;
                        return false;
                    }
                    return current;
                });
            }, RESPONSE_TIMEOUT_MS);

            const selectedEndpoint = availableModels.find(
                m => m.id === (selectedModelRef.current ?? ''),
            )?.endpoint;

            // Prepare command (context) to send
            let commandToSend = teamCommand;
            if (!commandToSend && activeChat) {
                // If not in team mode, but we have list context, pass it
                if (activeChat.project_id) {
                    commandToSend = {
                        project_id: activeChat.project_id,
                        auth_token: token,
                    };
                }
            }

            // Read location for agent context.
            // If user attached a custom location context item, it takes precedence
            // over the stored location so the agent operates on the chosen point.
            let agentLocation: string | undefined;
            const attachedLocation = contextItems?.find(
                ci => ci.sourceType === 'location',
            );
            if (attachedLocation) {
                const { lat, lon } = attachedLocation.metadata ?? {};
                agentLocation =
                    lat != null && lon != null
                        ? `${attachedLocation.title} (${Number(lat).toFixed(
                              6,
                          )},${Number(lon).toFixed(6)})`
                        : attachedLocation.title;
            } else {
                try {
                    const loc = await getStoredLocation();
                    if (loc.shareWithAgent) {
                        agentLocation = loc.displayName;
                    }
                } catch {
                    // non-critical
                }
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
                selectedProviderRef.current,
                tools, // Pass enabled integrations to backend
                user.id, // user_id for backend routing
                selectedEndpoint,
                token ?? undefined, // auth_token for list/agent tools that call Go API
                commandToSend,
                contextItems, // Pass context items (emails, documents, etc.)
                agentLocation,
            );
        },
        [
            activeChatID,
            user?.id,
            pluginThreadMeta,
            createChat,
            createMessage,
            renameChat,
            setLastFailedMessage,
            tools,
            availableModels,
        ],
    );

    const sendMessageInternal = useCallback(
        async (
            text: string,
            attachments: any[] = [],
            webSearch?: boolean,
            thinking?: string,
            role: string = 'user',
            contextItems?: any[],
        ) => {
            // Lazy persistent chat creation for new sessions
            let persistentChatId: string | undefined;
            if (activeChatID === emptyChatID && isNewSession) {
                const created = await apiClient.post<{ id: string }>(
                    `${getApiUrl()}/chats`,
                    {
                        title: 'New Chat',
                        model: selectedModelRef.current || 'glm-5',
                        mode: 'agent',
                        type: 'persistent',
                    },
                );
                if (!created) return;
                persistentChatId = created.id;
                setActiveChatID(created.id);
                onSessionStarted?.();
                generateChatTitle(text)
                    .then(title => {
                        if (title) renameChat(persistentChatId!, title);
                    })
                    .catch(e => {
                        console.warn(
                            '[ChatContext] Persistent title generation failed:',
                            e,
                        );
                    });
                generateChatEmoji(text)
                    .then(emoji => {
                        if (emoji) setChatIcon(persistentChatId!, emoji);
                    })
                    .catch(() => {});
            }
            await sendStreamingMessage(
                text,
                attachments,
                webSearch,
                thinking,
                undefined,
                role,
                contextItems,
                persistentChatId,
            );
        },
        [
            activeChatID,
            isNewSession,
            onSessionStarted,
            sendStreamingMessage,
            setActiveChatID,
        ],
    );

    const sendMessage = useCallback(
        async (
            text: string,
            attachments?: any[],
            webSearch?: boolean,
            thinking?: string,
            role?: string,
            contextItems?: any[],
        ) => {
            if (isNewSession && !sessionClassified) {
                try {
                    const projects = await projectsApi.list();
                    if (projects && projects.length > 0) {
                        const projectId = await classifyMessageForProject(
                            text,
                            projects,
                        );
                        if (projectId) {
                            const matched =
                                projects.find(p => p.id === projectId) ?? null;
                            if (matched) {
                                setPendingMessage(text);
                                setSuggestedProjectForSession(matched);
                                return;
                            }
                        }
                    }
                } catch (e) {
                    console.warn(
                        '[SessionClassify] classification failed, sending anyway:',
                        e,
                    );
                }
                setSessionClassified(true);
            }
            sendMessageInternal(
                text,
                attachments,
                webSearch,
                thinking,
                role,
                contextItems,
            );
        },
        [isNewSession, sessionClassified, sendMessageInternal],
    );

    const clearProjectSuggestionForSession = useCallback(() => {
        const text = pendingMessage;
        setPendingMessage(null);
        setSuggestedProjectForSession(null);
        setSessionClassified(true);
        if (text) {
            sendMessageInternal(text);
        }
    }, [pendingMessage, sendMessageInternal]);

    const confirmProjectSuggestionForSession = useCallback(() => {
        setPendingMessage(null);
        setSuggestedProjectForSession(null);
    }, []);

    const retryLastMessage = useCallback(() => {
        if (lastFailedMessage) {
            setIsRateLimited(false);
            setError(null);
            sendStreamingMessage(
                lastFailedMessage.text,
                lastFailedMessage.attachments,
                lastFailedMessage.webSearch,
                lastFailedMessage.thinking,
                lastFailedMessage.messageId, // reusing the message ID!
                'user',
                lastFailedMessage.contextItems,
            );
        }
    }, [lastFailedMessage, sendStreamingMessage]);

    const handleClientAction = useCallback(
        async (payload: any) => {
            console.log('[ChatContext] Handling client action:', payload);

            const { call_id: callId, tool, method, params } = payload;

            try {
                const { clientToolExecutor } = await import(
                    '../../services/tools/ClientToolExecutor'
                );

                const result = await clientToolExecutor.execute({
                    tool,
                    method,
                    params: params || {},
                });

                console.log(
                    '[ChatContext] ✅ Tool executed successfully, result:',
                    result?.substring(0, 200),
                );

                if (callId) {
                    console.log(
                        '[ChatContext] 📤 Sending result to server via REST API...',
                    );
                    const { sendClientToolResult } = await import(
                        '../../apiClient'
                    );
                    await sendClientToolResult(activeChatID, callId, result);
                    console.log(
                        '[ChatContext] ✅ Round-trip: sent client tool result for call_id=',
                        callId,
                    );
                } else {
                    console.log(
                        '[ChatContext] ⚠️ No callId, sending result as system message',
                    );
                    await sendMessage(
                        `[System] Tool ${tool}.${method} Output:\n${result}`,
                        [],
                        false,
                        undefined,
                        'system',
                    );
                }
            } catch (error: any) {
                const errMsg = error?.message ?? String(error);
                if (callId) {
                    const { sendClientToolResult } = await import(
                        '../../apiClient'
                    );
                    await sendClientToolResult(
                        activeChatID,
                        callId,
                        `Error: ${errMsg}`,
                    );
                } else {
                    await sendMessage(
                        `[System] Tool ${tool}.${method} Failed: ${errMsg}`,
                        [],
                        false,
                        undefined,
                        'system',
                    );
                }
            }
        },
        [sendMessage, activeChatID],
    );

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
        setLastFailedMessage(null); // Release retained attachment URIs and context items
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
                modeToUse =
                    sidebarFilter === 'all' ||
                    sidebarFilter === 'agent' ||
                    sidebarFilter === 'planner'
                        ? 'agent'
                        : 'team';
                teamIdToUse = modeToUse === 'team' ? sidebarFilter : null;
            }

            setChatMode(modeToUse);
            if (teamIdToUse) {
                selectTeam(teamIdToUse);
            }
            newChatInitializedRef.current = true;
        } else if (activeChat) {
            newChatInitializedRef.current = false;

            // Check for initial message from pendingChatMode if it was just set
            if (
                pendingChatMode?.initialMessage &&
                activeChatID === activeChat.id
            ) {
                const initialMsg = pendingChatMode.initialMessage;
                // Clear it from state to prevent double-sending
                clearPendingChatMode?.();

                // Send after a short delay to ensure socket initialization
                setTimeout(() => {
                    console.log(
                        'Sending initial message for task-linked chat:',
                        initialMsg,
                    );
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
    }, [
        activeChatID,
        getMessages,
        pluginThreadMeta,
        activeChat,
        pendingChatMode,
        sidebarFilter,
        sendMessage,
        clearPendingChatMode,
    ]);

    // Fetch available models on mount with retry.
    // Retry timer IDs are tracked so they can be cancelled on unmount.
    const modelsRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
        null,
    );

    useEffect(() => {
        let mounted = true;
        const fetchModels = async (retryCount = 0) => {
            try {
                const models = await modelsApi.getModels();
                if (mounted && models && models.length > 0) {
                    setAvailableModels(models);
                    // Set first model as default if no selection has been made yet
                    if (
                        !manualModelSelectionRef.current &&
                        !selectedModelRef.current
                    ) {
                        setSelectedModel(models[0].id, false);
                    }
                    // Initialize provider ref for default model (or currently selected)
                    const current =
                        selectedModelRef.current || models[0]?.id || 'glm-5';
                    selectedProviderRef.current = models.find(
                        m => m.id === current,
                    )?.provider;
                } else if (mounted && retryCount < 3) {
                    console.log(
                        `Fetch models returned empty list, retrying... (${
                            retryCount + 1
                        }/3)`,
                    );
                    modelsRetryTimerRef.current = setTimeout(
                        () => fetchModels(retryCount + 1),
                        2000 * (retryCount + 1),
                    );
                }
            } catch (error) {
                console.error('Failed to fetch models:', error);
                if (mounted && retryCount < 3) {
                    console.log(
                        `Fetch models failed, retrying... (${
                            retryCount + 1
                        }/3)`,
                    );
                    modelsRetryTimerRef.current = setTimeout(
                        () => fetchModels(retryCount + 1),
                        2000 * (retryCount + 1),
                    );
                }
            }
        };
        fetchModels();
        return () => {
            mounted = false;
            if (modelsRetryTimerRef.current) {
                clearTimeout(modelsRetryTimerRef.current);
                modelsRetryTimerRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (chatMode !== 'team') return;

        const team =
            AVAILABLE_TEAMS.find(t => t.id === selectedTeamId) ||
            AVAILABLE_TEAMS[0];
        if (!team) return;
        const baseCommand = team.command;

        const next = {
            ...baseCommand,
            model: selectedModel || baseCommand.model,
            auth_token: token,
        };

        setTeamCommand((prev: any) => {
            try {
                if (JSON.stringify(prev) === JSON.stringify(next)) return prev;
            } catch {
                /* ignore */
            }
            return next;
        });
    }, [chatMode, selectedModel, selectedTeamId, token, activeChat]);

    // WebSocket lifecycle is now handled globally in App.tsx
    // But we still want to attach listeners for specific events like Done/Error?
    // The store updates automatically.
    // We can use a side effect to track "assistantWorking".

    useEffect(() => {
        // Clear timeout on unmount
        return () => {
            if (responseTimeoutRef.current) {
                clearTimeout(responseTimeoutRef.current);
                responseTimeoutRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        // We set handlers to the global socket to update local state like 'assistantWorking'
        socket.setHandlers({
            onDone: () => {
                // Clear timeout synchronously (not UI work)
                if (responseTimeoutRef.current) {
                    clearTimeout(responseTimeoutRef.current);
                    responseTimeoutRef.current = null;
                }
                generatingForChatRef.current = null;
                // Mark as low-priority transition so in-flight gestures aren't interrupted
                startTransition(() => {
                    setAssistantWorking(false);
                    setActiveAgentsCount(0);
                    setGenerationStatus(null);
                });
            },
            onSignal: (frame: any) => {
                const signalPayload = frame?.payload;
                if (
                    signalPayload?.type === 'system_status' &&
                    typeof signalPayload?.active_agents_count === 'number'
                ) {
                    setActiveAgentsCount(signalPayload.active_agents_count);
                }
                if (signalPayload?.type === 'generation_status') {
                    startTransition(() => {
                        setGenerationStatus(signalPayload.status ?? null);
                    });
                }
            },
            onError: (err: any) => {
                // Clear timeout synchronously
                if (responseTimeoutRef.current) {
                    clearTimeout(responseTimeoutRef.current);
                    responseTimeoutRef.current = null;
                }
                generatingForChatRef.current = null;
                startTransition(() => {
                    setAssistantWorking(false);
                    setActiveAgentsCount(0);
                    setGenerationStatus(null);
                });
                // Extract error message from frame
                let message = 'Connection error';
                if (err?.error?.message) {
                    message = err.error.message;
                } else if (err?.message) {
                    message = err.message;
                } else if (typeof err === 'string') {
                    message = err;
                }
                // Show error details if available
                if (err?.error?.details) {
                    console.error('Error details:', err.error.details);
                }
                setIsRateLimited(err?.error?.isRateLimited === true);
                reportMessageError(message);
            },
            onUnauthorized: async () => {
                return await refreshToken();
            },
            onMeta: (frame: Frame) => {
                if (frame.payload?.type === 'chat_update') {
                    getChats({ preserveActiveChat: true });
                }
            },
            onMessage: (frame: Frame) => {
                const payload = frame.payload;
                if (payload?.type === 'client_action') {
                    console.log(
                        '[ChatContext] Received client_action, executing locally:',
                        payload.tool,
                        payload.method,
                        payload.params,
                    );
                    handleClientAction(payload);
                }
            },
            onReconnect: () => {
                // Skip reset if this reconnect was triggered by chat creation
                // during active generation (sendStreamingMessage flow)
                if (skipReconnectResetRef.current) {
                    skipReconnectResetRef.current = false;
                    return;
                }
                // Socket reconnected after interruption — any in-progress generation was
                // likely lost. Clear loading state so the UI doesn't stay stuck.
                // The final message (if completed) is persisted in DB and will load on refresh.
                if (responseTimeoutRef.current) {
                    clearTimeout(responseTimeoutRef.current);
                    responseTimeoutRef.current = null;
                }
                startTransition(() => {
                    setAssistantWorking(false);
                    setActiveAgentsCount(0);
                    setGenerationStatus(null);
                });
            },
        });

        // Clear handlers on unmount to prevent stale closures from referencing
        // unmounted component state (setAssistantWorking, setError, etc.)
        return () => {
            socket.setHandlers({});
        };
    }, [refreshToken, getChats, handleClientAction, reportMessageError]);

    // Clear "Assistant is thinking" when DONE is received on user channel (or any socket).
    useEffect(() => {
        const unsubscribe = subscribeGenerationDone(chatId => {
            if (chatId === activeChatID) {
                if (responseTimeoutRef.current) {
                    clearTimeout(responseTimeoutRef.current);
                    responseTimeoutRef.current = null;
                }
                // Flush final streaming state before transitioning UI
                useChatStore.getState().flushPendingUpdates(chatId);

                // Fire-and-forget: extract action buttons from final assistant text via AFM (iOS only)
                const msgs = useChatStore.getState().chats[chatId] ?? [];
                const lastAssistant = [...msgs]
                    .reverse()
                    .find(m => m.role === 'assistant');
                if (lastAssistant?.text) {
                    extractActions(lastAssistant.text)
                        .then(actions => {
                            if (actions.length > 0) {
                                useChatStore
                                    .getState()
                                    .appendActions(
                                        chatId,
                                        lastAssistant.id,
                                        actions,
                                    );
                            }
                        })
                        .catch(() => {});
                }

                generatingForChatRef.current = null;
                startTransition(() => {
                    setAssistantWorking(false);
                    setActiveAgentsCount(0);
                    setGenerationStatus(null);
                });
            }
        });
        return unsubscribe;
    }, [activeChatID]);

    const refreshPluginThread = useCallback(async () => {
        if (!pluginThreadMeta) return;
        try {
            const resp = await sidebarApi.getChatMessages(
                pluginThreadMeta.provider,
                pluginThreadMeta.chatId,
                pluginThreadMeta.integrationId,
            );
            const converted = (resp?.messages || []).map(msg =>
                mapPluginMessage(msg, pluginThreadMeta.provider),
            );
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

    const startPluginThread = useCallback(
        async ({
            provider,
            chatId,
            title,
            integrationId,
            integrationName,
            messages: preloadedMessages,
        }: {
            provider: string;
            chatId: string | number;
            title?: string | null;
            integrationId?: string;
            integrationName?: string | null;
            messages?: any[];
        }) => {
            setPluginThreadMeta({
                provider,
                chatId,
                integrationId,
                integrationName,
            });
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
                    const resp = await sidebarApi.getChatMessages(
                        provider,
                        chatId,
                        integrationId,
                    );
                    incomingMessages = resp?.messages || [];
                }
                const converted = (incomingMessages || []).map(msg =>
                    mapPluginMessage(msg, provider),
                );
                // Update Store for this plugin chat
                // Key: String(chatId) which is the real ID
                setMessagesToStore(String(chatId), converted);
            } catch (err) {
                console.error('Failed to load plugin chat on start', err);
            }
        },
        [
            setActiveChatID,
            mapPluginMessage,
            setChatMode,
            setTeamCommand,
            setMessagesToStore,
        ],
    );

    const clearPluginThread = useCallback(() => {
        setPluginThreadMeta(null);
        setExternalTitle(null);
        // Messages will clear because selector depends on pluginThreadMeta
    }, []);

    const executeMessageAction = useCallback(
        async (action: any, messageId: string) => {
            console.log(
                '[ChatContext] Executing action:',
                action.label,
                'for message:',
                messageId,
            );
            // For now, just send the action label as a new message
            await sendMessage(
                action.label || action.action,
                [],
                false,
                undefined,
                'user',
            );
        },
        [sendMessage],
    );

    const stopGeneration = useCallback(() => {
        console.log('Stopping generation');
        if (activeChatID) {
            socket.sendStop(activeChatID);
        }
        generatingForChatRef.current = null;
        setAssistantWorking(false);
    }, [activeChatID]);

    const value: ChatContextType = {
        messages: storeMessages, // Use the selected messages
        messagesLoading,
        getMessages,
        refreshing,
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
        isRateLimited,
        setIsRateLimited,
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
        activeAgentsCount,
        pendingInputText,
        setPendingInputText,
        lastFailedMessage,
        setLastFailedMessage,
        generationStatus,
        suggestedProjectId,
        classifiedText,
        clearProjectSuggestion: () => {
            setSuggestedProjectId(null);
            setClassifiedText(null);
        },
        pendingMessage,
        suggestedProjectForSession,
        sessionClassified,
        clearProjectSuggestionForSession,
        confirmProjectSuggestionForSession,
    };

    return (
        <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
    );
}
