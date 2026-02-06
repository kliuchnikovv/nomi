import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useTheme } from '@genie/front/context/ThemeContext';
import { PluginMainScreenProps } from '@genie/front/plugins/types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { XmarkCircle } from 'iconoir-react-native';
import { getApiUrl } from '@genie/front/config';
import { authStore } from '@genie/front/apiClient';

interface TelegramMessage {
    id: string;
    role: string;
    text: string;
    created_at: number;
}

interface TelegramStatus {
    linked: boolean;
    username?: string;
    first_name?: string;
    display_name?: string;
}

export function TelegramMainScreen({ integrationId, onClose }: PluginMainScreenProps) {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
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

    useEffect(() => {
        loadStatus();
    }, [integrationId]);

    return (
        <View style={[styles.container, { backgroundColor: theme.background }]}>
            {/* Header */}
            <View style={[styles.header, { paddingTop: insets.top + 10, borderBottomColor: theme.border }]}>
                <View style={styles.headerRow}>
                    <View style={styles.headerLeft}>
                        <Text style={styles.headerIcon}>✈️</Text>
                        <Text style={[styles.title, { color: theme.text }]}>Telegram</Text>
                    </View>
                    {onClose && (
                        <Pressable onPress={onClose} hitSlop={12}>
                            <XmarkCircle width={24} height={24} color={theme.textSecondary} />
                        </Pressable>
                    )}
                </View>
            </View>

            <View style={styles.content}>
                {loading ? (
                    <View style={styles.center}>
                        <ActivityIndicator size="large" color={theme.accent} />
                    </View>
                ) : status?.linked ? (
                    <View style={styles.linkedState}>
                        <View style={[styles.statusBadge, { backgroundColor: '#e8f5e9' }]}>
                            <Text style={styles.statusIcon}>✅</Text>
                            <Text style={[styles.statusText, { color: '#2e7d32' }]}>
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
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        paddingHorizontal: 20,
        paddingBottom: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    headerIcon: {
        fontSize: 22,
    },
    title: {
        fontSize: 18,
        fontWeight: '700',
    },
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
