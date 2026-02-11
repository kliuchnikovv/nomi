/**
 * Calendar Chat View - Shows conversation with AI about a specific event
 */

import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { useTheme } from '@genie/front/context/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Trash } from 'iconoir-react-native';
import { pluginChatStorage, PluginMessage } from '@genie/front/services/plugins/PluginChatStorage';

interface CalendarChatViewProps {
    chatId: string;
    navigation?: any;
    onClose?: () => void;
}

export function CalendarChatView({ chatId, navigation, onClose }: CalendarChatViewProps) {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const [messages, setMessages] = useState<PluginMessage[]>([]);
    const [chatTitle, setChatTitle] = useState('');
    const [loading, setLoading] = useState(true);

    const loadMessages = async () => {
        try {
            const chat = await pluginChatStorage.getPluginChatById(chatId);
            if (chat) {
                setChatTitle(chat.title);
            }

            const data = await pluginChatStorage.getMessages(chatId);
            setMessages(data);
        } catch (error) {
            console.error('[CalendarChatView] Failed to load messages:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadMessages();
    }, [chatId]);

    const handleBack = () => {
        if (navigation) {
            navigation.goBack();
        } else if (onClose) {
            onClose();
        }
    };

    const handleDelete = async () => {
        try {
            await pluginChatStorage.deletePluginChat(chatId);
            handleBack();
        } catch (error) {
            console.error('[CalendarChatView] Failed to delete chat:', error);
        }
    };

    const renderMessage = (message: PluginMessage) => {
        const isUser = message.role === 'user';

        return (
            <View
                key={message.id}
                style={[
                    styles.messageContainer,
                    isUser ? styles.userMessage : styles.assistantMessage,
                ]}
            >
                <Text style={[styles.messageRole, { color: theme.textSecondary }]}>
                    {isUser ? 'Event Details' : 'AI Analysis'}
                </Text>
                <Text style={[styles.messageContent, { color: theme.text }]}>
                    {message.content}
                </Text>
                <Text style={[styles.messageTime, { color: theme.textSecondary }]}>
                    {new Date(message.createdAt).toLocaleString()}
                </Text>
            </View>
        );
    };

    return (
        <View style={[styles.container, { backgroundColor: theme.background }]}>
            {/* Header */}
            <View style={[styles.header, { paddingTop: insets.top + 10, borderBottomColor: theme.border }]}>
                <View style={styles.headerRow}>
                    <Pressable onPress={handleBack} style={styles.backButton} hitSlop={12}>
                        <ArrowLeft width={24} height={24} color={theme.text} />
                    </Pressable>
                    <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
                        {chatTitle || 'Event Chat'}
                    </Text>
                    <Pressable onPress={handleDelete} style={styles.deleteButton} hitSlop={12}>
                        <Trash width={20} height={20} color={theme.textSecondary} />
                    </Pressable>
                </View>
            </View>

            {/* Messages */}
            {loading ? (
                <View style={styles.center}>
                    <ActivityIndicator size="large" color={theme.accent} />
                </View>
            ) : (
                <ScrollView
                    style={styles.messagesContainer}
                    contentContainerStyle={styles.messagesContent}
                >
                    {messages.map(renderMessage)}
                </ScrollView>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        paddingHorizontal: 16,
        paddingBottom: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    backButton: {
        padding: 4,
    },
    title: {
        flex: 1,
        fontSize: 17,
        fontWeight: '600',
    },
    deleteButton: {
        padding: 4,
    },
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    messagesContainer: {
        flex: 1,
    },
    messagesContent: {
        padding: 16,
    },
    messageContainer: {
        padding: 14,
        borderRadius: 12,
        marginBottom: 12,
    },
    userMessage: {
        backgroundColor: '#e8f5e9',
    },
    assistantMessage: {
        backgroundColor: '#f5f5f5',
    },
    messageRole: {
        fontSize: 11,
        fontWeight: '700',
        textTransform: 'uppercase',
        marginBottom: 6,
        letterSpacing: 0.5,
    },
    messageContent: {
        fontSize: 15,
        lineHeight: 22,
        marginBottom: 8,
    },
    messageTime: {
        fontSize: 11,
        textAlign: 'right',
    },
});
