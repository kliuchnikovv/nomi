/**
 * Gmail Plugin Screen - Shows AI-analyzed email chats
 */

import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useTheme } from '@genie/front/context/ThemeContext';
import { PluginMainScreenProps } from '@genie/front/plugins/types';
import { Mail } from 'iconoir-react-native';
import { pluginChatStorage, PluginChat } from '@genie/front/services/plugins/PluginChatStorage';
import { SharedPluginScreen } from '@genie/front/plugins/components/SharedPluginScreen';
import { contextStore } from '@genie/front/services/ContextStore';

export function GmailPluginScreen({ integrationId, onClose }: PluginMainScreenProps) {
    const { theme } = useTheme();
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

    const handleChatPress = useCallback(async (chat: PluginChat) => {
        console.log('[GmailPluginScreen] handleChatPress called, chat:', chat.id);

        try {
            const metadata = chat.data ? JSON.parse(chat.data) : {};

            contextStore.add({
                id: chat.id,
                sourceType: 'email',
                title: chat.title,
                preview: metadata.snippet || metadata.body?.substring(0, 100) || '',
                metadata: {
                    emailId: metadata.emailId,
                    from: metadata.from,
                    fromName: metadata.fromName,
                    subject: chat.title,
                    body: metadata.body,
                    snippet: metadata.snippet,
                    integrationId: integrationId,
                },
                addedAt: Date.now(),
            });

            console.log('[GmailPluginScreen] Email added to context, closing...');
            onClose?.(true);
        } catch (error) {
            console.error('[GmailPluginScreen] Error:', error);
        }
    }, [integrationId, onClose]);

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
                onPress={() => handleChatPress(item)}
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
        <SharedPluginScreen title="Email Insights" onClose={onClose}>
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
        </SharedPluginScreen>
    );
}

const styles = StyleSheet.create({
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
