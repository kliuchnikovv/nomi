import React, { useState, useEffect } from 'react';
import {
    ActionSheetIOS,
    ActivityIndicator,
    Alert,
    FlatList,
    Linking,
    Pressable,
    Text,
    View,
} from 'react-native';
import Markdown from 'react-native-markdown-display';
import InAppBrowser from 'react-native-inappbrowser-reborn';

import { InboxAction, InboxMessage, InboxResponseData } from './models';
import { NavArrowDown, NavArrowRight } from 'iconoir-react-native';
import { styles } from './styles.tsx';
import { useInbox } from './context';
import { oneDark, oneDarkPalette } from '../../themes/oneDark.ts';

type Props = {
    width: number;
    isOpen: boolean;
};

const getImportanceColor = (level: string) => {
    switch (level) {
        case 'high': return oneDarkPalette.red;
        case 'medium': return oneDarkPalette.yellow;
        case 'low': return oneDarkPalette.blue;
        default: return oneDarkPalette.commentGrey;
    }
};

const StructuredInboxItem = ({ data, messageId }: { data: InboxResponseData; messageId: string }) => {
    const [executingAction, setExecutingAction] = useState<string | null>(null);
    const { executeAction } = useInbox();

    const handleAction = async (action: InboxAction) => {
        // Special handling for open_web - doesn't need backend call
        if (action.command === 'open_web' && action.url) {
            try {
                const isAvailable = await InAppBrowser.isAvailable();
                if (isAvailable) {
                    await InAppBrowser.open(
                        action.url,
                        {
                            ephemeralWebSession: false,
                            dismissButtonStyle: 'cancel',
                            showTitle: true,
                            enableDefaultShare: true,
                        }
                    );
                } else {
                    await Linking.openURL(action.url);
                }
            } catch (error) {
                console.warn('Failed to open URL in InAppBrowser:', error);
                Alert.alert('Error', 'Failed to open URL');
            }
            return;
        }

        // Special handling for unsubscribe - open URL in browser
        if (action.command === 'unsubscribe' && action.url) {
            try {
                const isAvailable = await InAppBrowser.isAvailable();
                if (isAvailable) {
                    await InAppBrowser.open(
                        action.url,
                        {
                            ephemeralWebSession: false,
                            dismissButtonStyle: 'cancel',
                            showTitle: true,
                            enableDefaultShare: true,
                        }
                    );
                } else {
                    await Linking.openURL(action.url);
                }
            } catch (error) {
                console.warn('Failed to open unsubscribe URL:', error);
                Alert.alert('Error', 'Failed to open unsubscribe link');
            }
            return;
        }

        // All other actions go through the backend
        setExecutingAction(action.command);
        try {
            await executeAction(messageId, action);
            Alert.alert('Success', `${action.label} completed successfully`);
        } catch (error) {
            console.error('Failed to execute action:', error);
            Alert.alert('Error', error instanceof Error ? error.message : 'Failed to execute action');
        } finally {
            setExecutingAction(null);
        }
    };

    return (
        <View style={styles.structuredContainer}>
            <Text style={styles.structuredTitle}>{data.title}</Text>

            <Text style={styles.summary}>{data.summary}</Text>

            {data.actions && data.actions.length > 0 && (
                <View style={styles.actionsContainer}>
                    {data.actions.map((action, index) => (
                        <Pressable
                            key={index}
                            style={[
                                styles.actionButton,
                                executingAction === action.command && styles.actionButtonExecuting,
                            ]}
                            onPress={() => handleAction(action)}
                            disabled={executingAction === action.command}
                        >
                            {executingAction === action.command ? (
                                <ActivityIndicator size="small" color={oneDark.blue} />
                            ) : (
                                <Text style={styles.actionText}>{action.label}</Text>
                            )}
                        </Pressable>
                    ))}
                </View>
            )}

            {data.missing_info ? (
                <View style={styles.missingInfo}>
                    <Text style={styles.missingInfoText}>Missing Info: {data.missing_info}</Text>
                </View>
            ) : null}
        </View>
    );
};

