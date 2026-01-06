import React, { createContext, useContext, useMemo } from 'react';
import { InboxMessage, Plugin, PluginChat, PluginChatMessage } from './models';

/**
 * Context Definition for PluginChats
 * Separated from Provider to avoid circular dependencies and heavy initialization
 */

export interface PluginChatsContextType {
    plugins: Plugin[];
    loading: boolean;
    refreshing: boolean;
    error: string | null;
    selectedChatId: string | null;
    selectedChatMessages: PluginChatMessage[];
    chatLoading: boolean;
    chatError: string | null;
    selectChat: (chat: PluginChat) => Promise<{ provider: string; chatId: string | number; messages: PluginChatMessage[]; integrationId?: string; title?: string | null } | null>;
    setSelectedChatId: (chatId: string | null) => void; // legacy
    refresh: () => Promise<void>;
    loadMoreForPlugin: (pluginId: string) => Promise<void>;
    hasMoreForPlugin: (pluginId: string) => boolean;
    loadingMorePlugins: Set<string>;
}

export const PluginChatsContext = createContext<PluginChatsContextType | undefined>(undefined);

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
