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
    ScrollView,
    StyleSheet,
    AppState,
    ActionSheetIOS,
    TouchableWithoutFeedback,
    Keyboard,
} from 'react-native';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
} from 'react-native-reanimated';
import {
    KeyboardAvoidingView,
    useReanimatedKeyboardAnimation,
} from 'react-native-keyboard-controller';
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
import { UpdatesChatExtras } from './UpdatesChatExtras';

const FADE_OPACITIES = [
    0.816, 0.734, 0.653, 0.579, 0.506, 0.441, 0.383, 0.326, 0.277, 0.228, 0.18,
    0.147, 0.114, 0.082, 0.057, 0.033, 0.02, 0.009, 0.002, 0,
] as const;
const FADE_STRIP_H = 3;

export function ChatDetailScreen() {
    const route = useRoute<RouteProp<ChatStackParamList, 'ChatDetail'>>();
    const chatId = route.params?.chatId ?? emptyChatID;
    const navigation = useNavigation();

    const inputAnimY = useSharedValue(0);
    const insets = useSafeAreaInsets();
    const { height: kbHeightAnim } = useReanimatedKeyboardAnimation();

    const bottomInset = insets.bottom;
    const fadeContainerStyle = useAnimatedStyle(() => ({
        bottom: Math.max(
            bottomInset + TAB_BAR_ICON_HEIGHT,
            -kbHeightAnim.value,
        ),
    }));

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
    const { activeChat, chats, getChats, isNewSession, setIsNewSession } =
        useMain();
    const [dropdownVisible, setDropdownVisible] = useState(false);

    const styles = useMemo(() => createStyles(theme), [theme]);
    const assistantContainerMaxWidth = `${ASSISTANT_BUBBLE_WIDTH_RATIO * 100}%`;

    const headerHeight = insets.top + 60; // insets.top + 8 padding + 44 pill + 8 padding
    const inputBarHeight = 112;

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

    const headerTitle = externalTitle || activeChat?.title || 'New Chat';
    const headerSubtitle = useMemo(() => {
        if (assistantWorking) return '';
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

    const showEmptyChips =
        isNewSession &&
        historyMessages.length === 0 &&
        giftedMessages.length === 0;
    const showEmptyGreeting = showEmptyChips;

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
        chips: showEmptyChips ? chips : undefined,
        onChipPress: handleChipPress,
    });

    const isUpdatesChat = activeChat?.chat_type === 'updates';
    const renderMessageWithExtras = useCallback(
        (props: any) => {
            const base = renderMessage(props);
            if (!isUpdatesChat) return base;
            const msg = messages.find(
                m => m.id === String(props.currentMessage?._id),
            );
            if (!msg) return base;
            return (
                <React.Fragment key={props.currentMessage?._id}>
                    {base}
                    <UpdatesChatExtras message={msg} chatId={chatId} />
                </React.Fragment>
            );
        },
        [renderMessage, isUpdatesChat, messages, chatId],
    );

    const floatingInputStyle = useAnimatedStyle(() => ({
        bottom: Math.max(
            TAB_BAR_ICON_HEIGHT,
            -kbHeightAnim.value - bottomInset,
        ),
    }));

    return (
        <View
            style={[
                styles.container,
                {
                    backgroundColor: theme.background,
                },
            ]}
        >
            {/* Dropdown backdrop */}
            {dropdownVisible && (
                <Pressable
                    style={[StyleSheet.absoluteFillObject, { zIndex: 10 }]}
                    onPress={() => setDropdownVisible(false)}
                />
            )}

            {/* Chat dropdown list */}
            {dropdownVisible && (
                <View
                    style={[
                        detailStyles.dropdown,
                        {
                            top: headerHeight,
                            backgroundColor: theme.surface,
                            zIndex: 11,
                        },
                    ]}
                >
                    <ScrollView
                        bounces={false}
                        showsVerticalScrollIndicator={false}
                        keyboardShouldPersistTaps="handled"
                    >
                        {chats
                            .filter(c => c.id !== emptyChatID)
                            .map(chat => (
                                <Pressable
                                    key={chat.id}
                                    style={({ pressed }) => [
                                        detailStyles.dropdownRow,
                                        {
                                            borderBottomColor: theme.border,
                                            opacity: pressed ? 0.7 : 1,
                                        },
                                        chat.id === activeChat?.id && {
                                            backgroundColor:
                                                theme.accent + '20',
                                        },
                                    ]}
                                    onPress={() => {
                                        setDropdownVisible(false);
                                        (navigation as any).replace(
                                            'ChatDetail',
                                            { chatId: chat.id },
                                        );
                                    }}
                                >
                                    <View
                                        style={[
                                            detailStyles.dropdownIcon,
                                            {
                                                backgroundColor:
                                                    theme.background,
                                            },
                                        ]}
                                    >
                                        {chat.icon &&
                                        /\p{Emoji}/u.test(chat.icon) &&
                                        !/^[0-9#*]$/.test(chat.icon) ? (
                                            <Text style={{ fontSize: 16 }}>
                                                {chat.icon}
                                            </Text>
                                        ) : (
                                            <Ionicons
                                                name="sparkles"
                                                size={15}
                                                color={theme.accent}
                                            />
                                        )}
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text
                                            style={[
                                                detailStyles.dropdownTitle,
                                                { color: theme.text },
                                            ]}
                                            numberOfLines={1}
                                        >
                                            {chat.title || 'New Chat'}
                                        </Text>
                                        <Text
                                            style={[
                                                detailStyles.dropdownDate,
                                                { color: theme.textSecondary },
                                            ]}
                                        >
                                            {formatSessionDate(chat.updated_at)}
                                        </Text>
                                    </View>
                                    {chat.id === activeChat?.id && (
                                        <Ionicons
                                            name="checkmark"
                                            size={16}
                                            color={theme.accent}
                                        />
                                    )}
                                </Pressable>
                            ))}
                        {chats.filter(c => c.id !== emptyChatID).length ===
                            0 && (
                            <Text
                                style={[
                                    detailStyles.dropdownEmpty,
                                    { color: theme.textSecondary },
                                ]}
                            >
                                No previous chats
                            </Text>
                        )}
                    </ScrollView>
                </View>
            )}

            {/* Header — absolute, frosted bg */}
            <View
                style={[
                    detailStyles.header,
                    {
                        paddingTop: insets.top + 8,
                        backgroundColor: theme.background + 'D0',
                        zIndex: 12,
                    },
                ]}
            >
                {/* Left: back button */}
                <Pressable
                    onPress={() => navigation.goBack()}
                    style={[
                        detailStyles.backBtn,
                        { backgroundColor: theme.surface },
                    ]}
                    hitSlop={8}
                >
                    <Ionicons
                        name="chevron-back"
                        size={24}
                        color={theme.text}
                    />
                </Pressable>

                {/* Center: title pill — tap to open dropdown */}
                <Pressable
                    style={({ pressed }) => [
                        detailStyles.center,
                        {
                            backgroundColor: theme.surface,
                            opacity: pressed ? 0.7 : 1,
                        },
                    ]}
                    onPress={() => setDropdownVisible(v => !v)}
                >
                    <View style={detailStyles.titleRow}>
                        <Text
                            style={[detailStyles.title, { color: theme.text }]}
                            numberOfLines={1}
                        >
                            {headerTitle}
                        </Text>
                        <Ionicons
                            name={
                                dropdownVisible ? 'chevron-up' : 'chevron-down'
                            }
                            size={14}
                            color={theme.textSecondary}
                            style={{ marginLeft: 4, marginTop: 1 }}
                        />
                    </View>
                    {activeChat?.updated_at ? (
                        <Text
                            style={[
                                detailStyles.subtitle,
                                { color: theme.textSecondary },
                            ]}
                            numberOfLines={1}
                        >
                            {formatSessionDate(activeChat.updated_at)}
                        </Text>
                    ) : null}
                </Pressable>

                {/* Right: new chat button */}
                <Pressable
                    style={[
                        detailStyles.pillBtn,
                        { backgroundColor: theme.surface },
                    ]}
                    hitSlop={8}
                    onPress={handleNewChat}
                >
                    <Ionicons
                        name="create-outline"
                        size={22}
                        color={theme.text}
                    />
                </Pressable>
            </View>

            {/* Soft fade from header into chat */}
            {FADE_OPACITIES.map((opacity, i) => (
                <View
                    key={i}
                    pointerEvents="none"
                    style={{
                        position: 'absolute',
                        top: headerHeight + i * FADE_STRIP_H,
                        left: 0,
                        right: 0,
                        height: FADE_STRIP_H,
                        backgroundColor: theme.background,
                        opacity,
                        zIndex: 9,
                    }}
                />
            ))}

            {/* Soft fade above input bar — animated with keyboard */}
            <Animated.View
                pointerEvents="none"
                style={[
                    {
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        zIndex: 7,
                    },
                    fadeContainerStyle,
                ]}
            >
                {FADE_OPACITIES.map((opacity, i) => (
                    <View
                        key={i}
                        pointerEvents="none"
                        style={{
                            position: 'absolute',
                            bottom: inputBarHeight - 4 + i * FADE_STRIP_H,
                            left: 0,
                            right: 0,
                            height: FADE_STRIP_H,
                            backgroundColor: theme.background,
                            opacity,
                        }}
                    />
                ))}
            </Animated.View>

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

            <View
                style={{
                    flex: 1,
                    backgroundColor: theme.background,
                }}
            >
                {showEmptyGreeting ? (
                    <KeyboardAvoidingView
                        style={{ flex: 1 }}
                        behavior="padding"
                        keyboardVerticalOffset={0}
                    >
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
                    </KeyboardAvoidingView>
                ) : (
                    <GiftedChat
                        keyboardAvoidingViewProps={{
                            behavior: 'padding',
                            keyboardVerticalOffset: 0,
                        }}
                        messages={
                            messagesLoading
                                ? []
                                : [...giftedMessages, ...historyGiftedMessages]
                        }
                        onSend={handleSend}
                        user={currentUser}
                        renderMessage={renderMessageWithExtras}
                        renderBubble={renderBubble}
                        renderMessageText={renderMessageText}
                        renderInputToolbar={() => null}
                        isTyping={false}
                        renderFooter={renderFooter}
                        inverted={true}
                        minInputToolbarHeight={0}
                        maxComposerHeight={100}
                        renderAvatar={null}
                        messagesContainerStyle={styles.messagesContainer}
                        placeholder="Type a message..."
                        scrollToBottom
                        scrollToBottomStyle={{
                            bottom:
                                inputBarHeight +
                                insets.bottom +
                                TAB_BAR_ICON_HEIGHT +
                                8,
                        }}
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
                                      contentContainerStyle: {
                                          paddingBottom: headerHeight,
                                          paddingTop:
                                              inputBarHeight +
                                              insets.bottom +
                                              TAB_BAR_ICON_HEIGHT,
                                      },
                                      maintainVisibleContentPosition: undefined,
                                      maxToRenderPerBatch: 10,
                                      windowSize: 10,
                                      initialNumToRender: 15,
                                      updateCellsBatchingPeriod: 50,
                                  }
                                : {
                                      contentContainerStyle: {
                                          paddingBottom: headerHeight,
                                          paddingTop:
                                              inputBarHeight +
                                              insets.bottom +
                                              TAB_BAR_ICON_HEIGHT,
                                      },
                                      maxToRenderPerBatch: 10,
                                      windowSize: 10,
                                      initialNumToRender: 15,
                                  }
                        }
                    />
                )}
            </View>

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

            {/* Floating input toolbar — absolute, follows keyboard */}
            <Animated.View
                pointerEvents={pendingMessage ? 'none' : 'auto'}
                style={[
                    {
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        paddingBottom: insets.bottom,
                        zIndex: 8,
                        opacity: pendingMessage ? 0.4 : 1,
                    },
                    floatingInputStyle,
                ]}
            >
                {renderInputToolbarBase({})}
            </Animated.View>

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
                        backgroundColor: theme.background + 'D0',
                        zIndex: 8,
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
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingBottom: 8,
        gap: 8,
    },
    dropdown: {
        position: 'absolute',
        left: 12,
        right: 12,
        borderRadius: 16,
        overflow: 'hidden',
        maxHeight: 320,
    },
    dropdownRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 10,
        gap: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    dropdownIcon: {
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    dropdownTitle: {
        fontSize: 15,
        fontWeight: '500',
    },
    dropdownDate: {
        fontSize: 12,
        marginTop: 2,
    },
    dropdownEmpty: {
        textAlign: 'center',
        padding: 24,
        fontSize: 14,
    },
    pillBtn: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    backBtn: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    center: {
        flex: 1,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 14,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    title: {
        fontSize: 15,
        fontWeight: '600',
        lineHeight: 18,
    },
    subtitle: {
        fontSize: 11,
        lineHeight: 14,
    },
    headerRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    historySeparator: {
        alignItems: 'center',
        paddingVertical: 8,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    historySeparatorText: { fontSize: 12 },
});