export default function RightSidebar({ width, isOpen }: Props) {
    const [inboxExpanded, setInboxExpanded] = useState(true);
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
    const { messages, loading, error, markAsRead, loadMore, refresh } = useInbox();

    const [refreshing, setRefreshing] = useState(false);

    const onRefresh = async () => {
        setRefreshing(true);
        await refresh();
        setRefreshing(false);
    };

    const toggleExpansion = (id: string) => {
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const openMenu = (item: InboxMessage) => {
        ActionSheetIOS.showActionSheetWithOptions(
            {
                options: [
                    item.status === 'read' ? 'Mark as Unread' : 'Mark as Read',
                    'Delete',
                    'Cancel',
                ],
                destructiveButtonIndex: 1,
                cancelButtonIndex: 2,
            },
            async (i) => {
                if (i === 0) {
                    try {
                        if (item.status !== 'read') {
                            await markAsRead(item.id);
                        }
                        // TODO: Implement mark as unread when API supports it
                    } catch (err) {
                        console.error('Failed to update message status:', err);
                    }
                }
                // TODO: Implement delete when API supports it
            }
        );
    };

    const formatTimestamp = (timestamp: string) => {
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 60) {
            return `${diffMins}m ago`;
        } else if (diffHours < 24) {
            return `${diffHours}h ago`;
        } else if (diffDays < 7) {
            return `${diffDays}d ago`;
        } else {
            return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
        }
    };

    const parseResponse = (response?: string | InboxResponseData): InboxResponseData | null => {
        if (!response) return null;
        if (typeof response === 'object') return response;
        try {
            return JSON.parse(response);
        } catch (e) {
            return null;
        }
    };

    const unreadCount = messages.filter(item => item.status !== 'read').length;

    // Refresh inbox when the sidebar becomes open
    useEffect(() => {
        if (isOpen) {
            refresh();
        }
    }, [isOpen]);

    if (error) {
        return (
            <View style={[styles.root, { width }]}>
                <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>Inbox</Text>
                </View>
                <View style={styles.emptyState}>
                    <Text style={styles.emptyText}>Error: {error}</Text>
                    <Pressable onPress={refresh} style={{ marginTop: 12 }}>
                        <Text style={[styles.emptyText, { textDecorationLine: 'underline' }]}>
                            Retry
                        </Text>
                    </Pressable>
                </View>
            </View>
        );
    }

    return (
        <View style={[styles.root, { width }]}>
            <Pressable
                style={styles.sectionHeader}
                onPress={() => setInboxExpanded(!inboxExpanded)}
            >
                <View style={styles.sectionHeaderRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={styles.sectionTitle}>Inbox</Text>
                        {unreadCount > 0 && (
                            <Text style={styles.sectionCount}>({unreadCount})</Text>
                        )}
                    </View>
                    {inboxExpanded ? (
                        <NavArrowDown
                            width={20}
                            height={20}
                            color={styles.expandIcon.color}
                        />
                    ) : (
                        <NavArrowRight
                            width={20}
                            height={20}
                            color={styles.expandIcon.color}
                        />
                    )}
                </View>
            </Pressable>
            {inboxExpanded && (
                loading && messages.length === 0 ? (
                    <View style={styles.emptyState}>
                        <ActivityIndicator size="large" color="#61AFEF" />
                    </View>
                ) : messages.length === 0 ? (
                    <View style={styles.emptyState}>
                        <Text style={styles.emptyText}>No messages</Text>
                    </View>
                ) : (
                    <FlatList
                        data={messages}
                        keyExtractor={item => item.id}
                        contentContainerStyle={styles.listContent}
                        refreshing={refreshing}
                        onRefresh={onRefresh}
                        renderItem={({ item }) => {
                            const isExpanded = expandedIds.has(item.id);
                            const structuredData = parseResponse(item.response);

                            return (
                                <Pressable
                                    onPress={() => toggleExpansion(item.id)}
                                    style={[
                                        styles.inboxItem,
                                        item.status !== 'read' && styles.inboxItemUnread,
                                    ]}
                                    onLongPress={() => openMenu(item)}
                                >
                                    <View style={styles.inboxHeader}>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 8 }}>
                                            <Text style={styles.sender} numberOfLines={1}>
                                                {item.sender}
                                            </Text>
                                            {structuredData && (
                                                <View style={{
                                                    backgroundColor: getImportanceColor(structuredData.importance.level) + '20',
                                                    paddingHorizontal: 6,
                                                    paddingVertical: 2,
                                                    borderRadius: 4,
                                                }}>
                                                    <Text style={{
                                                        fontSize: 10,
                                                        color: getImportanceColor(structuredData.importance.level),
                                                        fontWeight: '600',
                                                        textTransform: 'uppercase',
                                                    }}>
                                                        {structuredData.importance.level}
                                                    </Text>
                                                </View>
                                            )}
                                        </View>
                                        <Text style={styles.timestamp}>
                                            {formatTimestamp(item.received_at)}
                                        </Text>
                                    </View>
                                    <Text style={styles.subject} numberOfLines={1}>
                                        {item.subject}
                                    </Text>
                                    {isExpanded ? (
                                        <View style={{ marginTop: 4 }}>
                                            {structuredData ? (
                                                <StructuredInboxItem data={structuredData} messageId={item.id} />
                                            ) : (
                                                <Markdown
                                                    style={{
                                                        body: { color: '#ABB2BF', fontSize: 14 },
                                                        paragraph: { marginVertical: 4 },
                                                    }}
                                                >
                                                    {typeof item.response === 'string' ? item.response : (item.body || item.snippet)}
                                                </Markdown>
                                            )}
                                        </View>
                                    ) : (
                                        <Text style={styles.preview} numberOfLines={2}>
                                            {item.snippet}
                                        </Text>
                                    )}
                                </Pressable>
                            );
                        }}
                        onEndReached={loadMore}
                        onEndReachedThreshold={0.5}
                        ListFooterComponent={
                            loading && !refreshing && messages.length > 0 ? (
                                <ActivityIndicator size="small" color="#61AFEF" style={{ paddingVertical: 12 }} />
                            ) : null
                        }
                    />
                )
            )}
        </View>
    );
}
