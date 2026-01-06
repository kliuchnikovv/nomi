import React, { useEffect, useState, useMemo } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Pressable,
    RefreshControl,
    Text,
    View,
    ScrollView,
} from 'react-native';
import { NavArrowDown, NavArrowRight, Mail, Calendar, Sparks } from 'iconoir-react-native';
import { SharedValue } from 'react-native-reanimated';
import { Gesture } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createRightSidebarStyles, RightSidebarStyles } from './styles';
import { usePluginChats } from './context';
import { useChat } from '../chat/context';
import { useTheme } from '../../context/ThemeContext';
import { Sidebar } from '../../components/Sidebar';
import { ThemePalette } from '../../themes/types';
import { CalendarSidebar } from '../chat/sidebar/CalendarSidebar';


export interface RightSidebarProps {
    variant: 'inline' | 'overlay';
    width: number;
    visible?: boolean;
    onChatSelect?: (chat: PluginChat) => void;
    onClose?: () => void;
    translateX?: SharedValue<number>;
    dragGesture?: ReturnType<typeof Gesture.Pan>;
}

const pluginIconMap: Record<string, { IconComponent: any; colorKey: keyof ThemePalette }> = {
    inbox: { IconComponent: Mail, colorKey: 'blue' },
    gmail: { IconComponent: Mail, colorKey: 'red' },
    imap: { IconComponent: Mail, colorKey: 'cyan' },
    calendar: { IconComponent: Calendar, colorKey: 'orange' },
    jules: { IconComponent: Sparks, colorKey: 'orange' },
};

const getPluginIcon = (provider: string, palette: ThemePalette) => {
    const meta = pluginIconMap[provider] || {
        IconComponent: Mail,
        colorKey: 'commentGrey' as keyof ThemePalette,
    };
    return {
        IconComponent: meta.IconComponent,
        color: palette[meta.colorKey] as string,
    };
};

const formatTimestamp = (timestamp?: number) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) {
        return `${diffMins}m ago`;
    } else if (diffHours < 24) {
        return `${diffHours}h ago`;
    } else if (diffDays < 7) {
        return `${diffDays}d ago`;
    }
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
};

