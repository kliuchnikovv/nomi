import React, { useEffect, useState, useMemo } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Pressable,
    RefreshControl,
    Text,
    View,
} from 'react-native';
import { NavArrowDown, NavArrowRight, XmarkCircle } from 'iconoir-react-native';
import { SharedValue } from 'react-native-reanimated';
import { Gesture } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createRightSidebarStyles, RightSidebarStyles } from './styles';
import { Plugin, PluginChat } from './models';
import { usePluginChats } from './context';
import { useChat } from '../chat/context';
import { useTheme } from '../../context/ThemeContext';
import { Sidebar } from '../../components/DrawerSidebar';
import { ThemePalette } from '../../themes/types';
import { getClientPlugin } from '../../plugins/clientRegistry';
import { useMain } from '../main/context';
import { PluginIcon } from '../../components/PluginIcon';
import { INTEGRATION_REGISTRY } from '../../services/integrations/registry';

const pad = (value: number) => value.toString().padStart(2, '0');

const formatTimestamp = (value?: string | number | null) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
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
    totalUnread,
    styles,
    palette,
    onClose,
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
    totalUnread: number;
    styles: RightSidebarStyles;
    palette: ThemePalette;
    onClose?: () => void;
}) {
    const { theme } = useTheme();
    const { activePluginView, setActivePluginView } = useMain();
    const isExpanded = expandedPlugins.has(plugin.id);

    // Get metadata from registry
    const metadata = INTEGRATION_REGISTRY[plugin.provider.toLowerCase()];
    const displayName = metadata?.displayName || plugin.name;
    const iconColor = metadata?.color || palette.textPrimary;

    // Check if plugin has a custom Sidebar component
    const clientPlugin = getClientPlugin(plugin.provider);
    const SidebarComponent = clientPlugin?.SidebarComponent;

    if (SidebarComponent) {
        return (
            <SidebarComponent
                integrationId={plugin.id}
                onSelect={() => setActivePluginView(plugin.provider)}
                isSelected={activePluginView === plugin.provider}
                onClose={onClose}
            />
        );
    }

    // Default rendering
    return (
        <View style={styles.pluginSection}>
            <Pressable
                style={styles.pluginHeader}
                onPress={() => onTogglePlugin(plugin.id)}
            >

                <View style={styles.pluginHeaderRow}>
                    <View style={styles.pluginHeaderLeft}>
                        <PluginIcon 
                            provider={plugin.provider} 
                            size={16} 
                            color={iconColor}
                        />
                        <Text style={styles.pluginName}>{displayName}</Text>
                        {totalUnread > 0 && (
                            <View style={[styles.unreadBadge, { backgroundColor: iconColor }]}>
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
    visible = true,
}: {
    onChatSelect?: (chat: PluginChat) => void;
    onClose?: () => void;
    styles: RightSidebarStyles;
    palette: ThemePalette;
    visible?: boolean;
}) {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const { activePluginView, setActivePluginView } = useMain();
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
                    <Text style={styles.sectionTitle}>Integrations</Text>
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
            <View style={{ paddingTop: insets.top - 25 }} />
            <View style={[styles.sectionHeader, { marginTop: 12 }]}>
                <Text style={styles.sectionTitle}>Integrations</Text>
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
                            <Text style={styles.emptyText}>No integrations</Text>
                            <Text style={[styles.emptyText, { fontSize: 12, marginTop: 8 }]}>
                                Connect an integration to get started
                            </Text>
                        </View>
                    }
                    renderItem={({ item: plugin }) => {
                        // Check if plugin has a custom Sidebar component
                        const clientPlugin = getClientPlugin(plugin.provider);
                        const SidebarComponent = clientPlugin?.SidebarComponent;

                        if (SidebarComponent) {
                            return (
                                <SidebarComponent
                                    integrationId={plugin.id}
                                    onSelect={() => setActivePluginView(plugin.provider)}
                                    isSelected={activePluginView === plugin.provider}
                                    onClose={onClose}
                                />
                            );
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
                                totalUnread={plugin.chats.reduce((sum, chat) => sum + (chat.unreadCount || 0), 0)}
                                styles={styles}
                                palette={palette}
                                onClose={onClose}
                            />
                        );
                    }}
                />
            )}
        </View>
    );
}


export interface RightSidebarProps {
    variant: 'inline' | 'overlay';
    width: number;
    onChatSelect?: (chat: PluginChat) => void;
    onClose?: () => void;
    translateX?: SharedValue<number>;
    dragGesture?: ReturnType<typeof Gesture.Pan>;
    visible?: boolean;
}

export default function RightSidebar({
    variant,
    width,
    onChatSelect,
    onClose,
    translateX,
    dragGesture,
    visible,
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
                visible={visible}
            />
        </Sidebar>
    );
}
