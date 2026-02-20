/**
 * Calendar Plugin Screen - Shows AI-analyzed event chats
 */

import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator, RefreshControl, ScrollView } from 'react-native';
import { useTheme } from '@genie/front/context/ThemeContext';
import { PluginMainScreenProps } from '@genie/front/plugins/types';
import { Calendar } from 'iconoir-react-native';
import { pluginChatStorage, PluginChat } from '@genie/front/services/plugins/PluginChatStorage';
import { calendarClient } from '@genie/front/services/integrations/clients/CalendarClient';
import { contextStore } from '@genie/front/services/ContextStore';
import { integrationStorage } from '@genie/front/services/integrations/IntegrationStorage';
import { SharedPluginScreen } from '@genie/front/plugins/components/SharedPluginScreen';

export function CalendarPluginScreen({ integrationId, onClose }: PluginMainScreenProps) {
    const { theme } = useTheme();
    const [chats, setChats] = useState<PluginChat[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [integrationName, setIntegrationName] = useState<string>('Calendar');

    useEffect(() => {
        const loadIntegrationName = async () => {
            if (!integrationId) return;
            try {
                const integrations = await integrationStorage.getIntegrations();
                const found = integrations.find((i) => i.id === integrationId);
                if (found) {
                    setIntegrationName(found.name || 'Calendar');
                }
            } catch (error) {
                console.error('[CalendarPluginScreen] Failed to load integration name:', error);
            }
        };
        loadIntegrationName();
    }, [integrationId]);

    const loadChats = async () => {
        try {
            const data = await pluginChatStorage.getPluginChats('calendar', 'event_chat', integrationId);
            setChats(data);
        } catch (error) {
            console.error('[CalendarPluginScreen] Failed to load chats:', error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        try {
            if (integrationId) {
                await calendarClient.onWake(integrationId);
            }
            await loadChats();
        } catch (error) {
            console.error('[CalendarPluginScreen] Refresh failed:', error);
            setRefreshing(false);
        }
    }, [integrationId]);

    useEffect(() => {
        loadChats();
        // Refresh every 30 seconds to catch new background-processed events
        const interval = setInterval(loadChats, 30000);
        return () => clearInterval(interval);
    }, [integrationId]);

    const handleChatPress = async (chat: PluginChat) => {
        console.log('[CalendarPluginScreen] handleChatPress called, chat:', chat.id);

        try {
            const metadata = chat.data ? JSON.parse(chat.data) : {};

            contextStore.add({
                id: chat.id,
                sourceType: 'calendar_event',
                title: chat.title,
                preview: metadata.start ? new Date(metadata.start).toLocaleString() : '',
                metadata: {
                    eventId: metadata.eventId,
                    title: chat.title,
                    start: metadata.start,
                    end: metadata.end,
                    location: metadata.location,
                    status: metadata.status,
                    integrationId: integrationId,
                },
                addedAt: Date.now(),
            });

            console.log('[CalendarPluginScreen] Event added to context, closing...');
            onClose?.(true);
        } catch (error) {
            console.error('[CalendarPluginScreen] Error:', error);
        }
    };

    const renderChatItem = ({ item }: { item: PluginChat }) => {
        const metadata = item.data ? JSON.parse(item.data) : {};
        const startDate = metadata.start ? new Date(metadata.start).toLocaleDateString() : '';
        const location = metadata.location || '';

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
                    <Calendar width={20} height={20} color={theme.accent} />
                </View>
                <View style={styles.chatContent}>
                    <View style={styles.chatHeader}>
                        <Text style={[styles.chatTitle, { color: theme.text }]} numberOfLines={1}>
                            {item.title}
                        </Text>
                        <Text style={[styles.chatDate, { color: theme.textSecondary }]}>
                            {startDate}
                        </Text>
                    </View>
                    {location ? (
                        <Text style={[styles.chatLocation, { color: theme.textSecondary }]} numberOfLines={1}>
                            📍 {location}
                        </Text>
                    ) : null}
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
        <SharedPluginScreen title={integrationName} onClose={onClose}>
            <ScrollView
                style={styles.content}
                contentContainerStyle={chats.length === 0 ? styles.emptyContainer : undefined}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={onRefresh}
                        tintColor={theme.accent}
                        colors={[theme.accent]}
                    />
                }
            >
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
                        scrollEnabled={false}
                    />
                ) : (
                    <View style={styles.emptyState}>
                        <Text style={styles.emptyIcon}>🗓️</Text>
                        <Text style={[styles.emptyTitle, { color: theme.text }]}>
                            No Event Insights Yet
                        </Text>
                        <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                            When you have upcoming events, they will be automatically analyzed and appear here.
                        </Text>
                        <Pressable
                            style={[styles.refreshButton, { backgroundColor: theme.accent }]}
                            onPress={onRefresh}
                        >
                            <Text style={styles.refreshButtonText}>Refresh</Text>
                        </Pressable>
                    </View>
                )}
            </ScrollView>
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
        backgroundColor: '#e8f5e9',
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
    chatTitle: {
        fontSize: 15,
        fontWeight: '600',
        flex: 1,
        marginRight: 8,
    },
    chatDate: {
        fontSize: 11,
    },
    chatLocation: {
        fontSize: 13,
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
    emptyContainer: {
        flex: 1,
    },
    refreshButton: {
        marginTop: 20,
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 8,
    },
    refreshButtonText: {
        color: '#fff',
        fontSize: 15,
        fontWeight: '600',
    },
});
