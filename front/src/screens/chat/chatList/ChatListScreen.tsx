import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View, StyleSheet, ScrollView, ActionSheetIOS, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { emptyChatID, useMain } from '../../main/context';
import { useTheme } from '../../../context/ThemeContext';
import { AVAILABLE_TEAMS } from '../teams';
import { Chat } from '../../main/models';
import type { ChatStackParamList } from '../../../navigation/types';
import { TAB_BAR_ICON_HEIGHT } from '../../../navigation/MainTabs';

type NavProp = NativeStackNavigationProp<ChatStackParamList, 'ChatList'>;

const PLANNER_TITLE_PREFIX = 'Planner';

function isPlannerChat(c: Chat): boolean {
    return c.mode === 'agent' && (c.title || '').startsWith(PLANNER_TITLE_PREFIX);
}

const pad = (n: number) => String(n).padStart(2, '0');

function formatTime(value?: number | null): string {
    if (!value) return '';
    const date = new Date(value);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);
    if (diffDays === 0) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d`;
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
}

export function ChatListScreen() {
    const navigation = useNavigation<NavProp>();
    const insets = useSafeAreaInsets();
    const { theme } = useTheme();
    const {
        chats, chatsLoading, activeChatID, setActiveChatID,
        createNewChat, createNewChatWithMode, renameChat, deleteChat,
        sidebarFilter, setSidebarFilter, getChats,
    } = useMain();

    const [searchQuery, setSearchQuery] = useState('');
    const [listLimit, setListLimit] = useState(30);

    const filters = useMemo(() => {
        const list: { id: string; title: string; color: string }[] = [
            { id: 'agent', title: 'Genie', color: theme.success || '#9ECE6A' },
            { id: 'planner', title: 'Planner', color: '#FF9E64' },
        ];
        AVAILABLE_TEAMS.forEach(t => {
            list.push({ id: t.id, title: t.name, color: theme.info || '#7DCFFF' });
        });
        list.push({ id: 'all', title: 'All', color: theme.accent });
        return list;
    }, [theme]);

    const filteredChats = useMemo(() => {
        let data = chats;
        if (sidebarFilter === 'agent') {
            data = chats.filter(c => (!c.mode || c.mode === 'agent') && !isPlannerChat(c));
        } else if (sidebarFilter === 'planner') {
            data = chats.filter(c => isPlannerChat(c));
        } else if (sidebarFilter !== 'all') {
            data = chats.filter(c => c.mode === 'team' && c.team_id === sidebarFilter);
        }
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            data = data.filter(c => (c.title || '').toLowerCase().includes(q));
        }
        return [...data].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    }, [chats, sidebarFilter, searchQuery]);

    const visibleChats = useMemo(() => filteredChats.slice(0, listLimit), [filteredChats, listLimit]);

    const handleSelectChat = useCallback((chatId: string) => {
        setActiveChatID(chatId);
        navigation.navigate('ChatDetail', { chatId });
    }, [setActiveChatID, navigation]);

    const handleNewChat = useCallback(() => {
        if (sidebarFilter === 'all' || sidebarFilter === 'agent' || sidebarFilter === 'planner') {
            createNewChatWithMode('agent', null);
        } else {
            const entry = AVAILABLE_TEAMS.find(t => t.id === sidebarFilter);
            if (entry?.isAgent) {
                createNewChatWithMode('agent', sidebarFilter);
            } else {
                createNewChatWithMode('team', sidebarFilter);
            }
        }
        navigation.navigate('ChatDetail', { chatId: emptyChatID });
    }, [createNewChatWithMode, sidebarFilter, navigation]);

    const handleLongPress = useCallback((chatId: string, title: string) => {
        ActionSheetIOS.showActionSheetWithOptions(
            { options: ['Rename', 'Delete', 'Cancel'], destructiveButtonIndex: 1, cancelButtonIndex: 2 },
            (idx) => {
                if (idx === 0) {
                    Alert.prompt('Rename Chat', '', [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Rename', onPress: (newTitle?: string) => { if (newTitle?.trim()) renameChat(chatId, newTitle.trim()); } },
                    ], 'plain-text', title);
                } else if (idx === 1) {
                    deleteChat(chatId);
                }
            }
        );
    }, [renameChat, deleteChat]);

    const renderItem = useCallback(({ item }: { item: Chat }) => {
        const isActive = item.id === activeChatID;
        let badgeLabel: string | null = null;
        let badgeColor = theme.accent;
        if (sidebarFilter === 'all') {
            if (isPlannerChat(item)) {
                badgeLabel = 'Planner';
                badgeColor = '#FF9E64';
            } else if (item.mode === 'team') {
                const team = AVAILABLE_TEAMS.find(t => t.id === item.team_id);
                badgeLabel = team?.name || 'Team';
                badgeColor = theme.info || '#7DCFFF';
            } else {
                badgeLabel = 'Genie';
                badgeColor = theme.success || '#9ECE6A';
            }
        }

        return (
            <Pressable
                style={[styles.item, { backgroundColor: isActive ? `${theme.accent}18` : 'transparent', borderRadius: 12 }]}
                onPress={() => handleSelectChat(item.id)}
                onLongPress={() => handleLongPress(item.id, item.title || 'Untitled')}
            >
                <View style={[styles.iconCircle, { backgroundColor: theme.surface }]}>
                    {item.icon && /\p{Emoji}/u.test(item.icon) && !/^[0-9#*]$/.test(item.icon)
                        ? <Text style={{ fontSize: 16 }}>{item.icon}</Text>
                        : <Ionicons name={isPlannerChat(item) ? 'calendar' : item.mode === 'team' ? 'people' : 'sparkles'} size={16} color={theme.accent} />
                    }
                </View>
                <View style={styles.itemContent}>
                    <View style={styles.itemRow}>
                        <Text style={[styles.itemTitle, { color: theme.text }]} numberOfLines={1}>{item.title || 'Untitled'}</Text>
                        <Text style={[styles.itemTime, { color: theme.textSecondary }]}>{formatTime(item.updated_at || item.created_at)}</Text>
                    </View>
                    {badgeLabel && (
                        <Text style={[styles.badge, { color: badgeColor, backgroundColor: `${badgeColor}20` }]}>{badgeLabel}</Text>
                    )}
                </View>
            </Pressable>
        );
    }, [activeChatID, theme, sidebarFilter, handleSelectChat, handleLongPress]);

    return (
        <View style={[styles.container, { backgroundColor: theme.background }]}>
            {/* Header */}
            <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: theme.background }]}>
                <Text style={[styles.title, { color: theme.text }]}>Chats</Text>
                <Pressable onPress={handleNewChat} style={[styles.newBtn, { backgroundColor: theme.accent }]}>
                    <Ionicons name="add" size={20} color="#fff" />
                </Pressable>
            </View>

            {/* Search */}
            <View style={[styles.searchRow, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <Ionicons name="search" size={16} color={theme.textSecondary} />
                <TextInput
                    style={[styles.searchInput, { color: theme.text }]}
                    placeholder="Search chats"
                    placeholderTextColor={theme.textSecondary}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                />
                {searchQuery.length > 0 && (
                    <Pressable onPress={() => setSearchQuery('')}>
                        <Ionicons name="close-circle" size={16} color={theme.textSecondary} />
                    </Pressable>
                )}
            </View>

            {/* Filter tabs */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterBar} contentContainerStyle={styles.filterContent}>
                {filters.map(f => {
                    const active = sidebarFilter === f.id;
                    return (
                        <Pressable
                            key={f.id}
                            style={[styles.filterChip, { borderColor: active ? f.color : theme.border, backgroundColor: active ? `${f.color}18` : 'transparent' }]}
                            onPress={() => { setSidebarFilter(f.id); setListLimit(30); }}
                        >
                            <Text style={[styles.filterText, { color: active ? f.color : theme.textSecondary }]}>{f.title}</Text>
                        </Pressable>
                    );
                })}
            </ScrollView>

            {/* List */}
            <FlatList
                data={visibleChats}
                keyExtractor={(item) => item.id}
                renderItem={renderItem}
                onRefresh={() => getChats({ preserveActiveChat: true })}
                refreshing={chatsLoading}
                contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + TAB_BAR_ICON_HEIGHT + 16 }]}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={
                    <View style={styles.empty}>
                        <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                            {chatsLoading ? 'Loading...' : 'No chats yet'}
                        </Text>
                    </View>
                }
                ListFooterComponent={
                    visibleChats.length < filteredChats.length ? (
                        <Pressable onPress={() => setListLimit(l => l + 20)} style={styles.showMore}>
                            <Text style={[styles.showMoreText, { color: theme.accent }]}>Show more</Text>
                        </Pressable>
                    ) : null
                }
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 12 },
    title: { fontSize: 28, fontWeight: '700' },
    newBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    searchRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1, gap: 8 },
    searchInput: { flex: 1, fontSize: 15, padding: 0 },
    filterBar: { flexGrow: 0, flexShrink: 0, marginBottom: 4 },
    filterContent: { paddingHorizontal: 16, gap: 8, paddingBottom: 8 },
    filterChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
    filterText: { fontSize: 13, fontWeight: '600' },
    listContent: { paddingHorizontal: 12, paddingTop: 4 },
    item: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 10, marginBottom: 2 },
    iconCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
    itemContent: { flex: 1 },
    itemRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    itemTitle: { fontSize: 15, fontWeight: '600', flex: 1, marginRight: 8 },
    itemTime: { fontSize: 12 },
    badge: { fontSize: 11, fontWeight: '600', alignSelf: 'flex-start', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8, marginTop: 2, overflow: 'hidden' },
    empty: { padding: 40, alignItems: 'center' },
    emptyText: { fontSize: 15 },
    showMore: { padding: 16, alignItems: 'center' },
    showMoreText: { fontSize: 14, fontWeight: '600' },
});
