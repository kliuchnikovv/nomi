import React, { useCallback, useEffect, useRef } from 'react';
import { FlatList, Text, View, StyleSheet } from 'react-native';
import { shallow } from 'zustand/shallow';
import { useChatStore } from '../../../store/chatStore';
import { useTheme } from '../../../context/ThemeContext';

interface Props {
    chatId: string;
}

const MAX_MESSAGES = 20;

export function VoiceTranscript({ chatId }: Props) {
    const { theme, palette } = useTheme();
    const listRef = useRef<FlatList>(null);
    const messages = useChatStore((state) => {
        const all = state.chats[chatId] ?? [];
        return all.slice(-MAX_MESSAGES);
    }, shallow);

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
                            { backgroundColor: isUser ? theme.accent : theme.surface },
                        ]}
                    >
                        <Text style={[styles.text, { color: isUser ? palette.white : theme.text }]}>
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
            keyExtractor={(item) => item.id}
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
    bubble: { maxWidth: '80%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8 },
    text: { fontSize: 14, lineHeight: 20 },
});
