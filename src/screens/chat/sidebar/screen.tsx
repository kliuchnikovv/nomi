import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, View, ActionSheetIOS, Alert } from 'react-native';
import Animated, { interpolate, SharedValue, useAnimatedStyle } from 'react-native-reanimated';
import { Settings } from 'iconoir-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChatSidebarProps } from './models';
import { createSidebarStyles } from './styles';
import { createChatTheme } from '../theme';
import { useTheme } from '../../../context/ThemeContext';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';

const pad = (value: number) => value.toString().padStart(2, '0');

const formatDateTime = (value?: string) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

type SidebarStyles = ReturnType<typeof createSidebarStyles>;
type SidebarChatTheme = ReturnType<typeof createChatTheme>;

function ChatList({
    chats,
    activeChatID,
    onSelectChat,
    onNewChat,
    onSettingsPress,
    onChatDelete,
    onChatRename,
    styles,
    chatTheme,
}: Pick<ChatSidebarProps, 'chats' | 'activeChatID' | 'onSelectChat' | 'onNewChat' | 'onSettingsPress' | 'onChatDelete' | 'onChatRename'> & {
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
                    // Rename
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
                    // Delete
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
            <FlatList
                data={chats}
                keyExtractor={item => item.id}
                renderItem={renderItem}
                style={styles.list}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
            />
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

    if (variant === 'inline') {
        return (
            <View style={[styles.container, { width }]}>
                <ChatList
                    chats={chats}
                    activeChatID={activeChatID}
                    onSelectChat={onSelectChat}
                    onNewChat={onNewChat}
                    onSettingsPress={onSettingsPress}
                    onChatDelete={onChatDelete}
                    onChatRename={onChatRename}
                    styles={styles}
                    chatTheme={chatTheme}
                />
            </View>
        );
    }

    // Overlay variant using Reanimated
    // If sidebarTranslateX is not provided, we should probably fallback or return null,
    // but in this refactor it is expected to be provided by parent.
    if (!sidebarTranslateX) {
        return null;
    }

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: sidebarTranslateX.value }],
    }));

    const backdropStyle = useAnimatedStyle(() => {
        // Map translateX from [-width, 0] to opacity [0, 0.5]
        const opacity = interpolate(
            sidebarTranslateX.value,
            [-width, 0],
            [0, 0.5],
            'clamp'
        );
        return { opacity };
    });

    const containerStyle = useAnimatedStyle(() => {
         // Hide container when fully closed to allow touches to pass through
         // Assuming -width is closed state.
         return {
             zIndex: sidebarTranslateX.value <= -width + 1 ? -1 : 100,
         };
    });

    return (
        <Animated.View style={[styles.overlayRoot, containerStyle]} pointerEvents="box-none">
             <Animated.View style={[styles.overlayBackdrop, backdropStyle]}>
                 <Pressable style={{ flex: 1 }} onPress={onClose} />
             </Animated.View>
             {dragGesture ? (
                 <GestureDetector gesture={dragGesture}>
                    <Animated.View style={[styles.overlayCard, { width }, animatedStyle]}>
                        <ChatList
                            chats={chats}
                            activeChatID={activeChatID}
                            onSelectChat={(id) => {
                                onSelectChat(id);
                                onClose?.();
                            }}
                            onNewChat={() => {
                                onNewChat();
                                onClose?.();
                            }}
                            onSettingsPress={() => {
                                onSettingsPress?.();
                                onClose?.();
                            }}
                            onChatDelete={onChatDelete}
                            onChatRename={onChatRename}
                            styles={styles}
                            chatTheme={chatTheme}
                        />
                    </Animated.View>
                 </GestureDetector>
             ) : (
                <Animated.View style={[styles.overlayCard, { width }, animatedStyle]}>
                    <ChatList
                        chats={chats}
                        activeChatID={activeChatID}
                        onSelectChat={(id) => {
                            onSelectChat(id);
                            onClose?.();
                        }}
                        onNewChat={() => {
                            onNewChat();
                            onClose?.();
                        }}
                        onSettingsPress={() => {
                            onSettingsPress?.();
                            onClose?.();
                        }}
                        onChatDelete={onChatDelete}
                        onChatRename={onChatRename}
                        styles={styles}
                        chatTheme={chatTheme}
                    />
                </Animated.View>
             )}
        </Animated.View>
    );
}
