import React, { useEffect, useRef } from 'react';
import { FlatList, Text, View, StyleSheet } from 'react-native';
import { useChatStore } from '../../../store/chatStore';
import { useTheme } from '../../../context/ThemeContext';

interface Props {
    chatId: string;
}

const MAX_MESSAGES = 20;

export function VoiceTranscript({ chatId }: Props) {
    const { theme } = useTheme();
    const listRef = useRef<FlatList>(null);
    const messages = useChatStore((state) => {
        const all = state.chats[chatId] ?? [];
        return all.slice(-MAX_MESSAGES);
    });

    useEffect(() => {
        if (messages.length > 0) {
            listRef.current?.scrollToEnd({ animated: true });
        }
    }, [messages.length]);

    return (
        <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(item) => item.id}
            style={styles.list}
            contentContainerStyle={styles.content}
            renderItem={({ item }) => {
                const isUser = item.role === 'user';
                return (
                    <View style={[styles.row, isUser && styles.rowUser]}>
                        <View
                            style={[
                                styles.bubble,
                                { backgroundColor: isUser ? theme.accent : theme.surface },
                            ]}
                        >
                            <Text style={[styles.text, { color: isUser ? '#fff' : theme.text }]}>
                                {item.text?.trim() || '…'}
                            </Text>
                        </View>
                    </View>
                );
            }}
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
