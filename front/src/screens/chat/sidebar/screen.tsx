import React, { useCallback, useMemo, useState } from 'react';
import { SectionList, Pressable, Text, View, ActionSheetIOS, Alert } from 'react-native';
import { SharedValue } from 'react-native-reanimated';
import { Settings, User, Group } from 'iconoir-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture } from 'react-native-gesture-handler';
import { ChatSidebarProps } from './models';
import { createSidebarStyles } from './styles';
import { createChatTheme } from '../theme';
import { useTheme } from '../../../context/ThemeContext';
import { Skeleton } from '../../../components/Skeleton';
import { Sidebar } from '../../../components/Sidebar';
import { AVAILABLE_TEAMS } from '../teams';
import { Chat } from '../../main/models';

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
}: Pick<ChatSidebarProps, 'chats' | 'chatsLoading' | 'activeChatID' | 'onSelectChat' | 'onNewChat' | 'onNewChatWithMode' | 'onSettingsPress' | 'onChatDelete' | 'onChatRename'> & {
    styles: SidebarStyles;
    chatTheme: SidebarChatTheme;
}) {
    const insets = useSafeAreaInsets();
    const { theme } = useTheme();
    const [highlightedChatID, setHighlightedChatID] = useState<string | null>(null);

    // Group chats by mode/team
    const sections = useMemo((): ChatSection[] => {
        // Separate agent and team chats
        const agentChats = chats.filter(c => !c.mode || c.mode === 'agent');
        const teamChats = chats.filter(c => c.mode === 'team');

        const result: ChatSection[] = [];

        // Agent section first
        if (agentChats.length > 0) {
            result.push({
                title: 'Agent',
                mode: 'agent',
                teamId: null,
                icon: 'user',
                data: agentChats.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0)),
            });
        }

        // Team sections
        AVAILABLE_TEAMS.forEach(team => {
            const teamData = teamChats.filter(c => c.team_id === team.id);
            if (teamData.length > 0) {
                result.push({
                    title: team.name,
                    mode: 'team',
                    teamId: team.id,
                    icon: 'group',
                    data: teamData.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0)),
                });
            }
        });

        // If no chats at all, show empty agent section
        if (result.length === 0) {
            result.push({
                title: 'Agent',
                mode: 'agent',
                teamId: null,
                icon: 'user',
                data: [],
            });
        }

        return result;
    }, [chats]);

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

    const showNewChatMenu = useCallback(() => {
        if (!onNewChatWithMode) {
            // Fallback to legacy behavior
            onNewChat();
            return;
        }

        // Build options: Agent + all teams
        const options = ['👤 Agent', ...AVAILABLE_TEAMS.map(t => `👥 ${t.name}`), 'Cancel'];
        const cancelIdx = options.length - 1;

        ActionSheetIOS.showActionSheetWithOptions(
            {
                title: 'New Chat',
                options,
                cancelButtonIndex: cancelIdx,
                userInterfaceStyle: 'dark',
            },
            (buttonIndex) => {
                if (buttonIndex === cancelIdx) return;

                if (buttonIndex === 0) {
                    // Agent mode
                    onNewChatWithMode('agent', null);
                } else {
                    // Team mode - buttonIndex 1 = AVAILABLE_TEAMS[0], etc.
                    const teamIndex = buttonIndex - 1;
                    const team = AVAILABLE_TEAMS[teamIndex];
                    if (team) {
                        onNewChatWithMode('team', team.id);
                    }
                }
            }
        );
    }, [onNewChat, onNewChatWithMode]);

    const renderItem = ({ item }: { item: Chat }) => {
        const isActive = item.id === activeChatID;
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
                <Text style={[styles.itemTitle, isActive && { color: styles.title.color }]} numberOfLines={1}>
                    {item.title || 'Untitled'}
                </Text>
                <Text style={styles.itemSubtitle} numberOfLines={1}>
                    {formatDateTime(item.updated_at || item.created_at)}
                </Text>
            </Pressable>
        );
    };

    const renderSectionHeader = ({ section }: { section: ChatSection }) => (
        <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingTop: 16,
            paddingBottom: 8,
            gap: 8,
        }}>
            {section.icon === 'user' ? (
                <User width={16} height={16} color={theme.textSecondary || '#888'} />
            ) : (
                <Group width={16} height={16} color={theme.textSecondary || '#888'} />
            )}
            <Text style={{
                fontSize: 12,
                fontWeight: '600',
                color: theme.textSecondary || '#888',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
            }}>
                {section.title}
            </Text>
        </View>
    );

    return (
        <>
            <View style={[styles.header, { marginTop: insets.top }]}>
                <Text style={styles.title}>Chats</Text>
                <Pressable onPress={showNewChatMenu} style={styles.newChatButton}>
                    <Text style={styles.newChatText}>＋ New</Text>
                </Pressable>
            </View>
            {chatsLoading ? (
                <ChatListSkeleton styles={styles} />
            ) : (
                <SectionList
                    sections={sections}
                    keyExtractor={item => item.id}
                    renderItem={renderItem}
                    renderSectionHeader={renderSectionHeader}
                    style={styles.list}
                    contentContainerStyle={styles.listContent}
                    showsVerticalScrollIndicator={false}
                    stickySectionHeadersEnabled={false}
                />
            )}
            {onSettingsPress && (
                <View style={[styles.footer, { marginBottom: insets.bottom }]}>
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
    dragGesture
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
            />
        </Sidebar>
    );
}
