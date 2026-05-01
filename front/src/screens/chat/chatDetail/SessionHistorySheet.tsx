import React, { useEffect, useState, useCallback } from 'react';
import {
    View, Text, FlatList, TouchableOpacity, StyleSheet,
    Modal, Pressable, ActivityIndicator, ActionSheetIOS, Alert,
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
    const date = typeof updatedAt === 'string' ? new Date(updatedAt) : new Date(updatedAt * 1000);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);

    const timeStr = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

    if (diffDays === 0) return `Today, ${timeStr}`;
    if (diffDays === 1) return `Yesterday, ${timeStr}`;
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) + `, ${timeStr}`;
}

export function SessionHistorySheet({
    visible, onClose, onSelectSession,
    accentColor, textPrimaryColor, textSecondaryColor,
    surfaceColor, backgroundColor, borderColor,
}: Props) {
    const [sessions, setSessions] = useState<Chat[]>([]);
    const [loading, setLoading] = useState(false);
    const insets = useSafeAreaInsets();
    const { renameChat, deleteChat } = useMain();

    useEffect(() => {
        if (!visible) return;
        setLoading(true);
        chatsApi.getPersistentChats()
            .then(chats => setSessions(chats ?? []))
            .catch(() => setSessions([]))
            .finally(() => setLoading(false));
    }, [visible]);

    const handleLongPress = useCallback((item: Chat) => {
        const displayTitle = item.title || formatSessionDate(item.updated_at);
        ActionSheetIOS.showActionSheetWithOptions(
            { options: ['Rename', 'Delete', 'Cancel'], destructiveButtonIndex: 1, cancelButtonIndex: 2 },
            (idx) => {
                if (idx === 0) {
                    Alert.prompt('Rename Session', '', [
                        { text: 'Cancel', style: 'cancel' },
                        {
                            text: 'Rename',
                            onPress: (newTitle?: string) => {
                                const trimmed = newTitle?.trim();
                                if (!trimmed) return;
                                renameChat(item.id, trimmed);
                                setSessions(prev => prev.map(s =>
                                    s.id === item.id ? { ...s, title: trimmed } : s
                                ));
                            },
                        },
                    ], 'plain-text', displayTitle);
                } else if (idx === 1) {
                    deleteChat(item.id);
                    setSessions(prev => prev.filter(s => s.id !== item.id));
                }
            },
        );
    }, [renameChat, deleteChat]);

    const renderItem = useCallback(({ item }: { item: Chat }) => {
        const hasTitle = !!item.title;
        const hasEmoji = !!item.icon && /\p{Emoji}/u.test(item.icon) && !/^[0-9#*]$/.test(item.icon);
        return (
            <TouchableOpacity
                style={[styles.row, { borderBottomColor: borderColor }]}
                onPress={() => { onSelectSession(item); onClose(); }}
                onLongPress={() => handleLongPress(item)}
                activeOpacity={0.7}
            >
                <View style={[styles.iconCircle, { backgroundColor: surfaceColor }]}>
                    {hasEmoji
                        ? <Text style={styles.iconEmoji}>{item.icon}</Text>
                        : <Ionicons name="sparkles" size={16} color={accentColor} />
                    }
                </View>
                <View style={styles.textBlock}>
                    {hasTitle && (
                        <Text style={[styles.date, { color: textSecondaryColor }]}>
                            {formatSessionDate(item.updated_at)}
                        </Text>
                    )}
                    <Text style={[styles.title, { color: textPrimaryColor }]} numberOfLines={1}>
                        {item.title || `Session from ${formatSessionDate(item.updated_at)}`}
                    </Text>
                </View>
            </TouchableOpacity>
        );
    }, [borderColor, surfaceColor, accentColor, textSecondaryColor, textPrimaryColor, onSelectSession, onClose, handleLongPress]);

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <Pressable style={styles.backdrop} onPress={onClose} />
            <View style={[styles.sheet, { backgroundColor: surfaceColor, paddingBottom: insets.bottom }]}>
                <View style={[styles.header, { borderBottomColor: borderColor }]}>
                    <Text style={[styles.headerTitle, { color: textPrimaryColor }]}>
                        Session History
                    </Text>
                    <TouchableOpacity onPress={onClose} hitSlop={8}>
                        <Text style={[styles.closeBtn, { color: accentColor }]}>Close</Text>
                    </TouchableOpacity>
                </View>
                {loading
                    ? <ActivityIndicator style={{ margin: 32 }} color={accentColor} />
                    : (
                        <FlatList
                            data={sessions}
                            keyExtractor={item => item.id}
                            renderItem={renderItem}
                            ListEmptyComponent={
                                <Text style={[styles.empty, { color: textSecondaryColor }]}>
                                    No previous sessions
                                </Text>
                            }
                        />
                    )
                }
            </View>
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
});
