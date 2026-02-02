import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, Text, View, ActionSheetIOS, Alert, ScrollView, TextInput } from 'react-native';
import { SharedValue } from 'react-native-reanimated';
import { Settings, User, Group, NavArrowDown, NavArrowRight, Search } from 'iconoir-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture } from 'react-native-gesture-handler';
import { ChatSidebarProps } from './models';
import { createSidebarStyles } from './styles';
import { createChatTheme } from '../theme';
import { useTheme } from '../../../context/ThemeContext';
import { Skeleton } from '../../../components/Skeleton';
import { Sidebar } from '../../../components/DrawerSidebar';
import { AVAILABLE_TEAMS } from '../teams';
import { Chat } from '../../main/models';
import { useMain } from '../../main/context';


const pad = (value: number) => value.toString().padStart(2, '0');

const formatDateTime = (value?: string | number | null) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

type SidebarStyles = ReturnType<typeof createSidebarStyles>;
type SidebarChatTheme = ReturnType<typeof createChatTheme>;

type ChatSection = {
    title: string;
    mode: 'agent' | 'team';
    teamId: string | null;
    icon: 'user' | 'group';
    data: Chat[];
    totalCount: number;
};

function ChatListSkeleton({ styles }: { styles: SidebarStyles }) {
    const items = Array.from({ length: 5 }, (_, i) => String(i));
    return (
        <View style={styles.listContent}>
            {items.map((key) => (
                <View key={key} style={[styles.item, { opacity: 0.7 }]}>
                    <Skeleton height={20} width="70%" borderRadius={4} style={{ marginBottom: 4 }} />
                    <Skeleton height={14} width="40%" borderRadius={4} />
                </View>
            ))}
        </View>
    );
}

