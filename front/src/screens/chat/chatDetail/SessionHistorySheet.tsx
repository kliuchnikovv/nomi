import React, { useEffect, useState, useCallback } from 'react';
import {
    View, Text, FlatList, TouchableOpacity, StyleSheet,
    Modal, Pressable, ActivityIndicator,
} from 'react-native';
import { chatsApi } from '../../../apiClient';
import type { Chat } from '../../main/models';

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

export function formatSessionDate(updatedAt: number): string {
    const date = new Date(updatedAt * 1000);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);

    const timeStr = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

    if (diffDays === 0) return `Сегодня, ${timeStr}`;
    if (diffDays === 1) return `Вчера, ${timeStr}`;
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) + `, ${timeStr}`;
}

export function SessionHistorySheet({
    visible, onClose, onSelectSession,
    accentColor, textPrimaryColor, textSecondaryColor,
    surfaceColor, backgroundColor, borderColor,
}: Props) {
    const [sessions, setSessions] = useState<Chat[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!visible) return;
        setLoading(true);
        chatsApi.getPersistentChats()
            .then(chats => setSessions(chats ?? []))
            .catch(() => setSessions([]))
            .finally(() => setLoading(false));
    }, [visible]);

    const renderItem = useCallback(({ item }: { item: Chat }) => (
        <TouchableOpacity
            style={[styles.row, { borderBottomColor: borderColor }]}
            onPress={() => { onSelectSession(item); onClose(); }}
            activeOpacity={0.7}
        >
            <Text style={[styles.date, { color: textSecondaryColor }]}>
                {formatSessionDate(item.updated_at)}
            </Text>
            <Text style={[styles.title, { color: textPrimaryColor }]} numberOfLines={1}>
                {item.title || 'Без названия'}
            </Text>
        </TouchableOpacity>
    ), [borderColor, textSecondaryColor, textPrimaryColor, onSelectSession, onClose]);

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <Pressable style={styles.backdrop} onPress={onClose} />
            <View style={[styles.sheet, { backgroundColor: surfaceColor }]}>
                <View style={[styles.header, { borderBottomColor: borderColor }]}>
                    <Text style={[styles.headerTitle, { color: textPrimaryColor }]}>
                        История сессий
                    </Text>
                    <TouchableOpacity onPress={onClose} hitSlop={8}>
                        <Text style={[styles.closeBtn, { color: accentColor }]}>Закрыть</Text>
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
                                    Нет предыдущих сессий
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
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    date: { fontSize: 12, marginBottom: 3 },
    title: { fontSize: 15 },
    empty: { textAlign: 'center', margin: 32, fontSize: 14 },
});
