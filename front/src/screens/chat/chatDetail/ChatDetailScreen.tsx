import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import {
    View,
    RefreshControl,
    Text,
    Pressable,
    StyleSheet,
    AppState,
    TouchableOpacity,
    TouchableWithoutFeedback,
    Keyboard,
} from 'react-native';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
} from 'react-native-reanimated';
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
import { sidebarApi, projectsApi, apiClient } from '../../../apiClient';
import { getApiUrl } from '../../../config';
import type { Project } from '../../main/models';
import { ProjectSuggestionBanner } from './ProjectSuggestionBanner';
import { PersistentChatEmptyState, useChips } from './PersistentChatEmptyState';
import { SessionHistorySheet, formatSessionDate } from './SessionHistorySheet';
import { AVAILABLE_TEAMS } from '../teams';
import { DiceRollOverlay } from '../components/DiceRollOverlay';
import { ToastContainer } from '../../../utils/ToastContainer';
import { useAskUser } from '../AskUserContext';
import { AskUserDialog } from '../components/AskUserDialog';
import { TAB_BAR_ICON_HEIGHT } from '../../../navigation/MainTabs';
import type { ChatStackParamList } from '../../../navigation/types';
import type { Chat, Message } from '../../main/models';

export function ChatDetailScreen() {
    const route = useRoute<RouteProp<ChatStackParamList, 'ChatDetail'>>();
    const chatId = route.params?.chatId ?? emptyChatID;
    const navigation = useNavigation();

    const inputAnimY = useSharedValue(0);
    const { height: keyboardHeight } = useReanimatedKeyboardAnimation();

    const { showDialog, dialogState, submitResponse, cancelDialog } =
        useAskUser();
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
        suggestedProjectId,
        classifiedText,
        clearProjectSuggestion,
        pendingMessage,
        suggestedProjectForSession,
        clearProjectSuggestionForSession,
        confirmProjectSuggestionForSession,
        setPendingInputText,
    } = useChat();
    const { user, token } = useAuth();
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const { activeChat, getChats, isNewSession, setIsNewSession } = useMain();

    const styles = useMemo(() => createStyles(theme), [theme]);
    const assistantContainerMaxWidth = `${ASSISTANT_BUBBLE_WIDTH_RATIO * 100}%`;

    const animatedKeyboardStyle = useAnimatedStyle(() => ({
        flex: 1,
        backgroundColor: theme.background,
        paddingBottom: Math.max(-keyboardHeight.value, insets.bottom),
    }));

    const giftedMessages = useGiftedMessages(messages, user?.id);
    const chips = useChips();

    // Attachment state
    const [imageViewerVisible, setImageViewerVisible] = useState(false);
    const [currentImageIndex, setCurrentImageIndex] = useState(0);
    const [previewImages, setPreviewImages] = useState<any[]>([]);
    const [attachmentPosition] = useState<'inside' | 'outside'>('inside');

    // Dice Roll state
    const [diceOverlayVisible, setDiceOverlayVisible] = useState(false);
    const [diceExpression, setDiceExpression] = useState<string | null>(null);
    const [diceDC, setDiceDC] = useState<number | null>(null);
    const [processedRolls, setProcessedRolls] = useState<Set<string>>(
        new Set(),
    );

    // Project suggestion banner (non-session, existing chats)
    const [suggestedProject, setSuggestedProject] = useState<Project | null>(
        null,
    );

    // History sheet state
    const [historySheetVisible, setHistorySheetVisible] = useState(false);
    const [loadedHistoryChat, setLoadedHistoryChat] = useState<Chat | null>(
        null,
    );
    const [historyMessages, setHistoryMessages] = useState<Message[]>([]);
    const historyGiftedMessages = useGiftedMessages(historyMessages, user?.id);

    useEffect(() => {
        console.log(
            '[ProjectBanner] suggestedProjectId changed:',
            suggestedProjectId,
        );
        if (!suggestedProjectId) {
            setSuggestedProject(null);
            return;
        }
        projectsApi
            .list()
            .then(projects => {
                const found =
                    (projects ?? []).find(p => p.id === suggestedProjectId) ??
                    null;
                console.log(
                    '[ProjectBanner] resolved project:',
                    found?.name ?? 'NOT FOUND',
                );
                setSuggestedProject(found);
            })
            .catch(e => {
                console.warn('[ProjectBanner] failed to load projects:', e);
                setSuggestedProject(null);
            });
    }, [suggestedProjectId]);

    const handleAcceptProjectSuggestion = useCallback(() => {
        if (!suggestedProjectId) return;
        clearProjectSuggestion();
        // Navigate to a brand-new chat in the project, pre-populated with the
        // message that triggered the suggestion — without touching the current chat.
        (navigation as any).navigate('Projects', {
            screen: 'ProjectChatDetail',
            params: {
                chatId: '',
                projectId: suggestedProjectId,
                pendingText: classifiedText ?? undefined,
            },
        });
    }, [
        suggestedProjectId,
        classifiedText,
        clearProjectSuggestion,
        navigation,
    ]);

    const handleSelectSession = useCallback(async (selectedChat: Chat) => {
        setLoadedHistoryChat(selectedChat);
        const msgs = await apiClient.get<Message[]>(
            `${getApiUrl()}/chats/${selectedChat.id}/messages`,
        );
        setHistoryMessages(msgs ?? []);
    }, []);

    const handleChipPress = useCallback(
        (text: string) => {
            setPendingInputText(text);
        },
        [setPendingInputText],
    );

    const handleAcceptSessionProjectSuggestion = useCallback(() => {
        if (!suggestedProjectForSession) return;
        confirmProjectSuggestionForSession();
        (navigation as any).navigate('Projects', {
            screen: 'ProjectChatDetail',
            params: {
                chatId: '',
                projectId: suggestedProjectForSession.id,
                pendingText: pendingMessage ?? undefined,
            },
        });
    }, [
        suggestedProjectForSession,
        pendingMessage,
        confirmProjectSuggestionForSession,
        navigation,
    ]);

    const lastMessageIdRef = useRef<string>('');
    const refreshTriggerRef = useRef<number>(0);
    const appStateRef = useRef(AppState.currentState);
    const snapshotUpdatedAtRef = useRef<number>(activeChat?.updated_at ?? 0);
    const shouldRefreshRef = useRef(false);
    const activeChatRef = useRef(activeChat);
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

    const headerTitle = externalTitle || activeChat?.title || 'Chat';
    const headerSubtitle = useMemo(() => {
        if (assistantWorking) return 'typing...';
        if (chatMode === 'team') {
            const team = AVAILABLE_TEAMS.find(t => t.id === selectedTeamId);
            return team?.name || '';
        }
        return '';
    }, [assistantWorking, chatMode, selectedTeamId]);

    useEffect(() => {
        activeChatRef.current = activeChat;
    }, [activeChat]);

    useEffect(() => {
        if (chatId && chatId !== emptyChatID && !isPluginThread) {
            getMessages(chatId);
        }
    }, [chatId, isPluginThread, getMessages]);

    useEffect(() => {
        if (!chatId || chatId === emptyChatID || isPluginThread) return;
        const sub = AppState.addEventListener(
            'change',
            (
                nextState:
                    | 'active'
                    | 'background'
                    | 'inactive'
                    | 'unknown'
                    | 'extension',
            ) => {
                if (nextState === 'background' || nextState === 'inactive') {
                    snapshotUpdatedAtRef.current =
                        activeChatRef.current?.updated_at ?? 0;
                } else if (
                    appStateRef.current.match(/inactive|background/) &&
                    nextState === 'active'
                ) {
                    shouldRefreshRef.current = true;
                    getChats({ preserveActiveChat: true });
                }
                appStateRef.current = nextState;
            },
        );
        return () => sub.remove();
    }, [chatId, isPluginThread, getChats]);

    useEffect(() => {
        if (!shouldRefreshRef.current) return;
        if (!chatId || chatId === emptyChatID || isPluginThread) return;
        shouldRefreshRef.current = false;
        if (
            activeChat &&
            activeChat.updated_at > snapshotUpdatedAtRef.current
        ) {
            getMessages(chatId, { isRefresh: true });
        }
    }, [activeChat?.updated_at, chatId, isPluginThread, getMessages]);

    useEffect(() => {
        // Scan for dice roll tool calls
        if (!messages || messages.length === 0) return;
        const lastMsg = messages[0];
        if (lastMsg.tool_calls && lastMsg.tool_calls.length > 0) {
            for (const tool of lastMsg.tool_calls) {
                if (
                    tool.tool?.name === 'roll_dice' &&
                    !processedRolls.has(lastMsg.id)
                ) {
                    let resultData: any = null;
                    if (tool.tool.result) {
                        try {
                            resultData =
                                typeof tool.tool.result === 'string'
                                    ? JSON.parse(tool.tool.result)
                                    : tool.tool.result;
                        } catch (e) {
                            console.warn('Failed to parse dice result', e);
                        }
                    }
                    if (
                        resultData &&
                        resultData.__client_action__ === 'roll_dice'
                    ) {
                        setDiceExpression(resultData.expression);
                        setDiceDC(resultData.dc);
                        setDiceOverlayVisible(true);
                        setProcessedRolls(prev =>
                            new Set(prev).add(lastMsg.id),
                        );
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

    const handleDiceComplete = useCallback(
        (resultMessage: string) => {
            setDiceOverlayVisible(false);
            setDiceExpression(null);
            setDiceDC(null);
            if (resultMessage) {
                sendMessage(resultMessage);
            }
        },
        [sendMessage],
    );

    const handleSend = useCallback(
        (newMessages: IMessage[] = []) => {
            if (newMessages.length > 0 && newMessages[0].text) {
                sendMessage(newMessages[0].text.trim());
            }
        },
        [sendMessage],
    );

    const handleDismissError = useCallback(() => {
        setError(null);
    }, [setError]);

    const handleRefreshHistory = useCallback(() => {
        if (!chatId || chatId === emptyChatID || isPluginThread) return;
        getMessages(chatId, { isRefresh: true });
    }, [chatId, getMessages, isPluginThread]);

    const handleNewChat = useCallback(() => {
        setIsNewSession(true);
        (navigation as any).replace('ChatDetail', { chatId: emptyChatID });
    }, [navigation, setIsNewSession]);

    const handleAttachmentPress = useCallback(
        async (attachment: Attachment) => {
            if (attachment.file_type?.startsWith('image/')) {
                const images: any[] = [];
                if (attachment.uri) {
                    images.push({ uri: attachment.uri });
                } else if (attachment.content) {
                    const uri = attachment.content.startsWith('data:image')
                        ? attachment.content
                        : `data:${attachment.file_type || 'image/png'};base64,${
                              attachment.content
                          }`;
                    images.push({ uri });
                } else if (attachment.id) {
                    images.push({
                        uri: `${attachment.id}`,
                        headers: { Authorization: `Bearer ${token}` },
                    });
                }
                setPreviewImages(images);
                setCurrentImageIndex(0);
                setImageViewerVisible(true);
            } else {
                try {
                    if (attachment.uri?.startsWith('http')) {
                        const isAvailable = await Sharing.isAvailableAsync();
                        if (isAvailable) {
                            const fileUri =
                                (FileSystem.documentDirectory ||
                                    FileSystem.cacheDirectory) +
                                '/' +
                                (attachment.file_name || 'download');
                            const downloadRes = await FileSystem.downloadAsync(
                                attachment.uri,
                                fileUri,
                            );
                            await Sharing.shareAsync(downloadRes.uri);
                        }
                    } else if (attachment.content) {
                        const fileUri =
                            (FileSystem.documentDirectory ||
                                FileSystem.cacheDirectory) +
                            '/' +
                            (attachment.file_name || 'file');
                        await FileSystem.writeAsStringAsync(
                            fileUri,
                            attachment.content,
                            { encoding: 'base64' },
                        );
                        await Sharing.shareAsync(fileUri);
                    }
                } catch (e) {
                    console.error('Error sharing file:', e);
                }
            }
        },
        [token],
    );

    const handleMessageAction = useCallback(
        async (messageId: string, action: MessageAction) => {
            try {
                await sidebarApi.executeMessageAction('any', messageId, action);
            } catch (e) {
                console.error('Failed to execute action', e);
            }
        },
        [],
    );

    const shouldUpdateMessage = useCallback(
        (currentProps: any, nextProps: any) => {
            const current = currentProps.currentMessage;
            const next = nextProps.currentMessage;
            if (current === next) return false;
            if (current._id !== next._id) return true;
            if (current.text !== next.text) return true;
            if (current.createdAt !== next.createdAt) return true;
            if ((current as any).content_parts !== (next as any).content_parts)
                return true;
            if ((current as any).tool_calls !== (next as any).tool_calls)
                return true;
            return false;
        },
        [],
    );

    const {
        renderBubble,
        renderFooter,
        renderInputToolbar: renderInputToolbarBase,
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
        inputAnimY,
    });

    const showEmptyChips =
        isNewSession &&
        historyMessages.length === 0 &&
        giftedMessages.length === 0;
    const showEmptyGreeting = showEmptyChips;

    const renderInputToolbar = useCallback(
        (props: any) => {
            const toolbar = renderInputToolbarBase(props);
            if (pendingMessage) {
                return (
                    <View pointerEvents="none" style={{ opacity: 0.4 }}>
                        {toolbar}
                    </View>
                );
            }
            return toolbar;
        },
        [pendingMessage, renderInputToolbarBase],
    );

    return (
        <View
            style={[
                styles.container,
                {
                    backgroundColor: theme.background,
                },
            ]}
        >
            {/* Header */}
            <View
                style={[
                    detailStyles.header,
                    {
                        paddingTop: insets.top + 8,
                        backgroundColor: theme.background,
                        borderBottomColor: theme.border,
                    },
                ]}
            >
                {/* Left: back arrow only */}
                <Pressable
                    onPress={() => navigation.goBack()}
                    style={detailStyles.backBtn}
                    hitSlop={12}
                >
                    <Ionicons
                        name="chevron-back"
                        size={28}
                        color={theme.accent}
                    />
                </Pressable>

                {/* Center: title only */}
                <View style={detailStyles.center}>
                    <Text
                        style={[detailStyles.title, { color: theme.text }]}
                        numberOfLines={1}
                    >
                        {headerTitle}
                    </Text>
                    {headerSubtitle ? (
                        <Text
                            style={[
                                detailStyles.subtitle,
                                { color: theme.textSecondary },
                            ]}
                            numberOfLines={1}
                        >
                            {headerSubtitle}
                        </Text>
                    ) : null}
                </View>

                {/* Right: history + new chat buttons */}
                <View style={detailStyles.headerRight}>
                    {user?.single_chat_mode && (
                        <Pressable hitSlop={8} onPress={() => setHistorySheetVisible(true)}>
                            <Ionicons name="time-outline" size={22} color={theme.accent} />
                        </Pressable>
                    )}
                    <Pressable hitSlop={8} onPress={handleNewChat}>
                        <Ionicons name="create-outline" size={22} color={theme.accent} />
                    </Pressable>
                </View>
            </View>

            {/* Non-session project suggestion banner (existing chats) */}
            {!isNewSession && suggestedProject && (
                <ProjectSuggestionBanner
                    project={suggestedProject}
                    onAccept={handleAcceptProjectSuggestion}
                    onDismiss={clearProjectSuggestion}
                    accentColor={theme.accent}
                    surfaceColor={theme.surface}
                    textPrimaryColor={theme.textPrimary}
                    textSecondaryColor={theme.textSecondary}
                    borderColor={theme.border}
                />
            )}


            {/* Loaded history separator */}
            {loadedHistoryChat && historyMessages.length > 0 && (
                <View
                    style={[
                        detailStyles.historySeparator,
                        { borderColor: theme.border },
                    ]}
                >
                    <Text
                        style={[
                            detailStyles.historySeparatorText,
                            { color: theme.textSecondary },
                        ]}
                    >
                        — Session from{' '}
                        {formatSessionDate(loadedHistoryChat.updated_at)} —
                    </Text>
                </View>
            )}

            <Animated.View style={animatedKeyboardStyle}>
                {showEmptyGreeting ? (
                    <>
                        <TouchableWithoutFeedback
                            onPress={Keyboard.dismiss}
                            accessible={false}
                        >
                            <View
                                style={{
                                    flex: 1,
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                }}
                            >
                                <PersistentChatEmptyState
                                    onChipPress={handleChipPress}
                                    accentColor={theme.accent}
                                    textPrimaryColor={theme.textPrimary}
                                    textSecondaryColor={theme.textSecondary}
                                    surfaceColor={theme.surface}
                                    showChips={false}
                                />
                            </View>
                        </TouchableWithoutFeedback>
                        {showEmptyChips && chips.length > 0 && (
                            <View style={detailStyles.chipsRow}>
                                {chips.map(chip => (
                                    <TouchableOpacity
                                        key={chip.label}
                                        style={[
                                            detailStyles.chipBtn,
                                            {
                                                backgroundColor: theme.surface,
                                                borderColor:
                                                    theme.accent + '40',
                                            },
                                        ]}
                                        onPress={() =>
                                            handleChipPress(chip.text)
                                        }
                                        activeOpacity={0.7}
                                    >
                                        <Text
                                            style={[
                                                detailStyles.chipBtnText,
                                                { color: theme.textPrimary },
                                            ]}
                                        >
                                            {chip.label}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        )}
                        {pendingMessage ? (
                            <View pointerEvents="none" style={{ opacity: 0.4 }}>
                                {renderInputToolbarBase({})}
                            </View>
                        ) : (
                            renderInputToolbarBase({})
                        )}
                    </>
                ) : (
                    <GiftedChat
                        messages={
                            messagesLoading
                                ? []
                                : [...giftedMessages, ...historyGiftedMessages]
                        }
                        onSend={handleSend}
                        user={currentUser}
                        renderMessage={renderMessage}
                        renderBubble={renderBubble}
                        renderMessageText={renderMessageText}
                        renderInputToolbar={renderInputToolbar}
                        isTyping={false}
                        renderFooter={renderFooter}
                        inverted={true}
                        minInputToolbarHeight={insets.bottom + 112}
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
                        keyExtractor={(message: IMessage) =>
                            String(message._id)
                        }
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
                )}
            </Animated.View>

            {/* Blocking project suggestion banner for new sessions (above input) */}
            {suggestedProjectForSession && (
                <ProjectSuggestionBanner
                    project={suggestedProjectForSession}
                    onAccept={handleAcceptSessionProjectSuggestion}
                    onDismiss={clearProjectSuggestionForSession}
                    accentColor={theme.accent}
                    surfaceColor={theme.surface}
                    textPrimaryColor={theme.textPrimary}
                    textSecondaryColor={theme.textSecondary}
                    borderColor={theme.border}
                    showNoButton={true}
                />
            )}

            {/* Cover the safe-area gap (behind input toolbar) with the input's background color */}
            {insets.bottom > 0 && (
                <View
                    pointerEvents="none"
                    style={{
                        position: 'absolute',
                        bottom: 0,
                        left: 0,
                        right: 0,
                        height: insets.bottom,
                        backgroundColor: `${theme.accent}1F`,
                    }}
                />
            )}

            <ImageViewing
                images={previewImages}
                imageIndex={currentImageIndex}
                visible={imageViewerVisible}
                onRequestClose={() => setImageViewerVisible(false)}
                keyExtractor={(imageSrc: any, index: number) =>
                    `${imageSrc.uri}${index}`
                }
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

            <SessionHistorySheet
                visible={historySheetVisible}
                onClose={() => setHistorySheetVisible(false)}
                onSelectSession={handleSelectSession}
                accentColor={theme.accent}
                textPrimaryColor={theme.textPrimary}
                textSecondaryColor={theme.textSecondary}
                surfaceColor={theme.surface}
                backgroundColor={theme.background}
                borderColor={theme.border}
            />

            <ToastContainer />
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
        width: 44,
        alignItems: 'flex-start',
        justifyContent: 'center',
    },
    center: {
        flex: 1,
        alignItems: 'center',
    },
    title: {
        fontSize: 16,
        fontWeight: '600',
        lineHeight: 20,
    },
    subtitle: {
        fontSize: 11,
        lineHeight: 14,
    },
    headerRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
        minWidth: 44,
        justifyContent: 'flex-end',
    },
    historySeparator: {
        alignItems: 'center',
        paddingVertical: 8,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    historySeparatorText: { fontSize: 12 },
    chipsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        paddingHorizontal: 12,
        paddingTop: 8,
        paddingBottom: 4,
        justifyContent: 'center',
    },
    chipBtn: {
        paddingHorizontal: 14,
        paddingVertical: 9,
        borderRadius: 20,
        borderWidth: 1,
    },
    chipBtnText: { fontSize: 14, fontWeight: '500' },
});
