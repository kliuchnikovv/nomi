import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, View, ActionSheetIOS, Alert } from 'react-native';
import { SharedValue } from 'react-native-reanimated';
import { Settings } from 'iconoir-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture } from 'react-native-gesture-handler';
import { ChatSidebarProps } from './models';
import { createSidebarStyles } from './styles';
import { createChatTheme } from '../theme';
import { useTheme } from '../../../context/ThemeContext';
import { Skeleton } from '../../../components/Skeleton';
import { Sidebar } from '../../../components/Sidebar';

const pad = (value: number) => value.toString().padStart(2, '0');

const formatDateTime = (value?: string | number | null) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

type SidebarStyles = ReturnType<typeof createSidebarStyles>;
type SidebarChatTheme = ReturnType<typeof createChatTheme>;

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
    onSettingsPress,
    onChatDelete,
    onChatRename,
    styles,
    chatTheme,
}: Pick<ChatSidebarProps, 'chats' | 'chatsLoading' | 'activeChatID' | 'onSelectChat' | 'onNewChat' | 'onSettingsPress' | 'onChatDelete' | 'onChatRename'> & {
    styles: SidebarStyles;
    chatTheme: SidebarChatTheme;
}) {
    const insets = useSafeAreaInsets();
    const [highlightedChatID, setHighlightedChatID] = useState<string | null>(null);

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

    const renderItem = ({ item }: { item: typeof chats[number] }) => {
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

    return (
        <>
            <View style={[styles.header, { marginTop: insets.top }]}>
                <Text style={styles.title}>Chats</Text>
                <Pressable onPress={onNewChat} style={styles.newChatButton}>
                    <Text style={styles.newChatText}>＋ New</Text>
                </Pressable>
            </View>
            {chatsLoading ? (
                <ChatListSkeleton styles={styles} />
            ) : (
                <FlatList
                    data={chats}
                    keyExtractor={item => item.id}
                    renderItem={renderItem}
                    style={styles.list}
                    contentContainerStyle={styles.listContent}
                    showsVerticalScrollIndicator={false}
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
                onSettingsPress={handleSettingsPress}
                onChatDelete={onChatDelete}
                onChatRename={onChatRename}
                styles={styles}
                chatTheme={chatTheme}
            />
        </Sidebar>
    );
}
