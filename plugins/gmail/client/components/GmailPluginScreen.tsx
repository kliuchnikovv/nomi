/**
 * Gmail Plugin Screen - Shows AI-analyzed email chats
 */

import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useTheme } from '@genie/front/context/ThemeContext';
import { PluginMainScreenProps } from '@genie/front/plugins/types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { XmarkCircle, Mail } from 'iconoir-react-native';
import { pluginChatStorage, PluginChat } from '@genie/front/services/plugins/PluginChatStorage';

export function GmailPluginScreen({ integrationId, onClose }: PluginMainScreenProps) {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const [chats, setChats] = useState<PluginChat[]>([]);
    const [loading, setLoading] = useState(true);

    const loadChats = async () => {
        try {
            const data = await pluginChatStorage.getPluginChats('gmail', 'email_chat');
            setChats(data);
        } catch (error) {
            console.error('[GmailPluginScreen] Failed to load chats:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadChats();
        // Refresh every 30 seconds to catch new background-processed emails
        const interval = setInterval(loadChats, 30000);
        return () => clearInterval(interval);
    }, [integrationId]);

    const renderChatItem = ({ item }: { item: PluginChat }) => {
        const metadata = item.data ? JSON.parse(item.data) : {};
        const fromName = metadata.fromName || metadata.from || 'Unknown';
        const date = item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : '';

        return (
            <Pressable
                style={({ pressed }) => [
                    styles.chatItem,
                    { backgroundColor: theme.card, borderColor: theme.border },
                    pressed && { opacity: 0.7 },
                ]}
            >
                <View style={styles.chatIcon}>
                    <Mail width={20} height={20} color={theme.accent} />
                </View>
                <View style={styles.chatContent}>
                    <View style={styles.chatHeader}>
                        <Text style={[styles.chatFrom, { color: theme.text }]} numberOfLines={1}>
                            {fromName}
                        </Text>
                        <Text style={[styles.chatDate, { color: theme.textSecondary }]}>
                            {date}
                        </Text>
                    </View>
                    <Text style={[styles.chatTitle, { color: theme.text }]} numberOfLines={1}>
                        {item.title}
                    </Text>
                    <View style={[styles.badge, { backgroundColor: theme.accent + '20' }]}>
                        <Text style={[styles.badgeText, { color: theme.accent }]}>
                            AI Analyzed
                        </Text>
                    </View>
                </View>
            </Pressable>
        );
    };

    return (
        <View style={[styles.container, { backgroundColor: theme.background }]}>
            {/* Header */}
            <View style={[styles.header, { paddingTop: insets.top + 10, borderBottomColor: theme.border }]}>
                <View style={styles.headerRow}>
                    <View style={styles.headerLeft}>
                        <Text style={styles.headerIcon}>📧</Text>
                        <Text style={[styles.title, { color: theme.text }]}>Email Insights</Text>
                    </View>
                    {onClose && (
                        <Pressable onPress={onClose} hitSlop={12}>
                            <XmarkCircle width={24} height={24} color={theme.textSecondary} />
                        </Pressable>
                    )}
                </View>
                <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
                    AI-analyzed unread emails
                </Text>
            </View>

            <View style={styles.content}>
                {loading ? (
                    <View style={styles.center}>
                        <ActivityIndicator size="large" color={theme.accent} />
                    </View>
                ) : chats.length > 0 ? (
                    <FlatList
                        data={chats}
                        keyExtractor={(item) => item.id}
                        renderItem={renderChatItem}
                        contentContainerStyle={styles.listContent}
                    />
                ) : (
                    <View style={styles.emptyState}>
                        <Text style={styles.emptyIcon}>📭</Text>
                        <Text style={[styles.emptyTitle, { color: theme.text }]}>
                            No Email Insights Yet
                        </Text>
                        <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                            When you receive unread emails, they will be automatically analyzed and appear here.
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
        marginBottom: 4,
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
    subtitle: {
        fontSize: 13,
        marginTop: 2,
    },
    content: {
        flex: 1,
    },
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    listContent: {
        padding: 16,
    },
    chatItem: {
        flexDirection: 'row',
        padding: 16,
        borderRadius: 12,
        marginBottom: 12,
        borderWidth: 1,
    },
    chatIcon: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#e3f2fd',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    chatContent: {
        flex: 1,
    },
    chatHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 4,
    },
    chatFrom: {
        fontSize: 13,
        fontWeight: '600',
        flex: 1,
        marginRight: 8,
    },
    chatDate: {
        fontSize: 11,
    },
    chatTitle: {
        fontSize: 15,
        fontWeight: '500',
        marginBottom: 6,
    },
    badge: {
        alignSelf: 'flex-start',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
    },
    badgeText: {
        fontSize: 11,
        fontWeight: '600',
    },
    emptyState: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 32,
    },
    emptyIcon: {
        fontSize: 48,
        marginBottom: 16,
    },
    emptyTitle: {
        fontSize: 18,
        fontWeight: '600',
        marginBottom: 8,
        textAlign: 'center',
    },
    emptyText: {
        fontSize: 14,
        textAlign: 'center',
        lineHeight: 20,
    },
});
