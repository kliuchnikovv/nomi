import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, FlatList, Pressable, Text, View, ActionSheetIOS, Alert } from 'react-native';
import { Settings } from 'iconoir-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChatSidebarProps } from './models';
import { createSidebarStyles } from './styles';
import { createChatTheme } from '../theme';
import { useTheme } from '../../../context/ThemeContext';

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
        console.log('openChatMenu called', { chatId, chatTitle, hasDelete: !!onChatDelete, hasRename: !!onChatRename });

        if (!onChatDelete && !onChatRename) {
            console.warn('No chat actions available');
            return;
        }

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
                    {new Date(item.updated_at || item.created_at).toLocaleString()}
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

export function ChatSidebar({
    variant,
    width,
    visible = true,
    chats,
    activeChatID,
    onClose,
    onSelectChat,
    onNewChat,
    onSettingsPress,
    onChatDelete,
    onChatRename,
}: ChatSidebarProps) {
    const { theme } = useTheme();
    const styles = useMemo(() => createSidebarStyles(theme), [theme]);
    const chatTheme = useMemo(() => createChatTheme(theme), [theme]);
    const animation = useRef(new Animated.Value(0)).current;
    const [shouldRender, setShouldRender] = useState(variant === 'inline' || visible);

    useEffect(() => {
        if (variant === 'inline') {
            animation.setValue(1);
            setShouldRender(true);
            return;
        }

        if (visible) {
            setShouldRender(true);
        }

        const driver = visible
            ? Animated.spring(animation, {
                toValue: 1,
                useNativeDriver: true,
                tension: 190,
                friction: 20,
            })
            : Animated.timing(animation, {
                toValue: 0,
                duration: 220,
                useNativeDriver: true,
            });

        driver.start(({ finished }) => {
            if (!visible && finished) {
                setShouldRender(false);
            }
        });
    }, [animation, variant, visible]);

    const translateX = useMemo(() => animation.interpolate({
        inputRange: [0, 1],
        outputRange: [-width * 0.4, 0],
    }), [animation, width]);

    const cardOpacity = useMemo(() => animation.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 1],
    }), [animation]);

    const backdropOpacity = useMemo(() => animation.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 0.5],
    }), [animation]);

    if (!shouldRender) {
        return null;
    }

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

    return (
        <View style={styles.overlayRoot} pointerEvents="box-none">
            <Pressable style={styles.overlayBackdrop} onPress={onClose}>
                <Animated.View style={[styles.overlayBackdrop, { opacity: backdropOpacity }]} />
            </Pressable>
            <Animated.View
                style={[
                    {
                        width,
                        opacity: cardOpacity,
                        transform: [{ translateX }],
                    },
                    styles.overlayCard,
                ]}
            >
                <ChatList
                    chats={chats}
                    activeChatID={activeChatID}
                    onSelectChat={id => {
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
        </View>
    );
}
