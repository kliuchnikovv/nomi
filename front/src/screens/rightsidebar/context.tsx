import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { inboxApi, integrationsApi, sidebarApi } from '../../apiClient';
import { integrationStorage, Email } from '../../services/integrations/IntegrationStorage';
import { gmailClient } from '../../services/integrations/clients/GmailClient';
import { InboxMessage, Plugin, PluginChat, PluginChatMessage } from './models';
import { isDatabaseReady } from '../../services/database/database';

interface PluginChatsContextType {
    plugins: Plugin[];
    loading: boolean;
    refreshing: boolean;
    error: string | null;
    selectedChatId: string | null;
    selectedChatMessages: PluginChatMessage[];
    chatLoading: boolean;
    chatError: string | null;
    selectChat: (chat: PluginChat) => Promise<{ provider: string; chatId: string | number; messages: PluginChatMessage[]; integrationId?: string; title?: string | null } | null>;
    setSelectedChatId: (chatId: string | null) => void; // legacy, use selectChat
    refresh: () => Promise<void>;
    loadMoreForPlugin: (pluginId: string) => Promise<void>;
    hasMoreForPlugin: (pluginId: string) => boolean;
    loadingMorePlugins: Set<string>;
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
        loadInbox: async () => { },
        markAsRead: async () => { },
        executeAction: async () => { },
        loadMore: async () => { },
        refresh: context.refresh,
    };
};

