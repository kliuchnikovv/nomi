import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../../context/ThemeContext';
import { useMain } from '../../main/context';
import { Chat } from '../../main/models';
import type { RootTabParamList } from '../../../navigation/types';
import type { NavigationProp } from '@react-navigation/native';

const ICON_MAP: Record<string, string> = {
    d20: 'dice',
    sparkles: 'sparkles',
    code: 'code-slash',
    plane: 'airplane',
};

function getChatIcon(icon?: string): string {
    return (icon && ICON_MAP[icon]) || 'chatbubble-outline';
}

function formatRelativeTime(timestamp: number | string | null | undefined): string {
    if (!timestamp) return '';
    const ms = typeof timestamp === 'number' ? timestamp : Date.parse(String(timestamp));
    if (Number.isNaN(ms)) return '';
    const diffMs = Date.now() - ms;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h`;
    return `${Math.floor(diffH / 24)}d`;
}

export function RecentChatsWidget() {
    const navigation = useNavigation<NavigationProp<RootTabParamList>>();
    const { theme } = useTheme();
    const { chats } = useMain();

    const toMs = (v: number | string) =>
        typeof v === 'number' ? v : Date.parse(String(v)) || 0;

    const recentChats = useMemo(
        () =>
            [...chats]
                .sort((a, b) => toMs(b.updated_at) - toMs(a.updated_at))
                .slice(0, 3),
        [chats],
    );

    return (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.header, { color: theme.textSecondary }]}>Recent Chats</Text>
            {recentChats.length === 0 ? (
                <Text style={[styles.empty, { color: theme.textSecondary }]}>No chats yet</Text>
            ) : (
                recentChats.map((chat: Chat) => (
                    <TouchableOpacity
                        key={chat.id}
                        style={styles.row}
                        onPress={() => navigation.navigate('Chat', { screen: 'ChatDetail', params: { chatId: chat.id } })}
                        activeOpacity={0.7}
                    >
                        <View style={[styles.iconBg, { backgroundColor: theme.background }]}>
                            <Ionicons
                                name={getChatIcon(chat.icon) as any}
                                size={16}
                                color={theme.accent}
                            />
                        </View>
                        <Text
                            style={[styles.title, { color: theme.textPrimary }]}
                            numberOfLines={1}
                        >
                            {chat.title || 'New Chat'}
                        </Text>
                        <Text style={[styles.time, { color: theme.textSecondary }]}>
                            {formatRelativeTime(chat.updated_at)}
                        </Text>
                    </TouchableOpacity>
                ))
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        padding: 16,
        borderRadius: 16,
        borderWidth: 1,
        gap: 8,
    },
    header: {
        fontSize: 11,
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: 0.8,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    iconBg: {
        width: 28,
        height: 28,
        borderRadius: 8,
        justifyContent: 'center',
        alignItems: 'center',
    },
    title: {
        flex: 1,
        fontSize: 14,
        fontWeight: '500',
    },
    time: {
        fontSize: 12,
    },
    empty: {
        fontSize: 13,
        textAlign: 'center',
        paddingVertical: 8,
    },
});
