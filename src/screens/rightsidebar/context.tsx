import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { sidebarApi } from '../../apiClient';
import { InboxMessage, Plugin, PluginChat, PluginChatMessage, SidebarChat, SidebarItem, SidebarEntry } from './models';

interface PluginChatsContextType {
    plugins: Plugin[];
    loading: boolean;
    error: string | null;
    selectedChatId: string | null;
    selectedChatMessages: PluginChatMessage[];
    chatLoading: boolean;
    chatError: string | null;
    selectChat: (chat: PluginChat) => Promise<{ provider: string; chatId: string | number; messages: PluginChatMessage[]; integrationId?: string } | null>;
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

    const mapChats = (integrationId: string, provider: string, chats: SidebarChat[], options?: { integrationName?: string; entryMap?: Map<string, SidebarEntry> }): PluginChat[] => {
        return chats.map(chat => {
            const entry = options?.entryMap?.get(String(chat.chat_id));
            return {
                id: `${integrationId}:${chat.chat_id}`,
                pluginId: integrationId,
                title: entry?.title || chat.title,
                lastMessage: entry?.preview || (chat.count ? `${chat.count} messages` : undefined),
                lastMessageAt: chat.last_received ? new Date(chat.last_received).getTime() : undefined,
                unreadCount: 0,
                metadata: {
                    provider,
                    integrationId,
                    chatId: chat.chat_id,
                    messagesCount: chat.count,
                    integrationName: options?.integrationName,
                    preview: entry?.preview,
                },
            };
        });
    };

    const mapProviders = async (items: SidebarItem[]): Promise<Plugin[]> => {
        const pluginsWithChats = await Promise.all(items.map(async (item, idx) => {
            // Force a unique and stable id per integration to keep expand/collapse scoped
            const integrationId = item.integration_id
                ? String(item.integration_id)
                : (item as any).id
                    ? String((item as any).id)
                    : `${item.provider}-${idx}`;
            const entryMap = new Map<string, SidebarEntry>();
            (item.entries || []).forEach(entry => {
                entryMap.set(String(entry.thread_id ?? entry.id), entry);
            });
            try {
                const chatsResponse = await sidebarApi.getChats(item.provider, integrationId);
                const chatsList = chatsResponse?.chats && chatsResponse.chats.length > 0
                    ? chatsResponse.chats
                    : Array.from(entryMap.values()).map(entry => ({
                        chat_id: entry.thread_id ?? entry.id,
                        title: entry.title,
                        last_received: undefined,
                        count: undefined,
                    }));
                const chats = chatsList ? mapChats(integrationId, item.provider, chatsList, { integrationName: item.name, entryMap }) : [];

                return {
                    id: integrationId,
                    provider: item.provider,
                    name: item.name || item.provider,
                    chats,
                } satisfies Plugin;
            } catch (err) {
                console.error(`Failed to load chats for provider ${item.provider}:`, err);
                return {
                    id: integrationId,
                    provider: item.provider,
                    name: item.name || item.provider,
                    chats: entryMap.size > 0
                        ? mapChats(integrationId, item.provider, Array.from(entryMap.values()).map(entry => ({
                            chat_id: entry.thread_id ?? entry.id,
                            title: entry.title,
                        })), { integrationName: item.name, entryMap })
                        : [],
                } satisfies Plugin;
            }
        }));

        return pluginsWithChats;
    };

    const loadPlugins = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const sidebarData = await sidebarApi.getSidebar();
            const items = sidebarData?.items || [];
            const loadedPlugins = await mapProviders(items);
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
            const provider = chat.metadata?.provider || plugins.find(p => p.id === chat.pluginId)?.provider;
            if (!provider) {
                throw new Error('Provider not found for chat');
            }
            const chatId = chat.metadata?.chatId ?? chat.id;
            const integrationId = chat.metadata?.integrationId || chat.pluginId;
            const chatResponse = await sidebarApi.getChatMessages(provider, chatId, integrationId);
            const messages = chatResponse?.messages || [];
            setSelectedChatMessages(messages);
            return { provider, chatId, messages, integrationId };
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
