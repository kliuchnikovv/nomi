import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { FlatList, Text, View, StyleSheet } from 'react-native';
import { useChatStore } from '../../../store/chatStore';
import { useTheme } from '../../../context/ThemeContext';
import { Message } from '../../../screens/main/models';

interface Props {
    chatId: string;
}

const MAX_MESSAGES = 20;
const EMPTY: Message[] = [];

export function VoiceTranscript({ chatId }: Props) {
    const { theme, palette } = useTheme();
    const listRef = useRef<FlatList>(null);
    // Select the raw array reference — stable when the chat hasn't changed.
    // EMPTY is a module-level constant so the ?? fallback is also stable.
    const allMessages = useChatStore(state => state.chats[chatId] ?? EMPTY);
    const messages = useMemo(() => allMessages.slice(-MAX_MESSAGES), [allMessages]);

    useEffect(() => {
        if (messages.length > 0) {
            const id = setTimeout(() => {
                listRef.current?.scrollToEnd({ animated: true });
            }, 50);
            return () => clearTimeout(id);
        }
    }, [messages.length]);

    const renderItem = useCallback(
        ({ item }: { item: (typeof messages)[number] }) => {
            const isUser = item.role === 'user';
            return (
                <View style={[styles.row, isUser && styles.rowUser]}>
                    <View
                        style={[
                            styles.bubble,
                            {
                                backgroundColor: isUser
                                    ? theme.accent
                                    : theme.surface,
                            },
                        ]}
                    >
                        <Text
                            style={[
                                styles.text,
                                { color: isUser ? palette.white : theme.text },
                            ]}
                        >
                            {item.text.trim() || '…'}
                        </Text>
                    </View>
                </View>
            );
        },
        [theme, palette],
    );

    return (
        <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={item => item.id}
            style={styles.list}
            contentContainerStyle={styles.content}
            renderItem={renderItem}
        />
    );
}

const styles = StyleSheet.create({
    list: { flex: 1, width: '100%' },
    content: { paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
    row: { width: '100%' },
    rowUser: { alignItems: 'flex-end' },
    bubble: {
        maxWidth: '80%',
        borderRadius: 16,
        paddingHorizontal: 14,
        paddingVertical: 8,
    },
    text: { fontSize: 14, lineHeight: 20 },
});
