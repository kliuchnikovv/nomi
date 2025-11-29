import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Pressable,
    Text,
    View,
} from 'react-native';
import { NavArrowDown, NavArrowRight, Mail, Calendar } from 'iconoir-react-native';
import { styles } from './styles.tsx';
import { usePluginChats } from './context';
import { useChat } from '../chat/context';
import { oneDarkPalette } from '../../themes/oneDark.ts';
import { Plugin, PluginChat } from './models';

type Props = {
    width: number;
    isOpen: boolean;
    onChatSelect?: (chat: PluginChat) => void;
    onClose?: () => void;
};

const pluginIconMap: Record<string, { IconComponent: any; color: string }> = {
    inbox: { IconComponent: Mail, color: '#61AFEF' },
    gmail: { IconComponent: Mail, color: '#EA4335' },
    imap: { IconComponent: Mail, color: '#61AFEF' },
    calendar: { IconComponent: Calendar, color: '#E06C75' },
};

const getPluginIcon = (provider: string) => {
    return pluginIconMap[provider] || {
        IconComponent: Mail,
        color: oneDarkPalette.commentGrey,
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

const PluginSection = ({
    plugin,
    expandedPlugins,
    onTogglePlugin,
    selectedChatId,
    onChatSelect,
}: {
    plugin: Plugin;
    expandedPlugins: Set<string>;
    onTogglePlugin: (pluginId: string) => void;
    selectedChatId: string | null;
    onChatSelect?: (chat: PluginChat) => void;
}) => {
    const isExpanded = expandedPlugins.has(plugin.id);
    const iconMeta = getPluginIcon(plugin.provider);
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
                            color={oneDarkPalette.gutterGrey}
                        />
                    ) : (
                        <NavArrowRight
                            width={16}
                            height={16}
                            color={oneDarkPalette.gutterGrey}
                        />
                    )}
                </View>
            </Pressable>
            {isExpanded && (
                <View style={styles.chatsList}>
                    {plugin.chats.map((chat) => (
                        <ChatItem
                            key={chat.id}
                            chat={chat}
                            isSelected={selectedChatId === chat.id}
                            onPress={() => onChatSelect?.(chat)}
                        />
                    ))}
                </View>
            )}
        </View>
    );
};

const ChatItem = ({
    chat,
    isSelected,
    onPress,
}: {
    chat: PluginChat;
    isSelected: boolean;
    onPress: () => void;
}) => {
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
};

export default function RightSidebar({ width, isOpen, onChatSelect, onClose }: Props) {
    const { plugins, loading, error, selectedChatId, selectChat, refresh } = usePluginChats();
    const { startPluginThread } = useChat();
    const [expandedPlugins, setExpandedPlugins] = useState<Set<string>>(new Set());

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

    const handleChatSelect = async (chat: PluginChat) => {
        const plugin = plugins.find(p => p.id === chat.pluginId);
        const result = await selectChat(chat);
        if (result) {
            await startPluginThread({
                provider: result.provider,
                chatId: result.chatId,
                integrationId: result.integrationId || chat.pluginId,
                integrationName: plugin?.name,
                title: chat.title,
            });
        }
        onChatSelect?.(chat);
        if (onClose) {
            onClose();
        }
    };

    useEffect(() => {
        if (plugins.length > 0 && expandedPlugins.size === 0) {
            setExpandedPlugins(new Set(plugins.map(plugin => plugin.id)));
        }
    }, [plugins, expandedPlugins.size]);

    // Refresh when sidebar becomes open
    useEffect(() => {
        if (isOpen) {
            refresh();
        }
    }, [isOpen, refresh]);

    if (error) {
        return (
            <View style={[styles.root, { width }]}>
                <View style={styles.sectionHeader}>
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
        <View style={[styles.root, { width }]}>
            <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Inbox Chats</Text>
            </View>
            {loading && plugins.length === 0 ? (
                <View style={styles.emptyState}>
                    <ActivityIndicator size="large" color="#61AFEF" />
                </View>
            ) : plugins.length === 0 ? (
                <View style={styles.emptyState}>
                    <Text style={styles.emptyText}>No inbox chats</Text>
                </View>
            ) : (
                <FlatList
                    data={plugins}
                    keyExtractor={plugin => plugin.id}
                    contentContainerStyle={styles.pluginsList}
                    renderItem={({ item: plugin }) => (
                        <PluginSection
                            plugin={plugin}
                            expandedPlugins={expandedPlugins}
                            onTogglePlugin={togglePlugin}
                            selectedChatId={selectedChatId}
                            onChatSelect={handleChatSelect}
                        />
                    )}
                />
            )}
        </View>
    );
}
