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
import { AppState, InteractionManager } from 'react-native';
import { ChatContextType, Props, Model, DetailLevel } from './models';
import { useAuth } from '../auth/context.tsx';
import { socket } from '../../socket';
import { getApiUrl } from '../../config.ts';
import { modelsApi, sidebarApi, projectsApi, tasksApi } from '../../apiClient';
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
import { generateFollowUps } from '../../services/suggestionGenerator';
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
    const responseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
        null,
    );
    const generatingForChatRef = useRef<string | null>(null);
    const skipReconnectResetRef = useRef(false);
    // Reconciliation: id of the message currently being auto-resent (re-entrancy guard),
    // and a ref to the reconcile fn so callbacks defined earlier (getMessages) can call it.
    const reconcilingRef = useRef<string | null>(null);
    const reconcileRef = useRef<((chatId?: string) => void) | null>(null);
    // Ref to getMessages so socket-handler closures (onReconnect) and the
    // AppState listener can re-fetch the active chat without stale closures.
    const getMessagesRef = useRef<
        ((chatID: string, opts?: { isRefresh?: boolean }) => void) | null
    >(null);
    // Set when a reconnect happens mid-generation: arms a fallback timer so we
    // only treat the generation as dead (clear + reconcile) if no frame/DONE
    // arrives before it fires. Cleared by DONE/error/frames.
    const reconnectGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
        null,
    );
    // Latest activeChatID for socket-handler closures (their effect deps don't
    // include activeChatID, so the closure value would otherwise be stale).
    const activeChatIDRef = useRef<string>(activeChatID);
    activeChatIDRef.current = activeChatID;

    // Pending slash-command calls: frameId → {resolve, reject}
    const pendingCommandCallsRef = useRef<
        Map<
            number,
            {
                resolve: (
                    r: import('../../commands/types').CommandResult,
                ) => void;
                reject: (e: Error) => void;
            }
        >
    >(new Map());
    // Grace window before treating a mid-generation reconnect as a dead
    // generation. Long enough for the room's replay buffer + live frames to
    // arrive, short enough that a truly-dropped turn still gets re-sent.
    const RECONNECT_GRACE_MS = 25_000;
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
                // Remember the user's explicit choice globally so new chats
                // default to it. Only manual picks are persisted — models
                // auto-loaded from history must not overwrite the default.
                AsyncStorage.setItem('@genie_selected_model', model).catch(
                    () => {},
                );
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
    const { activeChat, sidebarFilter, renameChat, setChatIcon, getChats } =
        useMain();

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

    // Reconstruct in-chat task cards when (re)opening a chat. Live task_progress
    // frames are ephemeral, but background tasks are persisted server-side and
    // attached to a chat, so seed a card per task belonging to this chat. For
    // tasks awaiting approval, recover the pending request_id from their events.
    useEffect(() => {
        if (!activeChatID || activeChatID === emptyChatID || !token) return;
        let cancelled = false;
        (async () => {
            try {
                const all = await tasksApi.list();
                if (cancelled || !Array.isArray(all)) return;
                const mine = all.filter(t => t.chat_id === activeChatID);
                for (const t of mine) {
                    let approvalRequestId: string | undefined;
                    if (t.status === 'waiting_input') {
                        try {
                            const detail = await tasksApi.get(t.id);
                            if (cancelled) return;
                            const req = (detail?.events ?? [])
                                .filter(e => e.kind === 'approval_request')
                                .pop();
                            approvalRequestId = req?.payload?.request_id;
                        } catch {
                            // Fall through without approval controls.
                        }
                    }
                    if (cancelled) return;
                    useChatStore.getState().upsertTaskProgress(activeChatID, {
                        task_id: t.id,
                        goal: t.goal,
                        status: t.status,
                        plan: t.plan,
                        finished: !!t.finished_at,
                        result: t.result,
                        created_at: t.created_at,
                        ...(approvalRequestId
                            ? {
                                  event: {
                                      kind: 'approval_request',
                                      payload: {
                                          request_id: approvalRequestId,
                                      },
                                  },
                              }
                            : {}),
                    });
                }
            } catch {
                // Non-fatal: cards will still appear from live frames.
            }
        })();
        return () => {
            cancelled = true;
        };
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
            // A generation is streaming into this chat right now. The DB snapshot
            // only has the user turn (the assistant reply isn't persisted until
            // DONE), so replacing the store here would wipe the in-flight assistant
            // bubble and the live frames would rebuild it from empty — looking like
            // a brand-new generation. Skip; the store already holds the latest, and
            // the resume path re-fetches once generation clears.
            if (generatingForChatRef.current === chatID) {
                console.log(
                    '[ChatContext] Skipping getMessages refresh — generation in flight for',
                    chatID,
                );
                return;
            }
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

                // History loaded: if it ends on an unanswered user turn (interrupted
                // before a reply, not stopped), auto-resend it.
                reconcileRef.current?.(chatID);

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
    getMessagesRef.current = getMessages;

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
                    // A new user turn invalidates any follow-up chips from the previous reply.
                    useChatStore.getState().clearFollowUps(chatIdToUse);
                    // Awaiting an assistant response — eligible for reconciliation
                    // (auto-resend) if the turn is interrupted before a reply.
                    if (role === 'user') {
                        useChatStore
                            .getState()
                            .setMessageStatus(
                                chatIdToUse,
                                messageID!,
                                'pending',
                            );
                    }
                } else {
                    console.log(
                        'Reusing existing message ID for retry:',
                        reuseMessageId,
                    );
                    setCurrentMessageID(reuseMessageId);
                    if (role === 'user' && chatIdToUse) {
                        useChatStore
                            .getState()
                            .setMessageStatus(
                                chatIdToUse,
                                reuseMessageId,
                                'pending',
                            );
                    }
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
                        // Transport-level stall: keep the user message in place marked
                        // 'pending' so reconciliation auto-resends it once the socket
                        // reconnects, rather than dropping it. Surface a soft notice.
                        if (chatIdToUse && messageID) {
                            useChatStore
                                .getState()
                                .setMessageStatus(
                                    chatIdToUse,
                                    messageID,
                                    'pending',
                                );
                        }
                        setError(
                            'No response received. It will retry automatically when the connection is restored.',
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

    const sendMessage = sendMessageInternal;

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

    // Guaranteed delivery: if the last message in a chat is an unanswered user
    // message (interrupted before a reply, not explicitly stopped), auto-resend it
    // reusing the same message ID (idempotent server-side). Runs on chat open,
    // app resume, and socket reconnect.
    const reconcileLastMessage = useCallback(
        (chatId?: string) => {
            const cid = chatId || activeChatID;
            if (!cid || cid === emptyChatID) return;
            if (pluginThreadMeta) return;
            // A generation is genuinely in flight — don't double-send.
            if (generatingForChatRef.current) return;

            const last = useChatStore.getState().getLastMessage(cid);
            if (!last || last.role !== 'user') return;
            // Answered, explicitly stopped, or already being resent → skip.
            if (last.status === 'complete') return;
            if (last.stopped_at) return;
            if (reconcilingRef.current === last.id) return;

            reconcilingRef.current = last.id;
            console.log(
                '[ChatContext] Reconciling unanswered user message',
                last.id,
            );
            sendStreamingMessage(
                last.text,
                last.attachments ?? [],
                undefined,
                undefined,
                last.id, // reuse the existing ID — server upsert is idempotent
                'user',
                last.context_items,
                cid,
            );
        },
        [activeChatID, pluginThreadMeta, sendStreamingMessage],
    );
    reconcileRef.current = reconcileLastMessage;

    const handleClientAction = useCallback(
        async (payload: any, sourceChatId?: string) => {
            console.log('[ChatContext] Handling client action:', payload);

            const { call_id: callId, tool, method, params } = payload;

            // Dedupe across connections: the same client_action can arrive on
            // both this chat socket and the always-on user-channel device
            // listener. Claim the call_id so it executes exactly once.
            const { claimClientAction } = await import(
                '../../services/deviceActions/dedupe'
            );
            if (!claimClientAction(callId)) {
                console.log(
                    '[ChatContext] Skipping already-claimed client_action call_id=',
                    callId,
                );
                return;
            }

            // Reply on the chat/session the action originated from (the frame's
            // chat_id), NOT the chat the user happens to have open. For actions
            // originating from a server-side flow (e.g. Telegram), the originating
            // session_id differs from activeChatID; replying on activeChatID would
            // publish the result to the wrong Redis channel and the brain would
            // never receive it (round-trip timeout). Falls back to activeChatID
            // for the normal in-app flow where they are identical.
            const replyChatId = sourceChatId || activeChatID;

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
                    await sendClientToolResult(replyChatId, callId, result);
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
                        replyChatId,
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

        // Sync mode from active chat. For a fresh empty chat, derive mode
        // from the current sidebar filter.
        if (activeChatID === emptyChatID) {
            if (newChatInitializedRef.current) {
                return;
            }

            const modeToUse: 'agent' | 'team' =
                sidebarFilter === 'all' ||
                sidebarFilter === 'agent' ||
                sidebarFilter === 'planner'
                    ? 'agent'
                    : 'team';
            const teamIdToUse: string | null =
                modeToUse === 'team' ? sidebarFilter : null;

            setChatMode(modeToUse);
            if (teamIdToUse) {
                selectTeam(teamIdToUse);
            }
            newChatInitializedRef.current = true;
        } else if (activeChat) {
            newChatInitializedRef.current = false;

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
        sidebarFilter,
        sendMessage,
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
                    // Pick a default if no selection has been made yet:
                    // prefer the last model the user chose globally (when it
                    // still exists), otherwise fall back to the first model.
                    if (
                        !manualModelSelectionRef.current &&
                        !selectedModelRef.current
                    ) {
                        let preferred: string | null = null;
                        try {
                            const saved = await AsyncStorage.getItem(
                                '@genie_selected_model',
                            );
                            if (saved && models.some(m => m.id === saved)) {
                                preferred = saved;
                            }
                        } catch {
                            /* ignore — fall back to first model */
                        }
                        setSelectedModel(preferred ?? models[0].id, false);
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
            if (reconnectGraceTimerRef.current) {
                clearTimeout(reconnectGraceTimerRef.current);
                reconnectGraceTimerRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        // We set handlers to the global socket to update local state like 'assistantWorking'
        socket.setHandlers({
            onDone: (frame: any) => {
                // Intercept slash-command results before normal chat DONE handling.
                // GoWSClient overwrites frame.id with a per-chat monotonic id,
                // so the request/response id correlation rides on corr_id (or
                // meta.command_result.request_id as a fallback).
                const commandResult = frame?.payload?.meta?.command_result;
                if (commandResult !== undefined) {
                    const corrRaw = frame?.corr_id ?? commandResult?.request_id;
                    const corrId =
                        typeof corrRaw === 'string' ? Number(corrRaw) : corrRaw;
                    const pending =
                        corrId != null
                            ? pendingCommandCallsRef.current.get(corrId)
                            : undefined;
                    if (pending) {
                        pendingCommandCallsRef.current.delete(corrId);
                        pending.resolve(commandResult);
                    } else {
                        console.warn(
                            '[ChatCtx] command_result received but no pending entry',
                            {
                                frameId: frame?.id,
                                corrId,
                                pendingKeys: Array.from(
                                    pendingCommandCallsRef.current.keys(),
                                ),
                            },
                        );
                    }
                    return;
                }
                // Clear timeout synchronously (not UI work)
                if (responseTimeoutRef.current) {
                    clearTimeout(responseTimeoutRef.current);
                    responseTimeoutRef.current = null;
                }
                // Generation resolved — cancel any reconnect recovery fallback.
                if (reconnectGraceTimerRef.current) {
                    clearTimeout(reconnectGraceTimerRef.current);
                    reconnectGraceTimerRef.current = null;
                }
                generatingForChatRef.current = null;
                reconcilingRef.current = null;
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
                // Live progress for a background task spawned from this chat →
                // upsert its in-chat card. Sync delegations never publish here.
                if (signalPayload?.type === 'task_progress') {
                    const chatId = frame?.chat_id ?? signalPayload.chat_id;
                    if (chatId) {
                        useChatStore
                            .getState()
                            .upsertTaskProgress(chatId, signalPayload);
                    }
                }
            },
            onError: (err: any) => {
                // Clear timeout synchronously
                if (responseTimeoutRef.current) {
                    clearTimeout(responseTimeoutRef.current);
                    responseTimeoutRef.current = null;
                }
                if (reconnectGraceTimerRef.current) {
                    clearTimeout(reconnectGraceTimerRef.current);
                    reconnectGraceTimerRef.current = null;
                }
                generatingForChatRef.current = null;
                reconcilingRef.current = null;
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
                // A live frame after a mid-generation reconnect proves the
                // generation is still alive (replay or fresh tokens). Cancel the
                // recovery fallback so it can't tear down a healthy long stream;
                // DONE/error will resolve it normally.
                if (reconnectGraceTimerRef.current) {
                    clearTimeout(reconnectGraceTimerRef.current);
                    reconnectGraceTimerRef.current = null;
                }
                const payload = frame.payload;
                if (payload?.type === 'client_action') {
                    console.log(
                        '[ChatContext] Received client_action, executing locally:',
                        payload.tool,
                        payload.method,
                        payload.params,
                    );
                    // Pass the frame's chat_id so the result round-trips on the
                    // originating session's channel (e.g. a Telegram-sourced action),
                    // not whatever chat is currently open in the app.
                    handleClientAction(payload, frame.chat_id);
                }
            },
            onReconnect: () => {
                // Skip reset if this reconnect was triggered by chat creation
                // during active generation (sendStreamingMessage flow)
                if (skipReconnectResetRef.current) {
                    skipReconnectResetRef.current = false;
                    return;
                }
                if (responseTimeoutRef.current) {
                    clearTimeout(responseTimeoutRef.current);
                    responseTimeoutRef.current = null;
                }
                const generatingChat = generatingForChatRef.current;
                if (generatingChat) {
                    // A generation was in flight. Don't tear it down: the room
                    // replays its buffered frames (and continues streaming live)
                    // to a client that re-joins while generation is in progress.
                    // Keep the loader and let those frames flow in. Only if the
                    // grace window elapses with no DONE/error (generation truly
                    // died on the dropped connection) do we clear + reconcile.
                    console.log(
                        '[ChatContext] Reconnected mid-generation — awaiting replay for',
                        generatingChat,
                    );
                    if (reconnectGraceTimerRef.current) {
                        clearTimeout(reconnectGraceTimerRef.current);
                    }
                    reconnectGraceTimerRef.current = setTimeout(() => {
                        reconnectGraceTimerRef.current = null;
                        if (!generatingForChatRef.current) return; // already resolved
                        console.warn(
                            '[ChatContext] Reconnect grace elapsed — generation appears dead, recovering',
                        );
                        const cid = generatingForChatRef.current;
                        generatingForChatRef.current = null;
                        reconcilingRef.current = null;
                        startTransition(() => {
                            setAssistantWorking(false);
                            setActiveAgentsCount(0);
                            setGenerationStatus(null);
                        });
                        // Re-fetch from DB (loads the reply if it actually
                        // completed) — getMessages reconciles an unanswered turn.
                        const target =
                            typeof cid === 'string' && cid !== 'pending'
                                ? cid
                                : activeChatIDRef.current;
                        if (target) {
                            getMessagesRef.current?.(target, {
                                isRefresh: true,
                            });
                        } else {
                            reconcileRef.current?.();
                        }
                    }, RECONNECT_GRACE_MS);
                    return;
                }
                // No generation believed in flight. The reply (if one completed
                // while we were disconnected) is persisted in the DB but not yet
                // in the local store — re-fetch the active chat so it shows up.
                // getMessages also reconciles an unanswered user turn.
                reconcilingRef.current = null;
                startTransition(() => {
                    setAssistantWorking(false);
                    setActiveAgentsCount(0);
                    setGenerationStatus(null);
                });
                const cid = activeChatIDRef.current;
                if (cid && cid !== emptyChatID) {
                    getMessagesRef.current?.(cid, { isRefresh: true });
                } else {
                    reconcileRef.current?.();
                }
            },
        });

        // Clear handlers on unmount to prevent stale closures from referencing
        // unmounted component state (setAssistantWorking, setError, etc.)
        return () => {
            socket.setHandlers({});
        };
    }, [
        refreshToken,
        getChats,
        handleClientAction,
        reportMessageError,
        reconcileLastMessage,
    ]);

    // App resume: re-fetch the active chat so a reply that completed while we
    // were backgrounded shows up, and auto-resend an unanswered user turn.
    // Covers the case where the socket stayed connected through a brief
    // background and no onReconnect fired. getMessages is a no-op while a
    // generation is in flight (guarded) and reconciles internally after loading;
    // fall back to a bare reconcile when there's no concrete chat to refresh.
    useEffect(() => {
        const sub = AppState.addEventListener('change', state => {
            if (state === 'active') {
                const cid = activeChatIDRef.current;
                if (cid && cid !== emptyChatID) {
                    getMessagesRef.current?.(cid, { isRefresh: true });
                } else {
                    reconcileRef.current?.();
                }
            }
        });
        return () => sub.remove();
    }, []);

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
                // In team mode the reply lives in content_parts (member_response /
                // text), not in `.text` (which stays a placeholder). Reconstruct it.
                const assistantText = (() => {
                    const direct = (lastAssistant?.text ?? '').trim();
                    if (direct) return direct;
                    return (lastAssistant?.content_parts ?? [])
                        .filter(
                            (p: any) =>
                                p?.type === 'text' ||
                                p?.type === 'member_response',
                        )
                        .map((p: any) => p?.text ?? '')
                        .join('\n')
                        .trim();
                })();
                if (lastAssistant && assistantText) {
                    // Generate follow-up chips FIRST (user-visible) — Apple FM runs
                    // one request at a time, so whatever is enqueued first wins the
                    // model. Action-button extraction follows.
                    const lastUser = [...msgs]
                        .reverse()
                        .find(m => m.role === 'user');
                    if (__DEV__) {
                        console.log(
                            '[FollowUps] generating for',
                            chatId,
                            'replyLen=',
                            assistantText.length,
                        );
                    }
                    generateFollowUps(assistantText, lastUser?.text)
                        .then(items => {
                            if (__DEV__) {
                                console.log(
                                    '[FollowUps] got',
                                    items.length,
                                    'item(s) for',
                                    chatId,
                                    items,
                                );
                            }
                            if (items.length > 0) {
                                useChatStore
                                    .getState()
                                    .setFollowUps(chatId, items);
                            }
                        })
                        .catch(e => {
                            if (__DEV__) {
                                console.log('[FollowUps] error', e);
                            }
                        });

                    // Fire-and-forget: extract action buttons from final assistant text via AFM (iOS only)
                    extractActions(assistantText)
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
            // User explicitly stopped: mark the trailing user message handled so
            // reconciliation does not auto-resend it. The server also persists
            // stopped_at, which covers a cold reload.
            const last = useChatStore.getState().getLastMessage(activeChatID);
            if (last && last.role === 'user' && last.status === 'pending') {
                useChatStore
                    .getState()
                    .setMessageStatus(activeChatID, last.id, 'complete');
            }
        }
        generatingForChatRef.current = null;
        setAssistantWorking(false);
    }, [activeChatID]);

    // ── Slash-command execution ──────────────────────────────────────────
    const runCommand = useCallback(
        async (
            name: string,
            args: object,
        ): Promise<import('../../commands/types').CommandResult> => {
            // 1) Resolve a real chat id. On the welcome screen activeChatID is
            //    the emptyChatID sentinel; create the persistent chat now so
            //    the brain can route the command.
            let chatId = activeChatIDRef.current;
            if (chatId === emptyChatID) {
                const created = await apiClient.post<{ id: string }>(
                    `${getApiUrl()}/chats`,
                    {
                        title: 'New Chat',
                        model: selectedModelRef.current || 'glm-5',
                        mode: 'agent',
                        type: isNewSession ? 'persistent' : undefined,
                    },
                );
                if (!created?.id) {
                    throw new Error('failed to create chat for command');
                }
                chatId = created.id;
                setActiveChatID(chatId);
                if (isNewSession) onSessionStarted?.();
            }
            if (!chatId || chatId === emptyChatID) {
                throw new Error('no active chat for command');
            }

            // 1a) Pin the user's chosen model against the activeChatID-change
            //     effect that resets it to default when chat history is empty.
            const pinnedModel = selectedModelRef.current;

            // 1b) Optimistic bubble: push a local user message with the
            //     command_call marker so the user sees the action immediately.
            //     useGiftedChatRenderers reads message.meta.command_call (see
            //     `if (currentMessage?.meta?.command_call === true)`), not
            //     `metadata`, so push into `meta` here.
            try {
                const store = useChatStore.getState();
                const existing = store.chats[chatId] ?? [];
                store.setMessages(chatId, [
                    ...existing,
                    {
                        id: generateId(),
                        chat_id: chatId,
                        sender: user?.id ?? '',
                        role: 'user',
                        text: '',
                        created_at: Date.now(),
                        // status:'complete' so reconcileLastMessage doesn't
                        // treat this as an unanswered user message and resend
                        // it via sendStreamingMessage — which would spawn a
                        // new chat and reset the model.
                        status: 'complete',
                        meta: { command_call: true, name, args } as any,
                    } as any,
                ]);
                console.log('[ChatCtx] optimistic command bubble pushed', {
                    chatId,
                    name,
                });
            } catch (e) {
                console.warn('[ChatCtx] optimistic command bubble failed', e);
            }

            // 2) Ensure the socket is open on the chat channel for this chatId.
            //    The activeChatID useEffect would do this on the next render,
            //    but our async runCommand can't wait for React's effect cycle.
            socket.setChannel('chat');
            socket.setChatId(chatId);
            if (!socket.isReady()) {
                socket.connect();
                const deadline = Date.now() + 5000;
                while (!socket.isReady() && Date.now() < deadline) {
                    await new Promise(r => setTimeout(r, 100));
                }
                if (!socket.isReady()) {
                    throw new Error('socket failed to connect for command');
                }
            }

            // 3) Send the frame and register the resolver for the matching DONE.
            const resolvedChatId = chatId;
            const result = await new Promise<
                import('../../commands/types').CommandResult
            >((resolve, reject) => {
                const frameId = socket.sendCommandCall(
                    resolvedChatId,
                    resolvedChatId,
                    user?.id ?? '',
                    name,
                    args,
                );
                const timer = setTimeout(() => {
                    if (pendingCommandCallsRef.current.has(frameId)) {
                        pendingCommandCallsRef.current.delete(frameId);
                        reject(new Error('command timeout'));
                    }
                }, 30_000);
                pendingCommandCallsRef.current.set(frameId, {
                    resolve: r => {
                        clearTimeout(timer);
                        resolve(r);
                    },
                    reject: e => {
                        clearTimeout(timer);
                        reject(e);
                    },
                });
            });

            // 4) Refresh chat history so the command-call bubble (persisted
            //    by Go with meta.command_call=true) becomes visible.
            try {
                if (getMessagesRef.current) {
                    getMessagesRef.current(resolvedChatId, {
                        isRefresh: true,
                    });
                }
            } catch (e) {
                console.warn('[ChatCtx] post-command refresh failed', e);
            }

            // 5) Restore the user's chosen model — by now the activeChatID
            //    useEffect has run (it observes the new chat's empty history
            //    and resets selectedModel to default).
            if (pinnedModel && selectedModelRef.current !== pinnedModel) {
                setSelectedModel(pinnedModel, true);
            }
            return result;
        },
        [
            user?.id,
            isNewSession,
            setActiveChatID,
            onSessionStarted,
            setSelectedModel,
        ],
    );

    const contextValue: ChatContextType = {
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
        runCommand,
    };

    return (
        <ChatContext.Provider value={contextValue}>
            {children}
        </ChatContext.Provider>
    );
}
