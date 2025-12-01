import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { inboxApi, integrationsApi } from '../../apiClient';
import { InboxMessage, Plugin, PluginChat, PluginChatMessage } from './models';

interface PluginChatsContextType {
    plugins: Plugin[];
    loading: boolean;
    error: string | null;
    selectedChatId: string | null;
    selectedChatMessages: PluginChatMessage[];
    chatLoading: boolean;
    chatError: string | null;
    selectChat: (chat: PluginChat) => Promise<{ provider: string; chatId: string | number; messages: PluginChatMessage[]; integrationId?: string; title?: string | null } | null>;
    setSelectedChatId: (chatId: string | null) => void; // legacy, use selectChat
    refresh: () => Promise<void>;
}

const PluginChatsContext = createContext<PluginChatsContextType | undefined>(undefined);

export const usePluginChats = () => {
    const context = useContext(PluginChatsContext);
    if (!context) {
        throw new Error('usePluginChats must be used within PluginChatsProvider');
    }
    return context;
};

// Для обратной совместимости
export const useInbox = () => {
    const context = useContext(PluginChatsContext);
    if (!context) {
        throw new Error('useInbox must be used within PluginChatsProvider');
    }
    // Вычисляем общее количество непрочитанных чатов
    const unreadCount = useMemo(() => {
        return context.plugins.reduce((total, plugin) => {
            return total + plugin.chats.reduce((sum, chat) => sum + chat.unreadCount, 0);
        }, 0);
    }, [context.plugins]);
    
    // Возвращаем совместимый интерфейс
    return {
        messages: [] as InboxMessage[],
        loading: context.loading,
        error: context.error,
        page: 1,
        totalPages: 1,
        totalCount: 0,
        unreadCount,
        loadInbox: async () => {},
        markAsRead: async () => {},
        executeAction: async () => {},
        loadMore: async () => {},
        refresh: context.refresh,
    };
};

export const PluginChatsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [plugins, setPlugins] = useState<Plugin[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
    const [selectedChatMessages, setSelectedChatMessages] = useState<PluginChatMessage[]>([]);
    const [chatLoading, setChatLoading] = useState(false);
    const [chatError, setChatError] = useState<string | null>(null);

    const mapInboxItemsToPlugins = async (): Promise<Plugin[]> => {
        try {
            const integrationsResponse = await integrationsApi.list();
            const integrations = Array.isArray(integrationsResponse)
                ? integrationsResponse
                : (integrationsResponse?.items || []);

            const parsedIntegrations = integrations.map((p: any) => {
                let params: Record<string, any> | undefined;
                if (typeof p?.params === 'object') params = p.params;
                else if (p?.params) {
                    try { params = JSON.parse(String(p.params)); } catch { params = undefined; }
                }
                return {
                    id: String(p.id),
                    name: p.name || params?.account_email || p.provider || 'Integration',
                    provider: p.provider || 'unknown',
                    params,
                };
            });

            const plugins: Plugin[] = [];

            for (const integ of parsedIntegrations) {
                try {
                    const inbox = await inboxApi.getInbox({
                        provider: integ.provider,
                        integrationId: integ.id,
                    });
                    const items = inbox?.items || [];
                    const chats: PluginChat[] = [];

                    items.forEach((chatItem: any, chatIdx: number) => {
                        const chatId = chatItem.chat_id ?? `chat-${chatIdx}`;
                        const threads = chatItem.threads || [];
                        chats.push({
                            id: `${integ.id}:${chatId}`,
                            pluginId: integ.id,
                            title: chatItem.sender || `Chat ${chatId}`,
                            lastMessage: chatItem.count ? `${chatItem.count} messages` : undefined,
                            lastMessageAt: chatItem.last_received ? new Date(chatItem.last_received).getTime() : undefined,
                            unreadCount: 0,
                            metadata: {
                                provider: integ.provider,
                                integrationId: integ.id,
                                chatId,
                                threads: threads.map((thread: any, idx: number) => ({
                                    ...thread,
                                    thread_id: thread.thread_id ?? `${chatId}-thread-${idx}`,
                                    messages: thread.messages || [],
                                })),
                            },
                        });
                    });

                    plugins.push({
                        id: integ.id,
                        provider: integ.provider,
                        name: integ.name,
                        chats,
                    });
                } catch (err) {
                    console.error(`Failed to load inbox for integration ${integ.id}`, err);
                    plugins.push({
                        id: integ.id,
                        provider: integ.provider,
                        name: integ.name,
                        chats: [],
                    });
                }
            }

            return plugins;
        } catch (err) {
            console.error('Failed to load integrations for inbox', err);
            return [];
        }
    };

    const loadPlugins = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const loadedPlugins = await mapInboxItemsToPlugins();
            setPlugins(loadedPlugins);
        } catch (err) {
            console.error('Failed to load plugin chats:', err);
            setError(err instanceof Error ? err.message : 'Failed to load plugin chats');
        } finally {
            setLoading(false);
        }
    }, []);

    const refresh = useCallback(async () => {
        await loadPlugins();
    }, [loadPlugins]);

    const selectChat = useCallback(async (chat: PluginChat) => {
        setSelectedChatId(chat.id);
        setChatLoading(true);
        setChatError(null);
        try {
            // Inbox data already contains messages; just return them
            const provider = chat.metadata?.provider || plugins.find(p => p.id === chat.pluginId)?.provider;
            const integrationId = chat.metadata?.integrationId || chat.pluginId;
            const messages = (chat.metadata as any)?.messages || [];
            const chatId = chat.metadata?.threadId || chat.metadata?.chatId || chat.id;
            setSelectedChatMessages(messages);
            return { provider: provider || 'inbox', chatId, messages, integrationId, title: chat.title };
        } catch (err) {
            console.error('Failed to load chat messages:', err);
            setChatError(err instanceof Error ? err.message : 'Failed to load chat messages');
            setSelectedChatMessages([]);
            return null;
        } finally {
            setChatLoading(false);
        }
    }, [plugins]);

    useEffect(() => {
        loadPlugins();

        // Auto-refresh every 60 seconds
        const intervalId = setInterval(() => {
            loadPlugins();
        }, 60000); // 60 seconds

        return () => {
            clearInterval(intervalId);
        };
    }, [loadPlugins]);

    const value = useMemo(() => ({
        plugins,
        loading,
        error,
        selectedChatId,
        selectedChatMessages,
        chatLoading,
        chatError,
        selectChat,
        setSelectedChatId,
        refresh,
    }), [
        plugins,
        loading,
        error,
        selectedChatId,
        selectedChatMessages,
        chatLoading,
        chatError,
        selectChat,
        refresh,
    ]);

    return (
        <PluginChatsContext.Provider value={value}>
            {children}
        </PluginChatsContext.Provider>
    );
};

// Для обратной совместимости
export const InboxProvider = PluginChatsProvider;