export const PluginChatsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [plugins, setPlugins] = useState<Plugin[]>([]);
    const [loading, setLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
    const [selectedChatMessages, setSelectedChatMessages] = useState<PluginChatMessage[]>([]);
    const [chatLoading, setChatLoading] = useState(false);
    const [chatError, setChatError] = useState<string | null>(null);
    const [pluginPages, setPluginPages] = useState<Record<string, number>>({});
    const [pluginHasMore, setPluginHasMore] = useState<Record<string, boolean>>({});
    const [loadingMorePlugins, setLoadingMorePlugins] = useState<Set<string>>(new Set());

    const mapInboxItemsToPlugins = async (): Promise<Plugin[]> => {
        try {
            // Skip local integrations if database not ready yet
            if (!isDatabaseReady()) {
                console.log('[PluginChatsContext] Database not ready, skipping local integrations');
                // Fall through to load remote plugins only
            }

            // 1. Load local integrations (Gmail) - only if database is ready
            const localIntegrations = isDatabaseReady()
                ? await integrationStorage.getIntegrations()
                : [];
            const localPlugins: Plugin[] = [];

            for (const integ of localIntegrations) {
                if (integ.provider?.toLowerCase() === 'gmail' && integ.enabled) {
                    const cachedEmails = await integrationStorage.getCachedEmails(integ.id, 20);

                    // Group by threadId
                    const threadsMap = new Map<string, Email[]>();
                    cachedEmails.forEach(email => {
                        const threadId = email.threadId || email.id;
                        const existing = threadsMap.get(threadId) || [];
                        existing.push(email);
                        threadsMap.set(threadId, existing);
                    });

                    const chats: PluginChat[] = Array.from(threadsMap.entries()).map(([threadId, emails]) => {
                        const sortedEmails = emails.sort((a, b) =>
                            new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()
                        );
                        const latest = sortedEmails[0];
                        const count = emails.length;

                        return {
                            id: `${integ.id}:${threadId}`,
                            pluginId: integ.id,
                            title: latest.subject || '(No subject)',
                            lastMessage: latest.snippet,
                            lastMessageAt: latest.date ? new Date(latest.date).getTime() : undefined,
                            unreadCount: emails.filter(e => !e.isRead).length,
                            metadata: {
                                provider: integ.provider,
                                integrationId: integ.id,
                                threadId: threadId,
                                messages: sortedEmails.map(e => ({
                                    id: e.id,
                                    text: e.bodyText || e.snippet || '',
                                    sender: e.fromName || e.fromEmail,
                                    timestamp: e.date ? new Date(e.date).getTime() : Date.now(),
                                    isMe: false, // Gmail incoming are usually not me, unless sent
                                })),
                            },
                        };
                    });

                    localPlugins.push({
                        id: integ.id,
                        provider: integ.provider,
                        name: integ.name,
                        chats: chats,
                    });
                }
            }

            // 2. Load remote plugins (IMAP, Jules) - DEPRECATED/REMOVED
            // const integrationsResponse = await integrationsApi.list();
            // const remoteIntegrations = Array.isArray(integrationsResponse)
            //     ? integrationsResponse
            //     : (integrationsResponse?.items || []);
            const remotePlugins: Plugin[] = [];

            // Commented out as integrationsApi is removed
            /*
            const parsedRemoteIntegrations = remoteIntegrations.map((p: any) => {
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

            for (const integ of parsedRemoteIntegrations) {
                // ... existing logic ...
            }
            */

            return [...localPlugins, ...remotePlugins];
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
        setRefreshing(true);
        try {
            // Force sync for enabled Gmail integrations - only if database is ready
            if (isDatabaseReady()) {
                const integrations = await integrationStorage.getIntegrations();
                const gmailIntegrations = integrations.filter(i => i.provider?.toLowerCase() === 'gmail' && i.enabled);

                await Promise.all(gmailIntegrations.map(async (integ) => {
                    try {
                        console.log(`[PluginChatsContext] Syncing gmail integration ${integ.id}...`);
                        await gmailClient.syncEmails(integ.id);
                    } catch (e) {
                        console.error(`[PluginChatsContext] Failed to sync integration ${integ.id}`, e);
                    }
                }));
            }

            await loadPlugins();
            // Reset pagination state
            setPluginPages({});
            setPluginHasMore({});
        } finally {
            setRefreshing(false);
        }
    }, [loadPlugins]);

    const loadMoreForPlugin = useCallback(async (pluginId: string) => {
        const plugin = plugins.find(p => p.id === pluginId);
        if (!plugin) return;

        // Skip if already loading
        if (loadingMorePlugins.has(pluginId)) return;

        const currentPage = pluginPages[pluginId] || 1;
        const nextPage = currentPage + 1;

        setLoadingMorePlugins(prev => new Set(prev).add(pluginId));

        try {
            // Backend /inbox endpoint is removed. Local pagination to be implemented.
            /*
            const inbox = await inboxApi.getInbox({
                provider: plugin.provider,
                integrationId: pluginId,
                page: nextPage,
                limit: 20,
            });
            const items = inbox?.items || [];
            const totalPages = inbox?.total_pages || 1;

            if (items.length === 0) {
                setPluginHasMore(prev => ({ ...prev, [pluginId]: false }));
                return;
            }

            // Add new chats to the plugin
            const newChats: PluginChat[] = items.map((chatItem: any, chatIdx: number) => {
                const chatId = chatItem.chat_id ?? `chat-${currentPage * 20 + chatIdx}`;
                const threads = chatItem.threads || [];
                return {
                    id: `${pluginId}:${chatId}`,
                    pluginId: pluginId,
                    title: chatItem.sender || `Chat ${chatId}`,
                    lastMessage: chatItem.count ? `${chatItem.count} messages` : undefined,
                    lastMessageAt: chatItem.last_received ? new Date(chatItem.last_received).getTime() : undefined,
                    unreadCount: 0,
                    metadata: {
                        provider: plugin.provider,
                        integrationId: pluginId,
                        chatId,
                        threads: threads.map((thread: any, idx: number) => ({
                            ...thread,
                            thread_id: thread.thread_id ?? `${chatId}-thread-${idx}`,
                            messages: thread.messages || [],
                        })),
                    },
                };
            });

            setPlugins(prev => prev.map(p => {
                if (p.id === pluginId) {
                    return { ...p, chats: [...p.chats, ...newChats] };
                }
                return p;
            }));

            setPluginPages(prev => ({ ...prev, [pluginId]: nextPage }));
            // Use total_pages from API response to determine if there are more pages
            setPluginHasMore(prev => ({ ...prev, [pluginId]: nextPage < totalPages }));
            */

            // Mark as no more items for now since backend is gone
            setPluginHasMore(prev => ({ ...prev, [pluginId]: false }));

        } catch (err) {
            console.error(`Failed to load more for plugin ${pluginId}`, err);
        } finally {
            setLoadingMorePlugins(prev => {
                const next = new Set(prev);
                next.delete(pluginId);
                return next;
            });
        }
    }, [plugins, pluginPages, loadingMorePlugins]);

    const hasMoreForPlugin = useCallback((pluginId: string) => {
        // Default to true if we haven't loaded more yet
        return pluginHasMore[pluginId] !== false;
    }, [pluginHasMore]);

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
        refreshing,
        error,
        selectedChatId,
        selectedChatMessages,
        chatLoading,
        chatError,
        selectChat,
        setSelectedChatId,
        refresh,
        loadMoreForPlugin,
        hasMoreForPlugin,
        loadingMorePlugins,
    }), [
        plugins,
        loading,
        refreshing,
        error,
        selectedChatId,
        selectedChatMessages,
        chatLoading,
        chatError,
        selectChat,
        refresh,
        loadMoreForPlugin,
        hasMoreForPlugin,
        loadingMorePlugins,
    ]);

    return (
        <PluginChatsContext.Provider value={value}>
            {children}
        </PluginChatsContext.Provider>
    );
};

// Для обратной совместимости
export const InboxProvider = PluginChatsProvider;
