import React, {
    createContext,
    useContext,
    useState,
    useMemo,
    ReactNode,
    useEffect,
} from 'react';

import { Alert, Platform, ToastAndroid } from 'react-native';
import { useAuth } from '../auth/context.tsx';
import { apiClient } from '../../apiClient.ts'
import { Chat, GetChatsOptions, MainContextType } from "./models";
import { getApiUrl } from '../../config.ts';
import { useChatStore } from '../../store/chatStore';

export const emptyChatID = '00000000-0000-0000-0000-000000000000';

const MainContext = createContext<MainContextType | undefined>(undefined);

export function useMain() {
    const context = useContext(MainContext);
    if (!context) {
        throw new Error('useChat must be used within a ChatProvider');
    }
    return context;
}

export function MainProvider({ children }: { children: ReactNode }) {
    const [chats, setChats] = useState<Chat[]>([]);
    const [chatsLoading, setChatsLoading] = useState(false);
    const [activeChatID, setActiveChatID] = useState<string | null>(null);
    const [sidebarFilter, setSidebarFilter] = useState<string>('agent');
    const [activePluginView, setActivePluginView] = useState<string | null>(null);
    const [activePluginIntegrationId, setActivePluginIntegrationId] = useState<string | null>(null);
    const [rightSidebarVisible, setRightSidebarVisible] = useState(false);

    const { isAuthenticated } = useAuth();


    const activeChat = useMemo(
        () => chats.find(c => c.id === activeChatID) ?? null,
        [chats, activeChatID],
    );


    // const API_URL = 'https://genie.com';

    // Load chats on mount
    useEffect(() => {
        if (isAuthenticated) {
            getChats();
        }
    }, [isAuthenticated]);

    function rebindPlaceholderChat(newChatId: string) {
        setChats(prev => prev.map(c => {
            if (c.id === emptyChatID) {
                return {
                    ...c,
                    id: newChatId,
                    messages: (c.messages || []).map(m => ({ ...m, chat_id: newChatId })),
                };
            }
            return c;
        }));
        setActiveChatID(newChatId);
    }

    async function getChats(options: GetChatsOptions = {}) {
        const { preserveActiveChat } = options;
        setChatsLoading(true);
        try {
            console.log(`${getApiUrl()}/chats`)
            const data = await apiClient.get<[Chat]>(`${getApiUrl()}/chats`)
            if (!data) {
                return;
            }

            setChats(data);
            if (data.length === 0) {
                setActiveChatID(prev => {
                    if (preserveActiveChat && prev) {
                        return prev;
                    }
                    return emptyChatID;
                });
                return;
            }

            setActiveChatID(prev => {
                const stillExists = prev ? data.some(chat => chat.id === prev) : false;

                // If preserveActiveChat flag is set, preserve the current state
                if (preserveActiveChat && prev) {
                    if (prev === emptyChatID || stillExists) {
                        return prev;
                    }
                }

                // On initial load (prev is null), or if current chat deleted, or if currently on new chat
                // Default to New Chat (Dashboard) instead of opening the latest chat
                if (prev === emptyChatID) {
                    return emptyChatID;
                }

                return stillExists ? prev : emptyChatID;
            });
        } catch (error) {
            alertError(`Can't get chats: ${error}`)
            console.error(`Can't get chats: ${error}`);
            return;
        } finally {
            setChatsLoading(false);
        }
    }

    // async function getMessages(chatId: string) {
    //     if (!chatId || chatId === emptyChatID) return;
    //     try {
    //         const data =  await apiClient.get<[Message]>(
    //             `${getApiUrl()}/chats/${chatId}/messages`
    //         )
    //         if (!data) {
    //             return;
    //         }
    //
    //         setChats(prev =>
    //             prev.map(c =>
    //                 c.id === chatId ? { ...c, messages: data } : c,
    //             ),
    //         );
    //     } catch (error) {
    //         alertError(`Failed to fetch messages for chat: ${error}`)
    //         console.error(
    //             `Failed to fetch messages for chat ${chatId}:`,
    //             error,
    //         );
    //     }
    // }
    //
    // async function sendMessage(text: string) {
    //     if (!text.trim() || !activeId) return;
    //
    //     // Do not send if a message is already in flight
    //     if (pendingAssistantMessageIdRef.current) {
    //         alertError('Please wait for the previous message to be answered');
    //         return;
    //     }
    //
    //     const tempId = String(Date.now());
    //
    //     const userMessage: Message = {
    //         id:         tempId,
    //         chat_id:    activeId,
    //         sender:     user.id,
    //         role:      'user',
    //         text:       text.trim(),
    //         created_at: Date.now(),
    //     };
    //
    //     setChats(prev =>
    //         prev.map(c =>
    //             c.id === activeId
    //                 ? { ...c, messages: [...(c.messages || []), userMessage] }
    //                 : c,
    //         ),
    //     );
    //
    //     // Use a simple session ID for the socket message, though it's not used for correlation anymore
    //     const sessionId = `sess_${Date.now()}`;
    //     const assistantTempId = `asst_${Date.now()}`;
    //
    //     setChats(prev =>
    //         prev.map(c =>
    //             c.id === activeId
    //                 ? {
    //                     ...c,
    //                     messages: [
    //                         ...(c.messages || []),
    //                         {
    //                             id: assistantTempId,
    //                             chat_id: activeId,
    //                             sender: 'assistant',
    //                             role: 'assistant',
    //                             text: '',
    //                         } as Message,
    //                     ],
    //                 }
    //                 : c,
    //         ),
    //     );
    //
    //     // Track the single pending assistant message
    //     pendingAssistantMessageIdRef.current = assistantTempId;
    //
    //     // Ensure WS is open (lazy) and send message
    //     if (!socketRef.current) {
    //         // This case should ideally not be hit if useEffect is working correctly
    //         const sock = new ChatSocket(
    //             API_URL,
    //             () => token!,
    //             () => activeId!,
    //         );
    //         socketRef.current = sock;
    //     }
    //     socketRef.current!.sendMessage(text.trim(), sessionId);
    // }

    async function deleteChat(chatId: string) {
        try {
            await apiClient.delete<void>(
                `${getApiUrl()}/chats/${chatId}`
            )

            if (activeChatID === chatId) {
                setActiveChatID(chats.find(c => c.id !== chatId)?.id || null);
            }

            await getChats();
        } catch (error) {
            // alertError(`Can't delete chat: ${error}`)
            console.error('Failed to delete chat:', error);
        }
    }

    async function renameChat(chatId: string, newTitle: string) {
        try {
            await apiClient.put<void>(
                `${getApiUrl()}/chats/${chatId}`,
                { title: newTitle }
            );
            await getChats({ preserveActiveChat: true });
        } catch (error) {
            alertError(`Failed to rename chat: ${error}`);
            console.error('Failed to rename chat:', error);
        }
    }

    // Ensure emptyChatID is always clean to show Dashboard
    useEffect(() => {
        if (activeChatID === emptyChatID) {
            useChatStore.getState().clearChat(emptyChatID);
        }
    }, [activeChatID]);

    function createNewChat() {
        if (chats.some(c => c.id === emptyChatID)) {
            setActiveChatID(emptyChatID);
            return;
        }

        // Use current filter as the default mode/team for the new chat
        if (sidebarFilter === 'all' || sidebarFilter === 'agent' || sidebarFilter === 'planner') {
            setPendingChatMode({ mode: 'agent', teamId: null });
        } else {
            setPendingChatMode({ mode: 'team', teamId: sidebarFilter });
        }

        setActiveChatID(emptyChatID);
    }

    // State to store pending mode/team for new chat
    const [pendingChatMode, setPendingChatMode] = useState<{ mode: 'agent' | 'team'; teamId: string | null; initialMessage?: string } | null>(null);

    function createNewChatWithMode(mode: 'agent' | 'team', teamId: string | null) {
        // Store the mode/team to be used when the chat is created
        setPendingChatMode({ mode, teamId });
        // Trigger creation of a new chat
        setActiveChatID(emptyChatID);
    }

    // Close plugin view
    function closePlugin() {
        setActivePluginView(null);
    }

    // Export pending mode for chat context to use
    const getPendingChatMode = () => pendingChatMode;
    const clearPendingChatMode = () => setPendingChatMode(null);

    const value: MainContextType = {
        chats,
        chatsLoading,
        activeChatID,
        activeChat,
        getChats,
        createNewChat,
        createNewChatWithMode,
        renameChat,
        deleteChat,
        setActiveChatID,
        sidebarFilter,
        setSidebarFilter,
        pendingChatMode,
        clearPendingChatMode,
        activePluginView,
        setActivePluginView,
        activePluginIntegrationId,
        setActivePluginIntegrationId,
        rightSidebarVisible,
        setRightSidebarVisible,
    };

    return (
        <MainContext.Provider
            value={value}
        >
            {children}
        </MainContext.Provider>
    );
}

function alertError(message: string) {
    try {
        Alert.alert('Error', message);
    } catch {
        if (Platform.OS === 'android') {
            try { ToastAndroid.show(message, ToastAndroid.LONG); } catch { }
        }
    }
}
