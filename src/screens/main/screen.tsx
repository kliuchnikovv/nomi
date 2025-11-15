import React, { useEffect, useMemo, useRef, useState } from 'react';

import {
    Animated,
    Pressable,
    Text,
    useWindowDimensions,
    View,
} from 'react-native';

import { Menu } from 'iconoir-react-native';
import { styles } from './styles'
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

import Sidebar from '../sidebar/screen';
import ChatScreen from '../chat/screen';
import SettingsModal from '../settings/screen';
import { emptyChatID, useMain } from './context';
import { ChatProvider } from '../chat/context.tsx';

export default function MainScreen() {
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

    const [settingsOpen, setSettingsOpen] = useState(false);
    const isNarrow = width < 768;
    const [sidebarOpen, setSidebarOpen] = useState(!isNarrow);
    const sidebarWidth = 320;
    const anim = useRef(
        new Animated.Value(!isNarrow ? sidebarWidth : 0),
    ).current;

    useEffect(() => {
        // If screen becomes narrow, default to collapsed; if wide, open.
        setSidebarOpen(!isNarrow);
    }, [isNarrow]);

    useEffect(() => {
        Animated.timing(anim, {
            toValue: sidebarOpen ? sidebarWidth : 0,
            duration: 180,
            useNativeDriver: false,
        }).start();
    }, [sidebarOpen, anim]);

    const sortedChats = useMemo(
        () => [...chats].sort((a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        ),[chats],
    );

    return (
        <View style={styles.root}>
            {/* Sidebar */}
            <Animated.View style={[styles.sidebarWrap, { width: anim }]}>
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
            {(!isNarrow || sidebarOpen) && <View style={styles.divider} />}
            <View style={styles.content}>
                <View style={styles.header}>
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
                    <Text style={styles.headerTitle} numberOfLines={1}>
                        {activeChat?.title || 'Chat'}
                    </Text>
                    <View style={{ width: 36 }} />
                </View>
                <ChatProvider
                    activeChatID={activeChatID ? activeChatID : emptyChatID}
                    setActiveChatID={setActiveChatID}
                >
                    <ChatScreen/>
                </ChatProvider>
            </View>
            {isNarrow && sidebarOpen && (
                <AnimatedPressable
                    style={[
                        styles.backdrop,
                        {
                            left: anim,
                            top: -insets.top, // захватывает зону статусбара
                            bottom: -insets.bottom,
                        },
                    ]}
                    onPress={() => setSidebarOpen(false)}
                />
            )}
            <SettingsModal
                visible={settingsOpen}
                onClose={() => setSettingsOpen(false)}
            />
        </View>
    );
}
