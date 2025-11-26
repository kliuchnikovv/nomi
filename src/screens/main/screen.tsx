import React, { useEffect, useMemo, useRef, useState } from 'react';

import {
    Animated,
    Pressable,
    Text,
    useWindowDimensions,
    View,
} from 'react-native';

import { Menu, Mail } from 'iconoir-react-native';
import { styles } from './styles'
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

import Sidebar from '../sidebar/screen';
import RightSidebar from '../rightsidebar/screen';
import ChatScreen from '../chat/screen';
import SettingsModal from '../settings/screen';
import { emptyChatID, useMain } from './context';
import { ChatProvider } from '../chat/context.tsx';
import { InboxProvider } from '../rightsidebar/context';

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
    const [rightSidebarOpen, setRightSidebarOpen] = useState(!isNarrow);
    const sidebarWidth = 320;
    const rightSidebarWidth = 320;
    const anim = useRef(
        new Animated.Value(!isNarrow ? sidebarWidth : 0),
    ).current;
    const rightAnim = useRef(
        new Animated.Value(!isNarrow ? rightSidebarWidth : 0),
    ).current;


    useEffect(() => {
        console.log('MainScreen mounted');
        return () => console.log('MainScreen unmounted');
    }, []);

    useEffect(() => {
        // If screen becomes narrow, default to collapsed; if wide, open.
        setSidebarOpen(!isNarrow);
        setRightSidebarOpen(!isNarrow);
    }, [isNarrow]);

    useEffect(() => {
        Animated.timing(anim, {
            toValue: sidebarOpen ? sidebarWidth : 0,
            duration: 180,
            useNativeDriver: false,
        }).start();
    }, [sidebarOpen, anim]);

    useEffect(() => {
        Animated.timing(rightAnim, {
            toValue: rightSidebarOpen ? rightSidebarWidth : 0,
            duration: 180,
            useNativeDriver: false,
        }).start();
    }, [rightSidebarOpen, rightAnim]);



    const sortedChats = useMemo(
        () => [...chats].sort((a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        ), [chats],
    );

    return (
        <View style={styles.root}>
            {/* Sidebar */}
            <Animated.View style={[
                styles.sidebarWrap,
                { width: anim },
                isNarrow && sidebarOpen && {
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
            {(!isNarrow || sidebarOpen) && <View style={styles.divider} />}
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
                    {isNarrow && (
                        <Pressable
                            onPress={() => setRightSidebarOpen(true)}
                            style={styles.headerBtn}
                            accessibilityLabel="Open Inbox"
                        >
                            <Mail width={28} height={28} color={'#ABB2BF'} />
                        </Pressable>
                    )}
                    {!isNarrow && <View style={{ width: 36 }} />}
                </View>
                <ChatProvider
                    activeChatID={activeChatID ? activeChatID : emptyChatID}
                    setActiveChatID={setActiveChatID}
                >
                    <ChatScreen />
                </ChatProvider>
            </View>
            {(!isNarrow || rightSidebarOpen) && <View style={styles.divider} />}
            <Animated.View style={[
                styles.rightSidebarWrap,
                { width: rightAnim },
                isNarrow && rightSidebarOpen && {
                    position: 'absolute',
                    right: 0,
                    top: 0,
                    bottom: 0,
                }
            ]}>
                <InboxProvider>
                    <RightSidebar width={rightSidebarWidth} isOpen={rightSidebarOpen} />
                </InboxProvider>
            </Animated.View>
            {
                isNarrow && sidebarOpen && (
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
                )
            }
            {
                isNarrow && rightSidebarOpen && (
                    <AnimatedPressable
                        style={[
                            styles.backdrop,
                            {
                                right: rightAnim,
                                top: -insets.top,
                                bottom: -insets.bottom,
                            },
                        ]}
                        onPress={() => setRightSidebarOpen(false)}
                    />
                )
            }
            <SettingsModal
                visible={settingsOpen}
                onClose={() => setSettingsOpen(false)}
            />
        </View >
    );
}
