/**
 * Gmail Plugin Screen - Shows AI-analyzed email chats and background task activity log.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useTheme } from '@nomi/front/context/ThemeContext';
import { PluginMainScreenProps } from '@nomi/front/plugins/types';
import { Mail } from 'iconoir-react-native';
import { pluginChatStorage, PluginChat } from '@nomi/front/services/plugins/PluginChatStorage';
import { SharedPluginScreen } from '@nomi/front/plugins/components/SharedPluginScreen';
import { contextStore } from '@nomi/front/services/ContextStore';
import { backgroundLogger, BackgroundRunLog, EmailAction } from '../backgroundLogger';
import { backgroundTask } from '../background';

// ─── Background Activity helpers ─────────────────────────────────────────────

const ACTION_LABELS: Record<EmailAction, string> = {
    reminder_created: '🔔 Reminder created',
    already_seen: '⏭ Already seen',
    not_important: '✉️ Not important',
    reminder_failed: '❌ Reminder failed',
    skipped_no_permission: '🔒 No permission',
};

function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

function runSummary(log: BackgroundRunLog): string {
    const created = log.entries.filter(e => e.action === 'reminder_created').length;
    const parts: string[] = [`${log.totalFound} found`];
    if (created > 0) parts.push(`${created} reminder${created > 1 ? 's' : ''} 🔔`);
    return parts.join(' · ');
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GmailPluginScreen({ integrationId, onClose }: PluginMainScreenProps) {
    const { theme } = useTheme();
    const [chats, setChats] = useState<PluginChat[]>([]);
    const [runLogs, setRunLogs] = useState<BackgroundRunLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [running, setRunning] = useState(false);

    const loadData = useCallback(async () => {
        try {
            const [chatData, logs] = await Promise.all([
                pluginChatStorage.getPluginChats('gmail', 'email_chat'),
                integrationId ? backgroundLogger.getLogs(integrationId) : Promise.resolve([]),
            ]);
            setChats(chatData);
            setRunLogs(logs);
        } catch (error) {
            console.error('[GmailPluginScreen] Failed to load data:', error);
        } finally {
            setLoading(false);
        }
    }, [integrationId]);

    useEffect(() => {
        loadData();
        const interval = setInterval(loadData, 30000);
        return () => clearInterval(interval);
    }, [loadData]);

    const handleChatPress = useCallback(async (chat: PluginChat) => {
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
                    integrationId,
                },
                addedAt: Date.now(),
            });
            onClose?.(true);
        } catch (error) {
            console.error('[GmailPluginScreen] Error:', error);
        }
    }, [integrationId, onClose]);

    const handleClearLogs = useCallback(async () => {
        if (!integrationId) return;
        await backgroundLogger.clearLogs(integrationId);
        setRunLogs([]);
    }, [integrationId]);

    const handleRunNow = useCallback(async () => {
        if (!integrationId || running) return;
        setRunning(true);
        try {
            await backgroundTask(integrationId);
            await loadData();
        } finally {
            setRunning(false);
        }
    }, [integrationId, running, loadData]);

    // ─── Background Activity section (header) ────────────────────────────────

    const renderBackgroundActivity = () => {
        const recentRuns = [...runLogs].reverse().slice(0, 5);

        return (
            <View style={[styles.activitySection, { borderColor: theme.border }]}>
                <View style={styles.activityHeader}>
                    <Text style={[styles.activityTitle, { color: theme.text }]}>
                        Background Activity
                    </Text>
                    <View style={styles.activityActions}>
                        <Pressable
                            onPress={handleRunNow}
                            disabled={running}
                            hitSlop={8}
                            style={[styles.runBtn, { backgroundColor: theme.accent + '18' }]}
                        >
                            {running
                                ? <ActivityIndicator size="small" color={theme.accent} />
                                : <Text style={[styles.runBtnText, { color: theme.accent }]}>▶ Run Now</Text>
                            }
                        </Pressable>
                        {recentRuns.length > 0 && (
                            <Pressable onPress={handleClearLogs} hitSlop={8}>
                                <Text style={[styles.clearBtn, { color: theme.textSecondary }]}>
                                    Clear
                                </Text>
                            </Pressable>
                        )}
                    </View>
                </View>

                {recentRuns.length === 0 ? (
                    <Text style={[styles.activityEmpty, { color: theme.textSecondary }]}>
                        No background runs yet. Trigger one via Xcode → Debug → Simulate Background Fetch.
                    </Text>
                ) : (
                    recentRuns.map((log, idx) => (
                        <View
                            key={log.timestamp}
                            style={[
                                styles.runCard,
                                { backgroundColor: theme.card, borderColor: theme.border },
                            ]}
                        >
                            <View style={styles.runHeader}>
                                <Text style={[styles.runTime, { color: theme.textSecondary }]}>
                                    {relativeTime(log.timestamp)}
                                </Text>
                                <Text style={[styles.runSummary, { color: theme.text }]}>
                                    {runSummary(log)}
                                </Text>
                            </View>

                            {/* Show per-email details for the latest run */}
                            {idx === 0 && log.entries.length > 0 && (
                                <View style={styles.entryList}>
                                    {log.entries.map((entry, i) => (
                                        <View key={i} style={styles.entryRow}>
                                            <Text
                                                style={[styles.entryAction, { color: theme.textSecondary }]}
                                                numberOfLines={1}
                                            >
                                                {ACTION_LABELS[entry.action]}
                                            </Text>
                                            <Text
                                                style={[styles.entrySubject, { color: theme.text }]}
                                                numberOfLines={1}
                                            >
                                                {entry.subject}
                                            </Text>
                                        </View>
                                    ))}
                                </View>
                            )}
                        </View>
                    ))
                )}
            </View>
        );
    };

    // ─── Chat item ────────────────────────────────────────────────────────────

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

    // ─── Render ───────────────────────────────────────────────────────────────

    if (loading) {
        return (
            <SharedPluginScreen title="Email Insights" onClose={onClose}>
                <View style={styles.center}>
                    <ActivityIndicator size="large" color={theme.accent} />
                </View>
            </SharedPluginScreen>
        );
    }

    return (
        <SharedPluginScreen title="Email Insights" onClose={onClose}>
            <FlatList
                data={chats}
                keyExtractor={(item) => item.id}
                renderItem={renderChatItem}
                ListHeaderComponent={renderBackgroundActivity()}
                ListEmptyComponent={
                    <View style={styles.emptyState}>
                        <Text style={styles.emptyIcon}>📭</Text>
                        <Text style={[styles.emptyTitle, { color: theme.text }]}>
                            No Email Insights Yet
                        </Text>
                        <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                            When you receive unread emails, they will be automatically analyzed and appear here.
                        </Text>
                    </View>
                }
                contentContainerStyle={styles.listContent}
            />
        </SharedPluginScreen>
    );
}

