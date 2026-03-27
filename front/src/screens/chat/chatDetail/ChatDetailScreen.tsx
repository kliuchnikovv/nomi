import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, RefreshControl, View, KeyboardAvoidingView, Modal, ActivityIndicator } from 'react-native';
import { GiftedChat, IMessage } from 'react-native-gifted-chat';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ImageViewing from 'react-native-image-viewing';

import { useChat } from '../context';
import { useAuth } from '../../auth/context';
import { emptyChatID } from '../../main/context';
import { createChatTheme } from '../theme';
import { createStyles } from '../styles';
import { useGiftedMessages } from '../hooks/useGiftedMessages';
import { useGiftedChatRenderers } from '../hooks/useGiftedChatRenderers';
import { ChatHeader } from '../components/ChatHeader';
import { useTheme } from '../../../context/ThemeContext';
import { AVAILABLE_TEAMS } from '../teams';
import { DiceRollOverlay } from '../components/DiceRollOverlay';
import { useAskUser } from '../AskUserContext';
import { AskUserDialog } from '../components/AskUserDialog';
import { useRoute } from '@react-navigation/native';
import type { ChatStackParamList } from '../../../navigation/types';

export function ChatDetailScreen() {
    const route = useRoute<{ params: { chatId: string } }>();
    const { chatId } = route.params;
    const { showDialog, dialogState, submitResponse, cancelDialog } = useAskUser();
    const {
        messages,
        messagesLoading,
        getMessages,
        refreshing,
        sendMessage,
        assistantWorking,
        externalTitle,
        isPluginThread,
        pluginThreadMeta,
        error,
        setError,
        retryLastMessage,
        clearPluginThread,
        chatMode,
        selectedTeamId,
        activeAgentsCount,
    } = useChat();
    const { user, token } = useAuth();
    const { theme } = useTheme();
    const chatTheme = useMemo(() => createChatTheme(theme), [theme]);
    const insets = useSafeAreaInsets();

    const [diceRollVisible, setDiceRollVisible] = useState(false);

    const styles = useMemo(() => createStyles(theme), [theme]);

    const giftedMessages = useGiftedMessages(messages, user?.id);

    const lastMessageIdRef = useRef<string>('');
    const extraData = useMemo(() => {
        const lastMsg = messages[0];
        const lastId = lastMsg?.id || '';
        const hasChanged = lastId !== lastMessageIdRef.current;
        lastMessageIdRef.current = lastId;
        return {
            lastMessageId: lastId,
            lastMessageUpdated: lastMsg?.updated_at || lastMsg?.created_at,
            refreshTrigger: hasChanged ? Date.now() : extraData?.refreshTrigger,
        };
    }, [messages]);

    const currentUser = useMemo(
        () => ({
            _id: user?.id || 'unknown',
            name: user?.name || 'User',
            avatar: user?.avatar_url || undefined,
        }),
        [user],
    );

    const headerTitle = useMemo(() => {
        if (isPluginThread && pluginThreadMeta?.title) {
            return pluginThreadMeta.title;
        }
        return externalTitle || 'Chat';
    }, [externalTitle, isPluginThread, pluginThreadMeta]);

    const headerSubtitle = useMemo(() => {
        if (isPluginThread && pluginThreadMeta?.subtitle) {
            return pluginThreadMeta.subtitle;
        }
        if (chatMode === 'team' && selectedTeamId) {
            const team = AVAILABLE_TEAMS.find(t => t.id === selectedTeamId);
            return team?.name || 'Team';
        }
        return chatMode === 'agent' ? 'Genie' : undefined;
    }, [chatMode, isPluginThread, pluginThreadMeta, selectedTeamId]);

    useEffect(() => {
        if (chatId && chatId !== emptyChatID && !isPluginThread) {
            getMessages();
        }
    }, [chatId, isPluginThread, getMessages]);

    useEffect(() => {
        if (error && error !== 'User cancelled') {
            console.error('Chat error:', error);
        }
    }, [error]);

    const handleSend = useCallback(
        async (newMessages: IMessage[] = []) => {
            if (newMessages.length === 0) return;

            const lastMessage = newMessages[newMessages.length - 1];
            const text = lastMessage.text;

            if (!text.trim()) return;

            await sendMessage(text);
        },
        [sendMessage],
    );

    const handleRefreshHistory = useCallback(async () => {
        if (chatId && chatId !== emptyChatID && !isPluginThread) {
            await getMessages();
        }
    }, [chatId, isPluginThread, getMessages]);

    const handleRollDice = useCallback(() => {
        setDiceRollVisible(true);
    }, []);

    const shouldUpdateMessage = useCallback((prevMessage: IMessage, nextMessage: IMessage) => {
        return prevMessage._id === nextMessage._id && prevMessage.text !== nextMessage.text;
    }, []);

    const {
        renderMessage,
        renderBubble,
        renderMessageText,
        onLongPressMessage,
        attachmentPosition,
        setAttachmentPosition,
    } = useGiftedChatRenderers({
        theme,
        chatTheme,
        styles,
        user,
        currentUser,
        messages,
        assistantWorking,
        error,
        setError,
        retryLastMessage,
        handleRollDice,
        insetTop: insets.top,
        insetBottom: insets.bottom,
        assistantContainerMaxWidth: `${80}%`,
        assistantWorking,
    });

    const renderInputToolbar = useCallback(
        (props: any) => {
            const ChatInput = require('../input/ChatInput').default;
            return (
                <ChatInput
                    {...props}
                    attachmentPosition={attachmentPosition}
                    setAttachmentPosition={setAttachmentPosition}
                />
            );
        },
        [attachmentPosition],
    );

    const renderFooter = useCallback(() => {
        if (error && error !== 'User cancelled') {
            return (
                <View style={styles.errorContainer}>
                    <View style={styles.errorContent}>
                        <View style={styles.errorTextContainer}>
                            <Text style={styles.errorText}>{error}</Text>
                        </View>
                        <Pressable onPress={retryLastMessage} style={styles.retryButton}>
                            <Text style={styles.retryButtonText}>Retry</Text>
                        </Pressable>
                    </View>
                </View>
            );
        }
        if (chatMode === 'team' && AVAILABLE_TEAMS.find(t => t.id === selectedTeamId)?.id === 'dnd_team') {
            return <DiceRollOverlay visible={diceRollVisible} onClose={() => setDiceRollVisible(false)} />;
        }
        return null;
    }, [error, retryLastMessage, chatMode, selectedTeamId, diceRollVisible, styles]);

    return (
        <View style={[styles.container, { backgroundColor: theme.background }]}>
            <ChatHeader
                title={headerTitle}
                subtitle={headerSubtitle}
                showMenu={false}
                showInbox={false}
                isInboxMode={isPluginThread}
                icon={undefined}
                chatMode={chatMode}
                teamId={selectedTeamId}
                activeAgentsCount={activeAgentsCount}
                isWorking={assistantWorking}
            />

            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                style={{ flex: 1 }}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
            >
                <GiftedChat
                    messages={messagesLoading ? [] : giftedMessages}
                    onSend={handleSend}
                    user={currentUser}
                    renderMessage={renderMessage}
                    renderBubble={renderBubble}
                    renderMessageText={renderMessageText}
                    renderInputToolbar={renderInputToolbar}
                    isTyping={false}
                    renderFooter={renderFooter}
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
                    shouldUpdateMessage={shouldUpdateMessage}
                    extraData={extraData}
                    keyExtractor={(message: IMessage) => String(message._id)}
                    listProps={
                        chatId && chatId !== emptyChatID && !isPluginThread
                            ? {
                                refreshControl: (
                                    <RefreshControl
                                        refreshing={refreshing}
                                        onRefresh={handleRefreshHistory}
                                        tintColor={theme.accent}
                                        colors={[theme.accent]}
                                    />
                                ),
                                maintainVisibleContentPosition: undefined,
                                maxToRenderPerBatch: 10,
                                windowSize: 10,
                                initialNumToRender: 15,
                                updateCellsBatchingPeriod: 50,
                            }
                            : {
                                maxToRenderPerBatch: 10,
                                windowSize: 10,
                                initialNumToRender: 15,
                            }
                    }
                />
            </KeyboardAvoidingView>

            {showDialog && (
                <AskUserDialog
                    visible={showDialog}
                    title={dialogState.title}
                    description={dialogState.description}
                    options={dialogState.options}
                    onSelect={submitResponse}
                    onCancel={cancelDialog}
                />
            )}
        </View>
    );
}
