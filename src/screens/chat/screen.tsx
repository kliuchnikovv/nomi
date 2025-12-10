import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Platform, KeyboardAvoidingView, Keyboard, StyleSheet } from 'react-native';
import { GiftedChat, IMessage } from 'react-native-gifted-chat';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useWindowDimensions } from 'react-native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { useSharedValue, withTiming, runOnJS } from 'react-native-reanimated';

import { useChat } from './context';
import { useAuth } from '../auth/context';
import { useMain } from '../main/context';
import { ASSISTANT_BUBBLE_WIDTH_RATIO, createChatTheme } from './theme';
import { createStyles } from './styles';
import { useGiftedMessages } from './hooks/useGiftedMessages';
import { useGiftedChatRenderers } from './hooks/useGiftedChatRenderers';
import { ChatHeader } from './components/ChatHeader';
import { ChatSidebar } from './sidebar/screen';
import { useTheme } from '../../context/ThemeContext';

export default function ChatScreen({ onSettingsPress }: { onSettingsPress?: () => void }) {
    const {
        messages,
        sendMessage,
        assistantWorking,
        externalTitle,
        isPluginThread,
        pluginThreadMeta,
        error,
        setError,
        retryLastMessage,
    } = useChat();
    const { user } = useAuth();
    const { theme } = useTheme();
    const chatTheme = useMemo(() => createChatTheme(theme), [theme]);
    const insets = useSafeAreaInsets();
    const { width: windowWidth } = useWindowDimensions();
    const { chats, activeChatID, activeChat, setActiveChatID, getChats, createNewChat, renameChat, deleteChat } = useMain();

    const [sidebarVisible, setSidebarVisible] = useState(false);

    const styles = useMemo(() => createStyles(theme), [theme]);

    const assistantContainerMaxWidth = `${ASSISTANT_BUBBLE_WIDTH_RATIO * 100}%`;

    const giftedMessages = useGiftedMessages(messages, user?.id);

    const handleSend = useCallback((newMessages: IMessage[] = []) => {
        if (newMessages.length > 0 && newMessages[0].text) {
            sendMessage(newMessages[0].text.trim());
        }
    }, [sendMessage]);

    const currentUser = useMemo(() => ({
        _id: user?.id || 'user',
        name: 'You',
    }), [user?.id]);

    const getTimestamp = useCallback((value?: number | string | null) => {
        if (!value) {
            return 0;
        }
        if (typeof value === 'number') {
            return value;
        }
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? 0 : parsed;
    }, []);

    const sortedChats = useMemo(
        () => [...(chats || [])].sort((a, b) => getTimestamp(b.updated_at) - getTimestamp(a.updated_at)),
        [chats, getTimestamp],
    );

    const handleDismissError = useCallback(() => {
        setError(null);
    }, [setError]);

    const {
        renderBubble,
        renderFooter,
        renderInputToolbar,
        renderMessage,
        renderMessageText,
        onLongPressMessage,
    } = useGiftedChatRenderers({
        assistantContainerMaxWidth,
        assistantWorking,
        bottomInset: insets.bottom,
        styles,
        theme,
        onSend: sendMessage,
        error,
        onRetry: retryLastMessage,
        onDismissError: handleDismissError,
    });

    const isWide = windowWidth >= 1024;
    const sidebarWidth = isWide ? 320 : Math.min(windowWidth * 0.9, 360);

    // Sidebar Animation Logic
    const sidebarTranslateX = useSharedValue(-sidebarWidth);

    useEffect(() => {
        if (isWide) {
            getChats();
        }
    }, [getChats, isWide]);

    // Update shared value if sidebarWidth changes
    useEffect(() => {
        if (!isWide && !sidebarVisible) {
            sidebarTranslateX.value = -sidebarWidth;
        }
    }, [sidebarWidth, isWide]);

    const handleOpenMenu = useCallback(() => {
        Keyboard.dismiss();
        getChats({ preserveActiveChat: true });
        setSidebarVisible(true);
        sidebarTranslateX.value = withTiming(0);
    }, [getChats, sidebarTranslateX]);

    const handleCloseMenu = useCallback(() => {
        setSidebarVisible(false);
        sidebarTranslateX.value = withTiming(-sidebarWidth);
    }, [sidebarTranslateX, sidebarWidth]);

    const handleSelectChat = useCallback((chatId: string) => {
        setActiveChatID(chatId);
        handleCloseMenu();
    }, [setActiveChatID, handleCloseMenu]);

    const handleNewChat = useCallback(() => {
        createNewChat();
        handleCloseMenu();
    }, [createNewChat, handleCloseMenu]);

    // Gestures

    // Open gesture (edge swipe)
    const openGesture = Gesture.Pan()
        .maxPointers(1)
        .activeOffsetX([-10, 20]) // Activate if moved right > 20
        .failOffsetY([-20, 20]) // Fail if moved vertically
        .onStart(() => {
            runOnJS(Keyboard.dismiss)();
            runOnJS(getChats)({ preserveActiveChat: true });
        })
        .onUpdate((e) => {
            const newTranslate = -sidebarWidth + e.translationX;
            sidebarTranslateX.value = Math.min(0, Math.max(-sidebarWidth, newTranslate));
        })
        .onEnd((e) => {
            if (sidebarTranslateX.value > -sidebarWidth * 0.6 || e.velocityX > 500) {
                sidebarTranslateX.value = withTiming(0);
                runOnJS(setSidebarVisible)(true);
            } else {
                sidebarTranslateX.value = withTiming(-sidebarWidth);
                runOnJS(setSidebarVisible)(false);
            }
        });

    // Close gesture (drag sidebar back)
    // We set activeOffsetX to negative to only activate when dragging left
    // We set failOffsetY to prevent vertical scrolling from triggering it
    const closeGesture = Gesture.Pan()
        .activeOffsetX([-20, 1000]) // Activate when dragged left by 20px
        .failOffsetY([-10, 10]) // Fail on vertical scroll
        .onUpdate((e) => {
            if (e.translationX < 0) { // Dragging left
                sidebarTranslateX.value = Math.min(0, Math.max(-sidebarWidth, e.translationX));
            }
        })
        .onEnd((e) => {
            if (sidebarTranslateX.value < -sidebarWidth * 0.2 || e.velocityX < -500) {
                sidebarTranslateX.value = withTiming(-sidebarWidth);
                runOnJS(setSidebarVisible)(false);
            } else {
                sidebarTranslateX.value = withTiming(0);
                runOnJS(setSidebarVisible)(true);
            }
        });

    const headerTitle = externalTitle || activeChat?.title || 'New Chat';
    const headerSubtitle = assistantWorking ? 'Assistant is thinking…' : 'Available to help';

    return (
        <View style={styles.container}>
            <View style={styles.layout}>
                {isWide && (
                    <ChatSidebar
                        variant="inline"
                        width={sidebarWidth}
                        chats={sortedChats}
                        activeChatID={activeChatID}
                        onSelectChat={handleSelectChat}
                        onNewChat={handleNewChat}
                        onSettingsPress={onSettingsPress}
                        onChatDelete={deleteChat}
                        onChatRename={renameChat}
                    />
                )}

                <View style={[styles.conversation, { zIndex: 0 }]}>
                    <ChatHeader
                        title={headerTitle}
                        subtitle={headerSubtitle}
                        onMenuPress={handleOpenMenu}
                        showMenu={!isWide}
                    />
                    <KeyboardAvoidingView
                        style={{ flex: 1 }}
                        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                    >
                        <GiftedChat
                            messages={giftedMessages}
                            onSend={handleSend}
                            user={currentUser}
                            renderMessage={renderMessage}
                            renderBubble={renderBubble}
                            renderMessageText={renderMessageText}
                            renderInputToolbar={renderInputToolbar}
                            isTyping={assistantWorking}
                            renderFooter={renderFooter}
                            // @ts-ignore
                            inverted={true}
                            minInputToolbarHeight={60}
                            maxComposerHeight={100}
                            renderAvatar={null}
                            messagesContainerStyle={styles.messagesContainer}
                            placeholder="Type a message..."
                            scrollToBottom
                            alwaysShowSend
                            isAlignedTop={false}
                            isScrollToBottomEnabled={true}
                            timeFormat="HH:mm"
                            onLongPress={onLongPressMessage}
                        />
                    </KeyboardAvoidingView>

                    {/* Edge Swipe Detector */}
                    {!isWide && (
                        <GestureDetector gesture={openGesture}>
                            <View
                                style={{
                                    position: 'absolute',
                                    left: 0,
                                    top: 0,
                                    bottom: 0,
                                    width: 20,
                                    zIndex: 100,
                                }}
                            />
                        </GestureDetector>
                    )}
                </View>
            </View>

            {!isWide && (
                <ChatSidebar
                    variant="overlay"
                    visible={true} // Always mounted, controlled by transform
                    width={sidebarWidth}
                    chats={sortedChats}
                    activeChatID={activeChatID}
                    onClose={handleCloseMenu}
                    onSelectChat={handleSelectChat}
                    onNewChat={handleNewChat}
                    onSettingsPress={onSettingsPress}
                    onChatDelete={deleteChat}
                    onChatRename={renameChat}
                    sidebarTranslateX={sidebarTranslateX}
                    dragGesture={closeGesture}
                />
            )}
        </View>
    );
}
