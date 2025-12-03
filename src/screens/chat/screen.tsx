import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Platform, KeyboardAvoidingView } from 'react-native';
import { GiftedChat, IMessage } from 'react-native-gifted-chat';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useWindowDimensions } from 'react-native';
import { useChat } from './context';
import { useAuth } from '../auth/context';
import { useMain } from '../main/context';
import { ASSISTANT_BUBBLE_WIDTH_RATIO } from './theme';
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
    } = useChat();
    const { user } = useAuth();
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const { width: windowWidth } = useWindowDimensions();
    const { chats, activeChatID, setActiveChatID, getChats, createNewChat, renameChat, deleteChat } = useMain();
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

    const {
        renderBubble,
        renderFooter,
        renderInputToolbar,
        renderMessage,
        renderMessageText,
    } = useGiftedChatRenderers({
        assistantContainerMaxWidth,
        assistantWorking,
        bottomInset: insets.bottom,
        styles,
        theme,
        onSend: sendMessage,
    });

    const isWide = windowWidth >= 1024;
    const sidebarWidth = isWide ? 320 : Math.min(windowWidth * 0.9, 360);

    useEffect(() => {
        if (isWide) {
            getChats();
        }
    }, [getChats, isWide]);

    const handleOpenMenu = useCallback(() => {
        getChats({ preserveActiveChat: true });
        setSidebarVisible(true);
    }, [getChats]);

    const handleCloseMenu = useCallback(() => {
        setSidebarVisible(false);
    }, []);

    const handleSelectChat = useCallback((chatId: string) => {
        setActiveChatID(chatId);
        setSidebarVisible(false);
    }, [setActiveChatID]);

    const handleNewChat = useCallback(() => {
        createNewChat();
        setSidebarVisible(false);
    }, [createNewChat]);

    const headerTitle = externalTitle || 'Gemini';
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

                <View style={styles.conversation}>
                    <ChatHeader
                        title={headerTitle}
                        subtitle={headerSubtitle}
                        onMenuPress={handleOpenMenu}
                        showMenu={!isWide}
                    />
                    <KeyboardAvoidingView
                        style={{ flex: 1 }}
                        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                        keyboardVerticalOffset={insets.bottom}
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
                            minInputToolbarHeight={80}
                            maxComposerHeight={100}
                            renderAvatar={null}
                            messagesContainerStyle={styles.messagesContainer}
                            placeholder="Type a message..."
                            scrollToBottom
                            alwaysShowSend
                            isAlignedTop={false}
                            isScrollToBottomEnabled={true}
                        />
                    </KeyboardAvoidingView>
                </View>
            </View>

            {!isWide && (
                <ChatSidebar
                    variant="overlay"
                    visible={sidebarVisible}
                    width={sidebarWidth}
                    chats={sortedChats}
                    activeChatID={activeChatID}
                    onClose={handleCloseMenu}
                    onSelectChat={handleSelectChat}
                    onNewChat={handleNewChat}
                    onSettingsPress={onSettingsPress}
                    onChatDelete={deleteChat}
                    onChatRename={renameChat}
                />
            )}
        </View>
    );
}