function PluginSection({
    plugin,
    expandedPlugins,
    onTogglePlugin,
    expandedChats,
    onToggleChat,
    onThreadSelect,
    onLoadMore,
    hasMore,
    isLoadingMore,
    styles,
    palette,
}: {
    plugin: Plugin;
    expandedPlugins: Set<string>;
    onTogglePlugin: (pluginId: string) => void;
    expandedChats: Set<string>;
    onToggleChat: (chatId: string) => void;
    onThreadSelect: (chat: PluginChat, thread: any) => void;
    onLoadMore: () => void;
    hasMore: boolean;
    isLoadingMore: boolean;
    styles: RightSidebarStyles;
    palette: ThemePalette;
}) {
    const { theme } = useTheme();
    const isExpanded = expandedPlugins.has(plugin.id);
    const iconMeta = getPluginIcon(plugin.provider, palette);
    const IconComponent = iconMeta.IconComponent;
    const totalUnread = plugin.chats.reduce((sum, chat) => sum + chat.unreadCount, 0);

    return (
        <View style={styles.pluginSection}>
            <Pressable
                style={styles.pluginHeader}
                onPress={() => onTogglePlugin(plugin.id)}
            >
                <View style={styles.pluginHeaderRow}>
                    <View style={styles.pluginHeaderLeft}>
                        <IconComponent
                            width={16}
                            height={16}
                            color={iconMeta.color}
                        />
                        <Text style={styles.pluginName}>{plugin.name}</Text>
                        {totalUnread > 0 && (
                            <View style={[styles.unreadBadge, { backgroundColor: iconMeta.color }]}>
                                <Text style={styles.unreadBadgeText}>{totalUnread}</Text>
                            </View>
                        )}
                    </View>
                    {isExpanded ? (
                        <NavArrowDown
                            width={16}
                            height={16}
                            color={theme.textSecondary}
                        />
                    ) : (
                        <NavArrowRight
                            width={16}
                            height={16}
                            color={theme.textSecondary}
                        />
                    )}
                </View>
            </Pressable>
            {isExpanded && (
                <View style={styles.chatsList}>
                    {plugin.chats.map((chat) => {
                        const threads = (chat.metadata as any)?.threads || [];
                        const chatExpanded = expandedChats.has(chat.id);
                        return (
                            <View key={chat.id} style={{ marginBottom: 4 }}>
                                <ChatItem
                                    chat={chat}
                                    isSelected={chatExpanded}
                                    onPress={() => onToggleChat(chat.id)}
                                    styles={styles}
                                />
                                {chatExpanded && threads.length > 0 && (
                                    <View style={{ paddingLeft: 28, gap: 6 }}>
                                        {threads.map((thread: any) => (
                                            <Pressable
                                                key={thread.thread_id}
                                                style={({ pressed }) => [
                                                    styles.chatItem,
                                                    pressed && { opacity: 0.8 },
                                                    { backgroundColor: `${theme.accent}08` },
                                                ]}
                                                onPress={() => onThreadSelect(chat, thread)}
                                            >
                                                <Text style={styles.chatTitle} numberOfLines={1}>
                                                    {thread.title || 'Thread'}
                                                </Text>
                                                <View style={styles.chatFooter}>
                                                    {thread.last_received && (
                                                        <Text style={styles.chatTimestamp}>
                                                            {formatTimestamp(new Date(thread.last_received).getTime())}
                                                        </Text>
                                                    )}
                                                    {thread.count > 0 && (
                                                        <View style={styles.chatUnreadBadge}>
                                                            <Text style={styles.chatUnreadBadgeText}>
                                                                {thread.count}
                                                            </Text>
                                                        </View>
                                                    )}
                                                </View>
                                            </Pressable>
                                        ))}
                                    </View>
                                )}
                            </View>
                        );
                    })}
                    {/* Load More Button */}
                    {hasMore && (
                        <Pressable
                            onPress={onLoadMore}
                            disabled={isLoadingMore}
                            style={({ pressed }) => [{
                                paddingVertical: 12,
                                paddingHorizontal: 16,
                                marginTop: 8,
                                borderRadius: 8,
                                backgroundColor: pressed ? `${theme.accent}20` : `${theme.accent}10`,
                                alignItems: 'center',
                            }]}
                        >
                            {isLoadingMore ? (
                                <ActivityIndicator size="small" color={theme.accent} />
                            ) : (
                                <Text style={{ color: theme.accent, fontWeight: '600', fontSize: 13 }}>
                                    Load More
                                </Text>
                            )}
                        </Pressable>
                    )}
                </View>
            )}
        </View>
    );
}

function ChatItem({
    chat,
    isSelected,
    onPress,
    styles,
}: {
    chat: PluginChat;
    isSelected: boolean;
    onPress: () => void;
    styles: RightSidebarStyles;
}) {
    return (
        <Pressable
            style={[
                styles.chatItem,
                isSelected && styles.chatItemSelected,
                chat.unreadCount > 0 && styles.chatItemUnread,
            ]}
            onPress={onPress}
        >
            <View style={styles.chatItemContent}>
                <Text
                    style={[
                        styles.chatTitle,
                        chat.unreadCount > 0 && styles.chatTitleUnread,
                    ]}
                    numberOfLines={1}
                >
                    {chat.title}
                </Text>
                {chat.lastMessage && (
                    <Text style={styles.chatPreview} numberOfLines={1}>
                        {chat.lastMessage}
                    </Text>
                )}
                <View style={styles.chatFooter}>
                    {chat.lastMessageAt && (
                        <Text style={styles.chatTimestamp}>
                            {formatTimestamp(chat.lastMessageAt)}
                        </Text>
                    )}
                    {chat.unreadCount > 0 && (
                        <View style={styles.chatUnreadBadge}>
                            <Text style={styles.chatUnreadBadgeText}>
                                {chat.unreadCount}
                            </Text>
                        </View>
                    )}
                </View>
            </View>
        </Pressable>
    );
}

