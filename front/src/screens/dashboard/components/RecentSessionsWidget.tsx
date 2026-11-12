import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
const isEmoji = (s?: string) =>
    !!s && /\p{Emoji}/u.test(s) && !/^[0-9#*]$/.test(s);
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { Card, ListItem, Text } from '@nomi/ds';
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

function formatRelativeTime(
    timestamp: number | string | null | undefined,
): string {
    if (!timestamp) return '';
    const ms =
        typeof timestamp === 'number'
            ? timestamp
            : Date.parse(String(timestamp));
    if (Number.isNaN(ms)) return '';
    const diffMs = Date.now() - ms;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h`;
    return `${Math.floor(diffH / 24)}d`;
}

export function RecentSessionsWidget() {
    const navigation = useNavigation<NavigationProp<RootTabParamList>>();
    const { theme, descriptor } = useTheme();
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
        <Card
            theme={descriptor}
            padding="lg"
            radius="lg"
            bordered
            style={styles.card}
        >
            <Text
                theme={descriptor}
                variant="caption"
                tone="secondary"
                weight="600"
                style={styles.header}
            >
                RECENT SESSIONS
            </Text>
            {recentChats.length === 0 ? (
                <Text
                    theme={descriptor}
                    variant="caption"
                    tone="secondary"
                    align="center"
                    style={styles.empty}
                >
                    No sessions yet
                </Text>
            ) : (
                recentChats.map((chat: Chat) => (
                    <ListItem
                        key={chat.id}
                        theme={descriptor}
                        density="compact"
                        title={chat.title || 'New Chat'}
                        onPress={() =>
                            navigation.navigate('Chat', {
                                screen: 'ChatDetail',
                                params: { chatId: chat.id },
                            })
                        }
                        leftContent={
                            <View
                                style={[
                                    styles.iconBg,
                                    {
                                        backgroundColor: theme.background,
                                        borderRadius: descriptor.radius.sm,
                                    },
                                ]}
                            >
                                {isEmoji(chat.icon) ? (
                                    <Text theme={descriptor} variant="body">
                                        {chat.icon}
                                    </Text>
                                ) : (
                                    <Ionicons
                                        name={getChatIcon(chat.icon) as any}
                                        size={16}
                                        color={theme.accent}
                                    />
                                )}
                            </View>
                        }
                        rightContent={
                            <Text
                                theme={descriptor}
                                variant="caption"
                                tone="secondary"
                            >
                                {formatRelativeTime(chat.updated_at)}
                            </Text>
                        }
                        style={styles.row}
                    />
                ))
            )}
        </Card>
    );
}

const styles = StyleSheet.create({
    card: { gap: 4 },
    header: { letterSpacing: 0.8 },
    row: { paddingHorizontal: 0 },
    iconBg: {
        width: 28,
        height: 28,
        justifyContent: 'center',
        alignItems: 'center',
    },
    empty: { paddingVertical: 8 },
});