function ChatListContent({
    chats,
    chatsLoading,
    activeChatID,
    onSelectChat,
    onNewChat,
    onNewChatWithMode,
    onSettingsPress,
    onChatDelete,
    onChatRename,
    styles,
    chatTheme,
    isOpen,
}: Pick<ChatSidebarProps, 'chats' | 'chatsLoading' | 'activeChatID' | 'onSelectChat' | 'onNewChat' | 'onNewChatWithMode' | 'onSettingsPress' | 'onChatDelete' | 'onChatRename'> & {
    styles: SidebarStyles;
    chatTheme: SidebarChatTheme;
    isOpen?: boolean;
}) {
    const insets = useSafeAreaInsets();
    const { theme } = useTheme();
    const { sidebarFilter, setSidebarFilter } = useMain();
    const [highlightedChatID, setHighlightedChatID] = useState<string | null>(null);
    const flatListRef = React.useRef<FlatList<Chat>>(null);
    const pendingScrollRef = React.useRef<{ index: number; animated: boolean; viewPosition: number; retries: number } | null>(null);

    const [searchQuery, setSearchQuery] = useState('');
    const [listLimit, setListLimit] = useState(20);

    const filters = useMemo(() => {
        const list: { id: string; title: string; color?: string }[] = [
            { id: 'all', title: 'All', color: theme.accent },
            { id: 'agent', title: 'Genie', color: theme.success || '#9ECE6A' },
        ];
        AVAILABLE_TEAMS.forEach(t => {
            let color = theme.info;
            switch (t.id) {
                case 'dnd_team':
                    color = theme.accent || '#BB9AF7';
                    break;
            }
            list.push({ id: t.id, title: t.name, color });
        });
        return list;
    }, [theme]);

    const filteredChats = useMemo(() => {
        let data = chats;

        if (sidebarFilter === 'agent') {
            data = chats.filter(c => !c.mode || c.mode === 'agent');
        } else if (sidebarFilter !== 'all') {
            // Team filter
            data = chats.filter(c => c.mode === 'team' && c.team_id === sidebarFilter);
        }

        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase().trim();
            data = data.filter(c => (c.title || 'Untitled').toLowerCase().includes(query));
        }

        return data.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
    }, [chats, sidebarFilter, searchQuery]);

    const visibleChats = useMemo(() => {
        return filteredChats.slice(0, listLimit);
    }, [filteredChats, listLimit]);

    // Scroll to active chat when isOpen becomes true
    React.useEffect(() => {
        if (isOpen && activeChatID) {
            const activeChat = chats.find(c => c.id === activeChatID);
            if (!activeChat) return;

            let requiredFilter = 'all';
            if (!activeChat.mode || activeChat.mode === 'agent') {
                requiredFilter = 'agent';
            } else if (activeChat.mode === 'team' && activeChat.team_id) {
                requiredFilter = activeChat.team_id;
            }

            // Auto-switch filter ONLY if we are syncing to active chat (on open or change)
            // preventing the effect from reverting manual user selection
            let effectiveFilter = sidebarFilter;

            if (sidebarFilter !== 'all' && sidebarFilter !== requiredFilter) {
                setSidebarFilter(requiredFilter);
                effectiveFilter = requiredFilter;
                // Proceed to scroll after render? 
                // We can rely on next render cycle or force it if we want instant.
                // But simply setting state will trigger re-render and re-run THIS effect if we don't be careful.
                // Actually this effect depends on [isOpen, activeChatID].
                // If those didn't change, setting sidebarFilter won't re-trigger this effect (since sidebarFilter is NOT in deps).
                // GOOD.
            }

            // Find index in filtered list
            // Note: filteredChats is derived from sidebarFilter. 
            // If we just changed sidebarFilter, filteredChats is STALE in this closure.
            // We cannot scroll immediately if we switched filter.
            // We should split this logic? 
            // Or let the re-render handle the scroll?
            // If we set state, we return.
            if (activeChat.mode === 'agent' && effectiveFilter !== 'agent' && effectiveFilter !== 'all') return;
            // Simplified: If we changed filter, return and let the next render (triggered by state change) handle scrolling? 
            // BUT this effect won't run again if deps [isOpen, activeChatID] don't change.
            // So we need a separate effect for scrolling?

            // Actually, simplest is:
            // 1. Effect [isOpen, activeChatID] -> Ensures correct filter is selected.
            // 2. Effect [filteredChats] -> If activeChat is in it, scroll to it? 
            //    But we don't want to scroll every time filteredChats changes (e.g. typing in search? or new message).
            //    Only if "we just opened" or "active chat changed".

            // Let's stick to current structure but fix stale data issue.
            // If we switched filter, we CANNOT calculate index yet.
            if (sidebarFilter !== 'all' && sidebarFilter !== requiredFilter) {
                // We rely on the fact that switching filter will re-render list.
                // We just need to ensure we scroll AFTER that.
                // Maybe set a flag 'pendingScrollToActive'?
                return;
            }

            // Logic for scrolling (when filter is already correct)
            // filteredChats is from closure, so it matches current render.
            const index = filteredChats.findIndex(c => c.id === activeChatID);
            if (index !== -1) {
                if (index >= listLimit) {
                    setListLimit(index + 5);
                    return;
                }

                pendingScrollRef.current = {
                    index,
                    animated: false,
                    viewPosition: 0.5,
                    retries: 0,
                };

                setTimeout(() => {
                    try {
                        flatListRef.current?.scrollToIndex({
                            index,
                            animated: false,
                            viewPosition: 0.5,
                        });
                    } catch (e) {
                        // ignore
                    }
                }, 100);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, activeChatID]); // Removed sidebarFilter, filteredChats, listLimit to prevent interaction loops

    const openChatMenu = (chatId: string, chatTitle: string) => {
        if (!onChatDelete && !onChatRename) return;

        setHighlightedChatID(chatId);
        ActionSheetIOS.showActionSheetWithOptions(
            {
                options: ['Rename', 'Delete', 'Cancel'],
                destructiveButtonIndex: 1,
                cancelButtonIndex: 2,
                userInterfaceStyle: 'dark',
            },
            (buttonIndex) => {
                setHighlightedChatID(null);
                if (buttonIndex === 0 && onChatRename) {
                    Alert.prompt(
                        'Rename Chat',
                        'Enter new name for the chat',
                        [
                            { text: 'Cancel', style: 'cancel' },
                            {
                                text: 'Rename',
                                onPress: (newTitle?: string) => {
                                    if (newTitle && newTitle.trim()) {
                                        onChatRename(chatId, newTitle.trim());
                                    }
                                },
                            },
                        ],
                        'plain-text',
                        chatTitle
                    );
                } else if (buttonIndex === 1 && onChatDelete) {
                    onChatDelete(chatId);
                }
            }
        );
    };

    const handleCreateChat = useCallback(() => {
        if (!onNewChatWithMode) {
            onNewChat();
            return;
        }

        if (sidebarFilter === 'all' || sidebarFilter === 'agent') {
            onNewChatWithMode('agent', null);
        } else {
            // Check if this is an individual agent (not a team)
            const selectedEntry = AVAILABLE_TEAMS.find(t => t.id === sidebarFilter);
            if (selectedEntry?.isAgent) {
                // Individual agent - use 'agent' mode with agent_type in team_id
                onNewChatWithMode('agent', sidebarFilter);
            } else {
                // Team mode
                onNewChatWithMode('team', sidebarFilter);
            }
        }
    }, [onNewChat, onNewChatWithMode, sidebarFilter]);

    const renderItem = ({ item }: { item: Chat }) => {
        const isActive = item.id === activeChatID;

        const subtitle = formatDateTime(item.updated_at || item.created_at);

        // Get colorful category badge
        let category: string | null = null;
        let categoryColor: string | null = null;
        if (sidebarFilter === 'all') {
            if (item.mode === 'team') {
                const team = AVAILABLE_TEAMS.find(t => t.id === item.team_id);
                category = team?.name || 'Team';
                // Assign distinct colors per team
                switch (item.team_id) {
                    case 'dnd_team':
                        categoryColor = theme.accent || '#BB9AF7';
                        break;
                    default:
                        categoryColor = theme.info || '#7DCFFF';
                }
            } else {
                category = 'Agent';
                categoryColor = theme.success || '#9ECE6A';
            }
        }

        return (
            <Pressable
                style={[
                    styles.item,
                    isActive && styles.itemActive,
                    item.id === highlightedChatID && styles.itemHighlighted
                ]}
                onPress={() => onSelectChat(item.id)}
                onLongPress={() => openChatMenu(item.id, item.title || 'Untitled')}
            >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                    <Text style={[styles.itemTitle, isActive && { color: styles.title.color }, { flex: 1, marginRight: 8 }]} numberOfLines={1}>
                        {item.title || 'Untitled'}
                    </Text>
                    {category && categoryColor && (
                        <Text style={{
                            fontSize: 11,
                            color: categoryColor,
                            fontWeight: '600',
                            paddingHorizontal: 8,
                            paddingVertical: 2,
                            borderRadius: 10,
                            backgroundColor: `${categoryColor}20`,
                            overflow: 'hidden',
                        }}>
                            {category}
                        </Text>
                    )}
                </View>
                <Text style={styles.itemSubtitle} numberOfLines={1}>
                    {subtitle}
                </Text>
            </Pressable>
        );
    };

    const renderListFooter = () => {
        if (visibleChats.length < filteredChats.length) {
            return (
                <Pressable
                    onPress={() => setListLimit(prev => prev + 20)}
                    style={styles.showMoreButton}
                >
                    <Text style={styles.showMoreText}>Show more</Text>
                </Pressable>
            );
        }
        return <View style={{ height: 20 }} />;
    };

    return (
        <>
            <View style={[styles.header, { paddingTop: insets.top - 25, height: insets.top + 20 }]}>
                <View style={styles.searchContainer}>
                    <Search width={16} height={16} color={theme.textSecondary} />
                    <TextInput
                        style={styles.searchInput}
                        placeholder="Search for chats"
                        placeholderTextColor={theme.textSecondary}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                    />
                </View>
                <Pressable onPress={handleCreateChat} style={styles.newChatButton}>
                    <Text style={styles.newChatText}>+ New</Text>
                </Pressable>
            </View>
            {/* Filter Bar */}
            <View style={styles.filterBar}>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.filterContent}
                >
                    {filters.map(filter => {
                        const isActive = sidebarFilter === filter.id;
                        const filterColor = filter.color || theme.accent;
                        return (
                            <Pressable
                                key={filter.id}
                                style={[
                                    styles.filterItem,
                                    isActive && {
                                        borderColor: filterColor,
                                        backgroundColor: `${filterColor}15`
                                    }
                                ]}
                                onPress={() => {
                                    setSidebarFilter(filter.id);
                                    setListLimit(20);
                                }}
                            >
                                <Text style={[
                                    styles.filterText,
                                    isActive && { color: filterColor }
                                ]}>
                                    {filter.title}
                                </Text>
                            </Pressable>
                        );
                    })}
                </ScrollView>
            </View>


            {chatsLoading ? (
                <ChatListSkeleton styles={styles} />
            ) : (
                <FlatList<Chat>
                    ref={flatListRef}
                    data={visibleChats}
                    keyExtractor={(item) => item.id}
                    renderItem={renderItem}
                    ItemSeparatorComponent={() => <View style={styles.separator} />}
                    ListFooterComponent={renderListFooter}
                    ListEmptyComponent={
                        <View style={{ padding: 32, alignItems: 'center' }}>
                            <Text style={{ color: theme.textSecondary }}>No chats found</Text>
                        </View>
                    }
                    style={styles.list}
                    contentContainerStyle={styles.listContent}
                    showsVerticalScrollIndicator={false}
                    onScrollToIndexFailed={(info) => {
                        const target = pendingScrollRef.current;
                        if (target && target.retries < 10) {
                            target.retries++;
                            console.log(`Scroll to index failed, retrying (${target.retries}/10)...`, info);

                            // Attempt to scroll to approximate position to force render
                            // 55 is approximate item height
                            flatListRef.current?.scrollToOffset({
                                offset: info.index * 55,
                                animated: false
                            });

                            setTimeout(() => {
                                try {
                                    flatListRef.current?.scrollToIndex({
                                        index: target.index,
                                        animated: false,
                                        viewPosition: target.viewPosition,
                                    });
                                } catch (e) {
                                    console.warn('Retry scroll failed', e);
                                }
                            }, 200);
                        } else {
                            console.warn('Scroll to index failed permanently', info);
                        }
                    }}
                />
            )}
            {onSettingsPress && (
                <View style={[styles.footer, { marginBottom: insets.bottom - 20 }]}>
                    <Pressable
                        onPress={onSettingsPress}
                        style={({ pressed }) => [
                            styles.settingsButton,
                            pressed && styles.settingsButtonPressed,
                        ]}
                    >
                        <Settings width={20} height={20} color={chatTheme.textPrimary} strokeWidth={2} />
                        <Text style={styles.settingsText}>Settings</Text>
                    </Pressable>
                </View>
            )}
        </>
    );
}