function RightSidebarContent({
    onChatSelect,
    onClose,
    styles,
    palette,
}: {
    onChatSelect?: (chat: PluginChat) => void;
    onClose?: () => void;
    styles: RightSidebarStyles;
    palette: ThemePalette;
}) {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const { plugins, loading, refreshing, error, refresh, loadMoreForPlugin, hasMoreForPlugin, loadingMorePlugins } = usePluginChats();
    const { startPluginThread } = useChat();
    const [expandedPlugins, setExpandedPlugins] = useState<Set<string>>(new Set());
    const [expandedChats, setExpandedChats] = useState<Set<string>>(new Set());

    const togglePlugin = (pluginId: string) => {
        setExpandedPlugins(prev => {
            const next = new Set(prev);
            if (next.has(pluginId)) {
                next.delete(pluginId);
            } else {
                next.add(pluginId);
            }
            return next;
        });
    };

    const toggleChat = (chatId: string) => {
        setExpandedChats(prev => {
            const next = new Set(prev);
            if (next.has(chatId)) next.delete(chatId);
            else next.add(chatId);
            return next;
        });
    };

    const handleThreadSelect = async (chat: PluginChat, thread: any) => {
        const plugin = plugins.find(p => p.id === chat.pluginId);
        const messages = thread.messages || [];
        await startPluginThread({
            provider: chat.metadata?.provider || plugin?.provider || 'inbox',
            chatId: thread.thread_id || thread.id,
            integrationId: chat.metadata?.integrationId || chat.pluginId,
            integrationName: plugin?.name,
            title: thread.title || chat.title,
            messages,
        });
        onChatSelect?.(chat);
        onClose?.();
    };

    useEffect(() => {
        if (plugins.length > 0 && expandedPlugins.size === 0) {
            setExpandedPlugins(new Set(plugins.map(plugin => plugin.id)));
        }
    }, [plugins, expandedPlugins.size]);

    if (error) {
        return (
            <View style={styles.root}>
                <View style={[styles.sectionHeader, { paddingTop: insets.top + 12 }]}>
                    <Text style={styles.sectionTitle}>Inbox Chats</Text>
                </View>
                <View style={styles.emptyState}>
                    <Text style={styles.emptyText}>Error: {error}</Text>
                    <Pressable onPress={refresh} style={{ marginTop: 12 }}>
                        <Text style={[styles.emptyText, { textDecorationLine: 'underline' }]}>
                            Retry
                        </Text>
                    </Pressable>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.root}>
            <View style={[styles.sectionHeader, { paddingTop: insets.top + 12 }]}>
                <Text style={styles.sectionTitle}>Inbox Chats</Text>
            </View>

            {loading && plugins.length === 0 ? (
                <View style={styles.emptyState}>
                    <ActivityIndicator size="large" color={theme.accent} />
                </View>
            ) : (
                <FlatList
                    data={plugins}
                    keyExtractor={plugin => plugin.id}
                    style={{ flex: 1 }}
                    contentContainerStyle={[styles.pluginsList, plugins.length === 0 && { flex: 1 }]}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={refresh}
                            tintColor={theme.accent}
                            colors={[theme.accent]}
                        />
                    }
                    ListEmptyComponent={
                        <View style={[styles.emptyState, { flex: 1 }]}>
                            <Text style={styles.emptyText}>No inbox chats</Text>
                        </View>
                    }
                    renderItem={({ item: plugin }) => {
                        if (plugin.provider === 'calendar') {
                            // Cast to any to avoid type mismatch if models differ slightly, though id is present.
                            // We disable scrolling so the outer FlatList handles it.
                            return <CalendarSidebar integration={plugin as any} scrollEnabled={false} />;
                        }
                        return (
                            <PluginSection
                                plugin={plugin}
                                expandedPlugins={expandedPlugins}
                                onTogglePlugin={togglePlugin}
                                expandedChats={expandedChats}
                                onToggleChat={toggleChat}
                                onThreadSelect={handleThreadSelect}
                                onLoadMore={() => loadMoreForPlugin(plugin.id)}
                                hasMore={hasMoreForPlugin(plugin.id)}
                                isLoadingMore={loadingMorePlugins.has(plugin.id)}
                                styles={styles}
                                palette={palette}
                            />
                        );
                    }}
                />
            )}
        </View>
    );
}

export default function RightSidebar({
    variant,
    width,
    onChatSelect,
    onClose,
    translateX,
    dragGesture,
}: RightSidebarProps) {
    const { theme, palette } = useTheme();
    const { refresh } = usePluginChats();
    const styles = useMemo(() => createRightSidebarStyles(theme, palette), [theme, palette]);

    // Refresh when sidebar becomes visible
    useEffect(() => {
        if (variant === 'inline' || (translateX && translateX.value === 0)) {
            refresh();
        }
    }, [variant, refresh]);

    return (
        <Sidebar
            side="right"
            variant={variant}
            width={width}
            onClose={onClose}
            translateX={translateX}
            dragGesture={dragGesture}
        >
            <RightSidebarContent
                onChatSelect={onChatSelect}
                onClose={onClose}
                styles={styles}
                palette={palette}
            />
        </Sidebar>
    );
}
