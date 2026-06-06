import React, { useEffect, useState, useCallback } from 'react';
import {
    View,
    Text,
    FlatList,
    TouchableOpacity,
    StyleSheet,
    Modal,
    Pressable,
    ActivityIndicator,
    Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { chatsApi } from '../../../apiClient';
import type { Chat } from '../../main/models';
import { useMain } from '../../main/context';

interface Props {
    visible: boolean;
    onClose: () => void;
    onSelectSession: (chat: Chat) => void;
    accentColor: string;
    textPrimaryColor: string;
    textSecondaryColor: string;
    surfaceColor: string;
    backgroundColor: string;
    borderColor: string;
}

export function formatSessionDate(updatedAt: number | string): string {
    // Backend may send either Unix seconds (number) or an ISO-8601 string (time.Time).
    const date =
        typeof updatedAt === 'string'
            ? new Date(updatedAt)
            : new Date(updatedAt * 1000);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);

    const timeStr = date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
    });

    if (diffDays === 0) return `Today, ${timeStr}`;
    if (diffDays === 1) return `Yesterday, ${timeStr}`;
    return (
        date.toLocaleDateString('en-US', { day: 'numeric', month: 'long' }) +
        `, ${timeStr}`
    );
}

export function SessionHistorySheet({
    visible,
    onClose,
    onSelectSession,
    accentColor,
    textPrimaryColor,
    textSecondaryColor,
    surfaceColor,
    backgroundColor,
    borderColor,
}: Props) {
    const [sessions, setSessions] = useState<Chat[]>([]);
    const [loading, setLoading] = useState(false);
    // Session targeted by a long-press; drives the in-sheet action menu.
    const [actionTarget, setActionTarget] = useState<Chat | null>(null);
    const insets = useSafeAreaInsets();
    const { renameChat, deleteChat } = useMain();

    const loadSessions = useCallback(() => {
        setLoading(true);
        chatsApi
            .getPersistentChats()
            .then(chats => setSessions(chats ?? []))
            .catch(() => setSessions([]))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        if (!visible) return;
        loadSessions();
    }, [visible, loadSessions]);

    // Long-press opens an in-sheet action menu rendered inside this Modal.
    // (ActionSheetIOS does not present reliably from within a Modal on iOS.)
    const handleLongPress = useCallback((item: Chat) => {
        setActionTarget(item);
    }, []);

    const handleRename = useCallback(
        (item: Chat) => {
            setActionTarget(null);
            const displayTitle =
                item.title || formatSessionDate(item.updated_at);
            // Alert.prompt is a native alert and presents reliably over a Modal.
            Alert.prompt(
                'Rename Session',
                '',
                [
                    { text: 'Cancel', style: 'cancel' },
                    {
                        text: 'Rename',
                        onPress: async (newTitle?: string) => {
                            const trimmed = newTitle?.trim();
                            if (!trimmed) return;
                            await renameChat(item.id, trimmed);
                            loadSessions();
                        },
                    },
                ],
                'plain-text',
                displayTitle,
            );
        },
        [renameChat, loadSessions],
    );

    const handleDelete = useCallback(
        (item: Chat) => {
            setActionTarget(null);
            Alert.alert(
                'Delete Session',
                'This session will be permanently deleted.',
                [
                    { text: 'Cancel', style: 'cancel' },
                    {
                        text: 'Delete',
                        style: 'destructive',
                        onPress: () => {
                            deleteChat(item.id).then(() => loadSessions());
                        },
                    },
                ],
            );
        },
        [deleteChat, loadSessions],
    );

    const renderItem = useCallback(
        ({ item }: { item: Chat }) => {
            const hasTitle = !!item.title;
            const hasEmoji =
                !!item.icon &&
                /\p{Emoji}/u.test(item.icon) &&
                !/^[0-9#*]$/.test(item.icon);
            return (
                <TouchableOpacity
                    style={[styles.row, { borderBottomColor: borderColor }]}
                    onPress={() => {
                        onSelectSession(item);
                        onClose();
                    }}
                    onLongPress={() => handleLongPress(item)}
                    activeOpacity={0.7}
                >
                    <View
                        style={[
                            styles.iconCircle,
                            { backgroundColor: surfaceColor },
                        ]}
                    >
                        {hasEmoji ? (
                            <Text style={styles.iconEmoji}>{item.icon}</Text>
                        ) : (
                            <Ionicons
                                name="sparkles"
                                size={16}
                                color={accentColor}
                            />
                        )}
                    </View>
                    <View style={styles.textBlock}>
                        {hasTitle && (
                            <Text
                                style={[
                                    styles.date,
                                    { color: textSecondaryColor },
                                ]}
                            >
                                {formatSessionDate(item.updated_at)}
                            </Text>
                        )}
                        <Text
                            style={[styles.title, { color: textPrimaryColor }]}
                            numberOfLines={1}
                        >
                            {item.title ||
                                `Session from ${formatSessionDate(
                                    item.updated_at,
                                )}`}
                        </Text>
                    </View>
                </TouchableOpacity>
            );
        },
        [
            borderColor,
            surfaceColor,
            accentColor,
            textSecondaryColor,
            textPrimaryColor,
            onSelectSession,
            onClose,
            handleLongPress,
        ],
    );

    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={onClose}
        >
            <Pressable style={styles.backdrop} onPress={onClose} />
            <View
                style={[
                    styles.sheet,
                    {
                        backgroundColor: surfaceColor,
                        paddingBottom: insets.bottom,
                    },
                ]}
            >
                <View
                    style={[styles.header, { borderBottomColor: borderColor }]}
                >
                    <Text
                        style={[
                            styles.headerTitle,
                            { color: textPrimaryColor },
                        ]}
                    >
                        Session History
                    </Text>
                    <TouchableOpacity onPress={onClose} hitSlop={8}>
                        <Text style={[styles.closeBtn, { color: accentColor }]}>
                            Close
                        </Text>
                    </TouchableOpacity>
                </View>
                {loading ? (
                    <ActivityIndicator
                        style={{ margin: 32 }}
                        color={accentColor}
                    />
                ) : (
                    <FlatList
                        data={sessions}
                        keyExtractor={item => item.id}
                        renderItem={renderItem}
                        ListEmptyComponent={
                            <Text
                                style={[
                                    styles.empty,
                                    { color: textSecondaryColor },
                                ]}
                            >
                                No previous sessions
                            </Text>
                        }
                    />
                )}
            </View>

            {actionTarget && (
                <View style={styles.actionOverlay}>
                    <Pressable
                        style={styles.actionBackdrop}
                        onPress={() => setActionTarget(null)}
                    />
                    <View
                        style={[
                            styles.actionCard,
                            {
                                backgroundColor: surfaceColor,
                                marginBottom: insets.bottom + 12,
                            },
                        ]}
                    >
                        <Text
                            style={[
                                styles.actionCardTitle,
                                { color: textSecondaryColor },
                            ]}
                            numberOfLines={1}
                        >
                            {actionTarget.title ||
                                formatSessionDate(actionTarget.updated_at)}
                        </Text>
                        <TouchableOpacity
                            style={[
                                styles.actionItem,
                                { borderTopColor: borderColor },
                            ]}
                            onPress={() => handleRename(actionTarget)}
                        >
                            <Text
                                style={[
                                    styles.actionLabel,
                                    { color: textPrimaryColor },
                                ]}
                            >
                                Rename
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[
                                styles.actionItem,
                                { borderTopColor: borderColor },
                            ]}
                            onPress={() => handleDelete(actionTarget)}
                        >
                            <Text
                                style={[styles.actionLabel, styles.actionDanger]}
                            >
                                Delete
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[
                                styles.actionItem,
                                { borderTopColor: borderColor },
                            ]}
                            onPress={() => setActionTarget(null)}
                        >
                            <Text
                                style={[
                                    styles.actionLabel,
                                    { color: accentColor },
                                ]}
                            >
                                Cancel
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>
            )}
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: '#00000055' },
    sheet: {
        maxHeight: '60%',
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        overflow: 'hidden',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 16,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    headerTitle: { fontSize: 17, fontWeight: '600' },
    closeBtn: { fontSize: 15 },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    iconCircle: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    iconEmoji: { fontSize: 18 },
    textBlock: { flex: 1 },
    date: { fontSize: 12, marginBottom: 2 },
    title: { fontSize: 15 },
    empty: { textAlign: 'center', margin: 32, fontSize: 14 },
    actionOverlay: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'flex-end',
    },
    actionBackdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: '#00000066',
    },
    actionCard: {
        marginHorizontal: 12,
        borderRadius: 14,
        overflow: 'hidden',
    },
    actionCardTitle: {
        fontSize: 13,
        textAlign: 'center',
        paddingVertical: 12,
        paddingHorizontal: 16,
    },
    actionItem: {
        paddingVertical: 16,
        alignItems: 'center',
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    actionLabel: { fontSize: 16, fontWeight: '500' },
    actionDanger: { color: '#FF3B30' },
});
