import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { useTheme } from '@genie/front/context/ThemeContext';
import { PluginMainScreenProps } from '@genie/front/plugins/types';
import { getApiUrl } from '@genie/front/config';
import { authStore } from '@genie/front/apiClient';
import { SharedPluginScreen } from '@genie/front/plugins/components/SharedPluginScreen';
import { palette } from '@genie/front/themes';

interface TelegramMessage {
    id: string;
    role: string;
    text: string;
    created_at: string;
}

interface TelegramStatus {
    linked: boolean;
    username?: string;
    first_name?: string;
    display_name?: string;
}

const withAlpha = (hex: string, alpha: number) => {
    const h = hex.replace('#', '');
    const bigint = parseInt(h, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

export function TelegramMainScreen({ integrationId, onClose }: PluginMainScreenProps) {
    const { theme } = useTheme();
    const [messages, setMessages] = useState<TelegramMessage[]>([]);
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState<TelegramStatus | null>(null);

    const loadStatus = async () => {
        try {
            const apiUrl = getApiUrl();
            const token = authStore.getToken();
            if (!token) return;

            const response = await fetch(`${apiUrl}/telegram/status`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (response.ok) {
                const data = await response.json();
                setStatus(data);
            }
        } catch (error) {
            console.error('Failed to load Telegram status:', error);
        } finally {
            setLoading(false);
        }
    };

    const loadMessages = async () => {
        try {
            const apiUrl = getApiUrl();
            const token = authStore.getToken();
            if (!token) return;

            const response = await fetch(`${apiUrl}/telegram/messages`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (response.ok) {
                const data = await response.json();
                setMessages(data.messages || []);
            }
        } catch (error) {
            console.error('Failed to load Telegram messages:', error);
        }
    };

    useEffect(() => {
        loadStatus();
    }, [integrationId]);

    useEffect(() => {
        if (status?.linked) {
            loadMessages();
            const interval = setInterval(loadMessages, 10000);
            return () => clearInterval(interval);
        }
    }, [status?.linked]);

    return (
        <SharedPluginScreen title="Telegram" onClose={onClose}>
            <View style={styles.content}>
                {loading ? (
                    <View style={styles.center}>
                        <ActivityIndicator size="large" color={theme.accent} />
                    </View>
                ) : status?.linked ? (
                    <View style={styles.linkedState}>
                        <View style={[styles.statusBadge, { backgroundColor: withAlpha(palette.green, 0.15) }]}>
                            <Text style={styles.statusIcon}>✅</Text>
                            <Text style={[styles.statusText, { color: palette.green }]}>
                                Connected as {status.display_name}
                            </Text>
                        </View>

                        <Text style={[styles.infoText, { color: theme.textSecondary }]}>
                            Messages sent to @genie_bot in Telegram will be processed by your AI assistant.
                        </Text>

                        {messages.length > 0 ? (
                            <FlatList
                                data={messages}
                                keyExtractor={(item) => item.id}
                                style={styles.messageList}
                                renderItem={({ item }) => (
                                    <View style={[
                                        styles.messageItem,
                                        item.role === 'user' 
                                            ? { ...styles.userMessage, backgroundColor: withAlpha(palette.blue, 0.15) } 
                                            : { ...styles.assistantMessage, backgroundColor: theme.surfaceHighlight },
                                    ]}>
                                        <Text style={[styles.messageRole, { color: theme.textSecondary }]}>
                                            {item.role === 'user' ? 'You (Telegram)' : 'Nomi'}
                                        </Text>
                                        <Text style={[styles.messageText, { color: theme.text }]}>
                                            {item.text}
                                        </Text>
                                    </View>
                                )}
                            />
                        ) : (
                            <Text style={[styles.emptyMessages, { color: theme.textSecondary }]}>
                                No messages yet. Start chatting with @genie_bot in Telegram!
                            </Text>
                        )}
                    </View>
                ) : (
                    <View style={styles.unlinkedState}>
                        <Text style={[styles.emptyTitle, { color: theme.text }]}>
                            Telegram Not Connected
                        </Text>
                        <Text style={[styles.emptySubtext, { color: theme.textSecondary }]}>
                            Connect your Telegram account through Settings → Integrations → Telegram.
                        </Text>
                    </View>
                )}
            </View>
        </SharedPluginScreen>
    );
}

const styles = StyleSheet.create({
    content: {
        flex: 1,
        padding: 16,
    },
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    linkedState: {
        flex: 1,
    },
    statusBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 12,
        marginBottom: 16,
    },
    statusIcon: {
        fontSize: 16,
    },
    statusText: {
        fontSize: 15,
        fontWeight: '600',
    },
    infoText: {
        fontSize: 14,
        lineHeight: 20,
        marginBottom: 20,
    },
    messageList: {
        flex: 1,
    },
    messageItem: {
        padding: 12,
        borderRadius: 12,
        marginBottom: 8,
    },
    userMessage: {
        alignSelf: 'flex-end',
        maxWidth: '80%',
    },
    assistantMessage: {
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
    emptyMessages: {
        fontSize: 14,
        textAlign: 'center',
        marginTop: 24,
    },
    unlinkedState: {
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
        lineHeight: 20,
    },
});
