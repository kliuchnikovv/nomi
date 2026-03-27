import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Platform, KeyboardAvoidingView, RefreshControl, Text, Pressable, StyleSheet } from 'react-native';
import { GiftedChat, IMessage } from 'react-native-gifted-chat';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ImageViewing from 'react-native-image-viewing';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { useChat } from '../context';
import { useAuth } from '../../auth/context';
import { emptyChatID, useMain } from '../../main/context';
import { ASSISTANT_BUBBLE_WIDTH_RATIO, createChatTheme } from '../theme';
import { createStyles } from '../styles';
import { useGiftedMessages } from '../hooks/useGiftedMessages';
import { useGiftedChatRenderers } from '../hooks/useGiftedChatRenderers';
import { useTheme } from '../../../context/ThemeContext';
import { Attachment, MessageAction } from '../../main/models';
import { sidebarApi } from '../../../apiClient';
import { AVAILABLE_TEAMS } from '../teams';
import { DiceRollOverlay } from '../components/DiceRollOverlay';
import { useAskUser } from '../AskUserContext';
import { AskUserDialog } from '../components/AskUserDialog';
import type { ChatStackParamList } from '../../../navigation/types';

export function ChatDetailScreen() {
    const route = useRoute<RouteProp<ChatStackParamList, 'ChatDetail'>>();
    const { chatId } = route.params;
    const navigation = useNavigation();

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
        error,
        setError,
        retryLastMessage,
        chatMode,
        selectedTeamId,
        activeAgentsCount,
    } = useChat();
    const { user, token } = useAuth();
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const { activeChat } = useMain();

    const styles = useMemo(() => createStyles(theme), [theme]);
    const assistantContainerMaxWidth = `${ASSISTANT_BUBBLE_WIDTH_RATIO * 100}%`;

    const giftedMessages = useGiftedMessages(messages, user?.id);

    // Attachment state
    const [imageViewerVisible, setImageViewerVisible] = useState(false);
    const [currentImageIndex, setCurrentImageIndex] = useState(0);
    const [previewImages, setPreviewImages] = useState<any[]>([]);
    const [attachmentPosition] = useState<'inside' | 'outside'>('inside');

    // Dice Roll state
    const [diceOverlayVisible, setDiceOverlayVisible] = useState(false);
    const [diceExpression, setDiceExpression] = useState<string | null>(null);
    const [diceDC, setDiceDC] = useState<number | null>(null);
    const [processedRolls, setProcessedRolls] = useState<Set<string>>(new Set());

    const lastMessageIdRef = useRef<string>('');
    const refreshTriggerRef = useRef<number>(0);
    const extraData = useMemo(() => {
        const lastMsg = messages[0];
        const lastId = lastMsg?.id || '';
        const hasChanged = lastId !== lastMessageIdRef.current;
        lastMessageIdRef.current = lastId;
        if (hasChanged) {
            refreshTriggerRef.current = Date.now();
        }
        return {
            lastMessageId: lastId,
            lastMessageUpdated: lastMsg?.created_at,
            refreshTrigger: refreshTriggerRef.current,
        };
    }, [messages]);

    const currentUser = useMemo(
        () => ({
            _id: user?.id || 'user',
            name: 'You',
        }),
        [user?.id],
    );

    const headerTitle = externalTitle || 'Chat';
    const headerSubtitle = useMemo(() => {
        if (assistantWorking) return 'typing...';
        if (chatMode === 'team') {
            const team = AVAILABLE_TEAMS.find(t => t.id === selectedTeamId);
            return team?.name || '';
        }
        return '';
    }, [assistantWorking, chatMode, selectedTeamId]);

    const avatarInitial = useMemo(() => {
        const icon = activeChat?.icon;
        if (icon && icon.length > 0) return icon[0];
        return headerTitle ? headerTitle[0].toUpperCase() : 'G';
    }, [activeChat?.icon, headerTitle]);

    useEffect(() => {
        if (chatId && chatId !== emptyChatID && !isPluginThread) {
            getMessages(chatId);
        }
    }, [chatId, isPluginThread, getMessages]);

    useEffect(() => {
        // Scan for dice roll tool calls
        if (!messages || messages.length === 0) return;
        const lastMsg = messages[0];
        if (lastMsg.tool_calls && lastMsg.tool_calls.length > 0) {
            for (const tool of lastMsg.tool_calls) {
                if (tool.tool?.name === 'roll_dice' && !processedRolls.has(lastMsg.id)) {
                    let resultData: any = null;
                    if (tool.tool.result) {
                        try {
                            resultData = typeof tool.tool.result === 'string'
                                ? JSON.parse(tool.tool.result)
                                : tool.tool.result;
                        } catch (e) {
                            console.warn('Failed to parse dice result', e);
                        }
                    }
                    if (resultData && resultData.__client_action__ === 'roll_dice') {
                        setDiceExpression(resultData.expression);
                        setDiceDC(resultData.dc);
                        setDiceOverlayVisible(true);
                        setProcessedRolls(prev => new Set(prev).add(lastMsg.id));
                        break;
                    }
                }
            }
        }
    }, [messages, processedRolls]);

    // Register AskUser dialog globally for ClientToolExecutor
    useEffect(() => {
        (globalThis as any).__askUserDialog = showDialog;
        return () => {
            delete (globalThis as any).__askUserDialog;
        };
    }, [showDialog]);

    const handleDiceComplete = useCallback((resultMessage: string) => {
        setDiceOverlayVisible(false);
        setDiceExpression(null);
        setDiceDC(null);
        if (resultMessage) {
            sendMessage(resultMessage);
        }
    }, [sendMessage]);

    const handleSend = useCallback((newMessages: IMessage[] = []) => {
        if (newMessages.length > 0 && newMessages[0].text) {
            sendMessage(newMessages[0].text.trim());
        }
    }, [sendMessage]);

    const handleDismissError = useCallback(() => {
        setError(null);
    }, [setError]);

    const handleRefreshHistory = useCallback(() => {
        if (!chatId || chatId === emptyChatID || isPluginThread) return;
        getMessages(chatId, { isRefresh: true });
    }, [chatId, getMessages, isPluginThread]);

    const handleAttachmentPress = useCallback(async (attachment: Attachment) => {
        if (attachment.file_type?.startsWith('image/')) {
            const images: any[] = [];
            if (attachment.uri) {
                images.push({ uri: attachment.uri });
            } else if (attachment.content) {
                const uri = attachment.content.startsWith('data:image')
                    ? attachment.content
                    : `data:${attachment.file_type || 'image/png'};base64,${attachment.content}`;
                images.push({ uri });
            } else if (attachment.id) {
                images.push({ uri: `${attachment.id}`, headers: { Authorization: `Bearer ${token}` } });
            }
            setPreviewImages(images);
            setCurrentImageIndex(0);
            setImageViewerVisible(true);
        } else {
            try {
                if (attachment.uri?.startsWith('http')) {
                    const isAvailable = await Sharing.isAvailableAsync();
                    if (isAvailable) {
                        const fileUri = (FileSystem.documentDirectory || FileSystem.cacheDirectory) + '/' + (attachment.file_name || 'download');
                        const downloadRes = await FileSystem.downloadAsync(attachment.uri, fileUri);
                        await Sharing.shareAsync(downloadRes.uri);
                    }
                } else if (attachment.content) {
                    const fileUri = (FileSystem.documentDirectory || FileSystem.cacheDirectory) + '/' + (attachment.file_name || 'file');
                    await FileSystem.writeAsStringAsync(fileUri, attachment.content, { encoding: 'base64' });
                    await Sharing.shareAsync(fileUri);
                }
            } catch (e) {
                console.error('Error sharing file:', e);
            }
        }
    }, [token]);

    const handleMessageAction = useCallback(async (messageId: string, action: MessageAction) => {
        try {
            await sidebarApi.executeMessageAction('any', messageId, action);
        } catch (e) {
            console.error('Failed to execute action', e);
        }
    }, []);

    const shouldUpdateMessage = useCallback((currentProps: any, nextProps: any) => {
        const current = currentProps.currentMessage;
        const next = nextProps.currentMessage;
        if (current === next) return false;
        if (current._id !== next._id) return true;
        if (current.text !== next.text) return true;
        if (current.createdAt !== next.createdAt) return true;
        if ((current as any).content_parts !== (next as any).content_parts) return true;
        if ((current as any).tool_calls !== (next as any).tool_calls) return true;
        return false;
    }, []);

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
        onAttachmentPress: handleAttachmentPress,
        attachmentPosition,
        onMessageAction: handleMessageAction,
    });

    return (
        <View style={[styles.container, { backgroundColor: theme.background }]}>
            {/* iMessage-style header */}
            <View style={[detailStyles.header, { paddingTop: insets.top + 8, backgroundColor: theme.background, borderBottomColor: theme.border }]}>
                {/* Left: back button */}
                <Pressable onPress={() => navigation.goBack()} style={detailStyles.backBtn} hitSlop={8}>
                    <Ionicons name="chevron-back" size={20} color={theme.accent} />
                    <Text style={[detailStyles.backText, { color: theme.accent }]}>Back</Text>
                </Pressable>

                {/* Center: avatar + name + subtitle */}
                <View style={detailStyles.center}>
                    <View style={[detailStyles.avatar, { backgroundColor: theme.accent }]}>
                        <Text style={detailStyles.avatarText}>{avatarInitial}</Text>
                    </View>
                    <Text style={[detailStyles.title, { color: theme.text }]} numberOfLines={1}>
                        {headerTitle}
                    </Text>
                    {headerSubtitle ? (
                        <Text style={[detailStyles.subtitle, { color: theme.textSecondary }]} numberOfLines={1}>
                            {headerSubtitle}
                        </Text>
                    ) : null}
                </View>

                {/* Right: info button placeholder */}
                <Pressable style={detailStyles.infoBtn} hitSlop={8}>
                    <Ionicons name="information-circle-outline" size={24} color={theme.accent} />
                </Pressable>
            </View>

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

            <ImageViewing
                images={previewImages}
                imageIndex={currentImageIndex}
                visible={imageViewerVisible}
                onRequestClose={() => setImageViewerVisible(false)}
                keyExtractor={(imageSrc: any, index: number) => `${imageSrc.uri}${index}`}
            />

            <DiceRollOverlay
                visible={diceOverlayVisible}
                expression={diceExpression}
                dc={diceDC}
                onComplete={handleDiceComplete}
                onClose={() => setDiceOverlayVisible(false)}
            />

            <AskUserDialog
                visible={dialogState.visible}
                question={dialogState.question}
                options={dialogState.options}
                onSubmit={submitResponse}
                onCancel={cancelDialog}
                theme={theme}
            />
        </View>
    );
}

const detailStyles = StyleSheet.create({
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingBottom: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    backBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        minWidth: 70,
        gap: 2,
    },
    backText: {
        fontSize: 17,
        fontWeight: '400',
    },
    center: {
        flex: 1,
        alignItems: 'center',
    },
    avatar: {
        width: 38,
        height: 38,
        borderRadius: 19,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 2,
    },
    avatarText: {
        color: '#ffffff',
        fontSize: 16,
        fontWeight: '700',
    },
    title: {
        fontSize: 14,
        fontWeight: '700',
        lineHeight: 18,
    },
    subtitle: {
        fontSize: 11,
        lineHeight: 14,
    },
    infoBtn: {
        minWidth: 70,
        alignItems: 'flex-end',
    },
});
