import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useTheme } from '@genie/front/context/ThemeContext';
import { PluginMainScreenProps } from '@genie/front/plugins/types';
import { apiClient } from '@genie/front/apiClient';
import { getApiUrl } from '@genie/front/config';

interface TelegramMessage {
    id: string;
    role: string;
    text: string;
    created_at: number;
}

export function TelegramMainScreen({ integrationId, onClose }: PluginMainScreenProps) {
    const { theme } = useTheme();
    const [messages, setMessages] = useState<TelegramMessage[]>([]);
    const [loading, setLoading] = useState(true);
    const [linkToken, setLinkToken] = useState<string | null>(null);

    const loadMessages = async () => {
        if (!integrationId) return;
        try {
            setLoading(true);
            // Messages are stored as regular Genie chat messages
            // The integrationId can be used to find the associated chat
            // For now, show a placeholder
        } catch (error) {
            console.error('Failed to load Telegram messages:', error);
        } finally {
            setLoading(false);
        }
    };

    const generateLinkToken = async () => {
        try {
            const response = await apiClient.post<{ token: string; bot_link: string }>(
                `${getApiUrl()}/telegram/link-token`,
                {}
            );
            if (response) {
                setLinkToken(response.token);
            }
        } catch (error) {
            console.error('Failed to generate link token:', error);
        }
    };

    useEffect(() => {
        loadMessages();
    }, [integrationId]);

    return (
        <View style={[styles.container, { backgroundColor: theme.background }]}>
            <View style={styles.header}>
                <View style={styles.headerLeft}>
                    <Text style={styles.headerIcon}>✈️</Text>
                    <Text style={[styles.title, { color: theme.text }]}>Telegram Bot</Text>
                </View>
                {onClose && (
                    <Pressable onPress={onClose} style={styles.closeButton}>
                        <Text style={[styles.closeText, { color: theme.textSecondary }]}>✕</Text>
                    </Pressable>
                )}
            </View>

            <View style={styles.content}>
                {loading ? (
                    <ActivityIndicator size="large" color={theme.accent} />
                ) : messages.length > 0 ? (
                    <FlatList
                        data={messages}
                        keyExtractor={(item) => item.id}
                        renderItem={({ item }) => (
                            <View style={[
                                styles.messageItem,
                                item.role === 'user' ? styles.userMessage : styles.assistantMessage,
                            ]}>
                                <Text style={[styles.messageRole, { color: theme.textSecondary }]}>
                                    {item.role === 'user' ? 'You (Telegram)' : 'Genie'}
                                </Text>
                                <Text style={[styles.messageText, { color: theme.text }]}>
                                    {item.text}
                                </Text>
                            </View>
                        )}
                    />
                ) : (
                    <View style={styles.emptyState}>
                        <Text style={[styles.emptyTitle, { color: theme.text }]}>
                            Telegram Bot Integration
                        </Text>
                        <Text style={[styles.emptySubtext, { color: theme.textSecondary }]}>
                            Link your Telegram account to chat with Genie via Telegram.
                        </Text>

                        <Pressable
                            style={[styles.linkButton, { backgroundColor: '#0088cc' }]}
                            onPress={generateLinkToken}
                        >
                            <Text style={styles.linkButtonText}>Generate Link Token</Text>
                        </Pressable>

                        {linkToken && (
                            <View style={styles.tokenContainer}>
                                <Text style={[styles.tokenLabel, { color: theme.textSecondary }]}>
                                    Send this to @genie_bot:
                                </Text>
                                <Text style={[styles.tokenText, { color: theme.text }]} selectable>
                                    /start {linkToken}
                                </Text>
                            </View>
                        )}
                    </View>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    headerIcon: {
        fontSize: 22,
    },
    title: {
        fontSize: 18,
        fontWeight: '600',
    },
    closeButton: {
        padding: 8,
    },
    closeText: {
        fontSize: 18,
        fontWeight: '600',
    },
    content: {
        flex: 1,
        padding: 16,
    },
    messageItem: {
        padding: 12,
        borderRadius: 12,
        marginBottom: 8,
    },
    userMessage: {
        backgroundColor: '#e3f2fd',
        alignSelf: 'flex-end',
        maxWidth: '80%',
    },
    assistantMessage: {
        backgroundColor: '#f5f5f5',
        alignSelf: 'flex-start',
        maxWidth: '80%',
    },
    messageRole: {
        fontSize: 11,
        fontWeight: '600',
        marginBottom: 4,
    },
    messageText: {
        fontSize: 15,
        lineHeight: 20,
    },
    emptyState: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 32,
    },
    emptyTitle: {
        fontSize: 18,
        fontWeight: '600',
        marginBottom: 8,
    },
    emptySubtext: {
        fontSize: 14,
        textAlign: 'center',
        marginBottom: 24,
        lineHeight: 20,
    },
    linkButton: {
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 8,
        marginBottom: 16,
    },
    linkButtonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: '600',
    },
    tokenContainer: {
        alignItems: 'center',
        padding: 16,
        backgroundColor: '#f5f5f5',
        borderRadius: 12,
        width: '100%',
    },
    tokenLabel: {
        fontSize: 13,
        marginBottom: 8,
    },
    tokenText: {
        fontSize: 16,
        fontWeight: '600',
        fontFamily: 'monospace',
    },
});