const styles = StyleSheet.create({
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    listContent: {
        padding: 16,
        flexGrow: 1,
    },
    // ─── Background Activity ────────────────────────────────────────────────
    activitySection: {
        marginBottom: 20,
        paddingBottom: 16,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    activityHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
    },
    activityTitle: {
        fontSize: 13,
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    activityActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    runBtn: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 6,
        minWidth: 72,
        alignItems: 'center',
        justifyContent: 'center',
    },
    runBtnText: {
        fontSize: 12,
        fontWeight: '600',
    },
    clearBtn: {
        fontSize: 13,
    },
    activityEmpty: {
        fontSize: 13,
        lineHeight: 18,
    },
    runCard: {
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
        padding: 12,
        marginBottom: 8,
    },
    runHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    runTime: {
        fontSize: 11,
        marginRight: 8,
    },
    runSummary: {
        fontSize: 13,
        fontWeight: '500',
        flex: 1,
        textAlign: 'right',
    },
    entryList: {
        marginTop: 8,
        gap: 4,
    },
    entryRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    entryAction: {
        fontSize: 11,
        width: 140,
        flexShrink: 0,
    },
    entrySubject: {
        fontSize: 12,
        flex: 1,
    },
    // ─── Chat list ────────────────────────────────────────────────────────────
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
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 32,
        paddingVertical: 40,
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