interface ChatSidebarReanimatedProps extends ChatSidebarProps {
    sidebarTranslateX?: SharedValue<number>;
    dragGesture?: ReturnType<typeof Gesture.Pan>;
}

export function ChatSidebar({
    variant,
    width,
    chats,
    chatsLoading,
    activeChatID,
    onClose,
    onSelectChat,
    onNewChat,
    onNewChatWithMode,
    onSettingsPress,
    onChatDelete,
    onChatRename,
    sidebarTranslateX,
    dragGesture,
    isOpen,
}: ChatSidebarReanimatedProps) {
    const { theme } = useTheme();
    const styles = useMemo(() => createSidebarStyles(theme), [theme]);
    const chatTheme = useMemo(() => createChatTheme(theme), [theme]);

    const handleSelectChat = (id: string) => {
        onSelectChat(id);
        if (variant === 'overlay') onClose?.();
    };

    const handleNewChat = () => {
        onNewChat();
        if (variant === 'overlay') onClose?.();
    };

    const handleNewChatWithMode = (mode: 'agent' | 'team', teamId: string | null) => {
        onNewChatWithMode?.(mode, teamId);
        if (variant === 'overlay') onClose?.();
    };

    const handleSettingsPress = () => {
        onSettingsPress?.();
        if (variant === 'overlay') onClose?.();
    };

    return (
        <Sidebar
            side="left"
            variant={variant}
            width={width}
            onClose={onClose}
            translateX={sidebarTranslateX}
            dragGesture={dragGesture}
        >
            <ChatListContent
                chats={chats}
                chatsLoading={chatsLoading}
                activeChatID={activeChatID}
                onSelectChat={handleSelectChat}
                onNewChat={handleNewChat}
                onNewChatWithMode={handleNewChatWithMode}
                onSettingsPress={handleSettingsPress}
                onChatDelete={onChatDelete}
                onChatRename={onChatRename}
                styles={styles}
                chatTheme={chatTheme}
                isOpen={isOpen}
            />
        </Sidebar>
    );
}
