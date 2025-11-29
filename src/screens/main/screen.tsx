import React, { useEffect, useMemo, useRef, useState } from 'react';

import {
    Pressable,
    Text,
    useWindowDimensions,
    View,
} from 'react-native';

import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import { Menu, Mail } from 'iconoir-react-native';
import { styles } from './styles'
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

import Sidebar from '../sidebar/screen';
import RightSidebar from '../rightsidebar/screen';
import ChatScreen from '../chat/screen';
import SettingsModal from '../settings/screen';
import { emptyChatID, useMain } from './context';
import { ChatProvider, useChat } from '../chat/context.tsx';
import { InboxProvider, useInbox } from '../rightsidebar/context';
import { oneDarkPalette } from '../../themes/oneDark.ts';

const withAlpha = (hex: string, alpha: number) => {
    const h = hex.replace('#', '');
    const bigint = parseInt(h, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

function HeaderTitle({ activeChatTitle }: { activeChatTitle?: string | null }) {
    const { externalTitle } = useChat();
    return (
        <Text style={styles.headerTitle} numberOfLines={1}>
            {externalTitle || activeChatTitle || 'Chat'}
        </Text>
    );
}

function HeaderShell({
    isNarrow,
    getChats,
    setSidebarOpen,
    setRightSidebarOpen,
}: {
    isNarrow: boolean;
    getChats: () => void;
    setSidebarOpen: (v: boolean) => void;
    setRightSidebarOpen: (v: boolean) => void;
}) {
    const { unreadCount } = useInbox();
    const { externalTitle, isPluginThread } = useChat();
    const headerStyle = [
        styles.header,
        isPluginThread
            ? { backgroundColor: withAlpha(oneDarkPalette.red, 0.12) }
            : { backgroundColor: withAlpha(oneDarkPalette.blue, 0.08) },
    ];
    return (
        <View style={headerStyle}>
            {isNarrow && (
                <Pressable
                    onPress={() => {
                        getChats();
                        setSidebarOpen(true)
                    }}
                    style={styles.headerBtn}
                    accessibilityLabel="Open Sidebar"
                >
                    <Menu width={28} height={28} color={'#ABB2BF'} />
                </Pressable>
            )}
            <HeaderTitle activeChatTitle={externalTitle} />
            {isNarrow && (
                <Pressable
                    onPress={() => setRightSidebarOpen(true)}
                    style={styles.headerBtn}
                    accessibilityLabel="Open Inbox"
                >
                    <View>
                        <Mail width={28} height={28} color={'#ABB2BF'} />
                        {unreadCount > 0 && (
                            <View style={styles.badge}>
                                <Text style={styles.badgeText}>
                                    {unreadCount > 99 ? '99+' : unreadCount}
                                </Text>
                            </View>
                        )}
                    </View>
                </Pressable>
            )}
            {!isNarrow && <View style={{ width: 36 }} />}
        </View>
    );
}

function MainScreenContent() {
    const insets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    const {
        chats,
        activeChatID,
        activeChat,
        createNewChat,
        deleteChat,
        setActiveChatID,
        getChats,
    } = useMain();

    const { unreadCount } = useInbox();

    const [settingsOpen, setSettingsOpen] = useState(false);
    const isNarrow = width < 768;
    const [sidebarOpen, setSidebarOpen] = useState(!isNarrow);
    const [rightSidebarOpen, setRightSidebarOpen] = useState(!isNarrow);
    const sidebarWidth = 320;
    const rightSidebarWidth = 320;
    
    // Используем Reanimated shared values для интерактивной анимации
    const leftSidebarTranslateX = useSharedValue(sidebarOpen ? 0 : -sidebarWidth);
    const rightSidebarTranslateX = useSharedValue(rightSidebarOpen ? 0 : rightSidebarWidth);
    const leftSidebarWidth = useSharedValue(sidebarOpen ? sidebarWidth : 0);
    const rightSidebarWidthAnimated = useSharedValue(rightSidebarOpen ? rightSidebarWidth : 0);
    const leftBackdropOpacity = useSharedValue(sidebarOpen ? 1 : 0);
    const rightBackdropOpacity = useSharedValue(rightSidebarOpen ? 1 : 0);

    useEffect(() => {
        // If screen becomes narrow, default to collapsed; if wide, open.
        setSidebarOpen(!isNarrow);
        setRightSidebarOpen(!isNarrow);
    }, [isNarrow]);

    useEffect(() => {
        const duration = 220;
        if (sidebarOpen) {
            leftSidebarTranslateX.value = withTiming(0, { duration });
            leftSidebarWidth.value = withTiming(sidebarWidth, { duration });
            leftBackdropOpacity.value = withTiming(1, { duration });
        } else {
            leftSidebarTranslateX.value = withTiming(-sidebarWidth, { duration });
            leftSidebarWidth.value = withTiming(0, { duration });
            leftBackdropOpacity.value = withTiming(0, { duration });
        }
    }, [sidebarOpen, leftSidebarTranslateX, leftSidebarWidth, sidebarWidth, leftBackdropOpacity]);

    useEffect(() => {
        // Анимируем правую панель при изменении состояния
        const duration = 220;
        if (rightSidebarOpen) {
            rightSidebarTranslateX.value = withTiming(0, { duration });
            rightSidebarWidthAnimated.value = withTiming(rightSidebarWidth, { duration });
            rightBackdropOpacity.value = withTiming(1, { duration });
        } else {
            rightSidebarTranslateX.value = withTiming(rightSidebarWidth, { duration });
            rightSidebarWidthAnimated.value = withTiming(0, { duration });
            rightBackdropOpacity.value = withTiming(0, { duration });
        }
    }, [rightSidebarOpen, rightSidebarTranslateX, rightSidebarWidthAnimated, rightSidebarWidth, rightBackdropOpacity]);



    const sortedChats = useMemo(
        () => [...chats].sort((a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        ), [chats],
    );

    // Анимированные стили для панелей
    const leftSidebarAnimatedStyle = useAnimatedStyle(() => {
        return {
            transform: [{ translateX: leftSidebarTranslateX.value }],
            width: leftSidebarWidth.value,
        };
    });

    const rightSidebarAnimatedStyle = useAnimatedStyle(() => {
        return {
            transform: [{ translateX: rightSidebarTranslateX.value }],
            width: rightSidebarWidthAnimated.value,
        };
    });

    // Анимированные стили для backdrop
    const leftBackdropStyle = useAnimatedStyle(() => {
        return {
            left: leftSidebarWidth.value,
            top: -insets.top,
            bottom: -insets.bottom,
            opacity: leftBackdropOpacity.value,
        };
    });

    const rightBackdropStyle = useAnimatedStyle(() => {
        return {
            right: rightSidebarWidthAnimated.value,
            top: -insets.top,
            bottom: -insets.bottom,
            opacity: rightBackdropOpacity.value,
        };
    });

    return (
        <View style={styles.root}>
            {/* Sidebar */}
            <Animated.View style={[
                styles.sidebarWrap,
                leftSidebarAnimatedStyle,
                isNarrow && {
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    bottom: 0,
                }
            ]}>
                <Sidebar
                width={sidebarWidth}
                chats={sortedChats}
                activeChatID={activeChatID}
                onSelect={id => {
                    setActiveChatID(id);
                    if (isNarrow) setSidebarOpen(false);
                }}
                onNewChat={() => {
                    createNewChat();
                    if (isNarrow) setSidebarOpen(false);
                }}
                onChatDelete={deleteChat}
                onOpenSettings={() => setSettingsOpen(true)}
                onCollapse={() => setSidebarOpen(false)}
            />
            </Animated.View>
        {!isNarrow && <View style={styles.divider} />}
        <ChatProvider
            activeChatID={activeChatID ? activeChatID : emptyChatID}
            setActiveChatID={setActiveChatID}
        >
            <View
                style={[
                    styles.content,
                    isNarrow
                        ? {
                            width,
                        }
                        : { flex: 1 }
                ]}
            >
                <HeaderShell
                    isNarrow={isNarrow}
                    getChats={getChats}
                    setSidebarOpen={setSidebarOpen}
                    setRightSidebarOpen={setRightSidebarOpen}
                />
                <ChatScreen />
            </View>
            {!isNarrow && <View style={styles.divider} />}
            <Animated.View style={[
                styles.rightSidebarWrap,
                rightSidebarAnimatedStyle,
                isNarrow && {
                    position: 'absolute',
                    right: 0,
                    top: 0,
                    bottom: 0,
                }
            ]}>
                <RightSidebar
                    width={rightSidebarWidth}
                    isOpen={rightSidebarOpen}
                    onClose={() => setRightSidebarOpen(false)}
                />
            </Animated.View>
        </ChatProvider>
        {isNarrow && (
            <AnimatedPressable
                style={[styles.backdrop, leftBackdropStyle]}
                onPress={() => setSidebarOpen(false)}
            />
        )}
        {isNarrow && (
            <AnimatedPressable
                style={[styles.backdrop, rightBackdropStyle]}
                onPress={() => setRightSidebarOpen(false)}
            />
        )}
        <SettingsModal
            visible={settingsOpen}
            onClose={() => setSettingsOpen(false)}
        />
        </View>
    );
}

export default function MainScreen() {
    return (
        <InboxProvider>
            <MainScreenContent />
        </InboxProvider>
    );
}
