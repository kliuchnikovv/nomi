import React, { useCallback, useEffect, useMemo, useState, memo } from 'react';
import {
    View,
    Keyboard,
    Text,
    TouchableOpacity,
    RefreshControl,
} from 'react-native';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { getApiUrl, API_URL } from '../../config';
import { GiftedChat, IMessage } from 'react-native-gifted-chat';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useWindowDimensions } from 'react-native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Animated, {
    useSharedValue,
    withTiming,
    runOnJS,
    useAnimatedStyle,
} from 'react-native-reanimated';
import ImageViewing from 'react-native-image-viewing';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Message as GenieMessage } from '../main/models';

import { useChat } from './context';
import { useAuth } from '../auth/context';
import { emptyChatID, useMain } from '../main/context';
import { ASSISTANT_BUBBLE_WIDTH_RATIO, createChatTheme } from './theme';
import { createStyles } from './styles';
import { useGiftedMessages } from './hooks/useGiftedMessages';
import { useGiftedChatRenderers } from './hooks/useGiftedChatRenderers';
import { ChatHeader } from './components/ChatHeader';
import { ChatSidebar } from './leftSidebar/screen';
import RightSidebar from '../integrationsSidebar/screen';
import { useTheme } from '../../context/ThemeContext';
import { Skeleton } from '../../components/Skeleton';
import { Attachment, MessageAction } from '../main/models';
import { sidebarApi } from '../../apiClient';
import { AVAILABLE_TEAMS } from './teams';
import { DiceRollOverlay } from './components/DiceRollOverlay';
import { DashboardScreen } from '../dashboard/DashboardScreen';
import { useAskUser } from './AskUserContext';
import { AskUserDialog } from './components/AskUserDialog';

function MessageListSkeleton() {
    return (
        <View style={{ flex: 1, padding: 16, justifyContent: 'flex-end' }}>
            <View
                style={{
                    alignSelf: 'flex-end',
                    alignItems: 'flex-end',
                    marginBottom: 16,
                    width: '70%',
                }}
            >
                <Skeleton
                    width="100%"
                    height={60}
                    borderRadius={16}
                    style={{ borderBottomRightRadius: 4 }}
                />
            </View>
            <View
                style={{
                    alignSelf: 'flex-start',
                    alignItems: 'flex-start',
                    marginBottom: 16,
                    width: '70%',
                }}
            >
                <Skeleton
                    width="100%"
                    height={80}
                    borderRadius={16}
                    style={{ borderBottomLeftRadius: 4 }}
                />
            </View>
            <View
                style={{
                    alignSelf: 'flex-end',
                    alignItems: 'flex-end',
                    marginBottom: 16,
                    width: '50%',
                }}
            >
                <Skeleton
                    width="100%"
                    height={40}
                    borderRadius={16}
                    style={{ borderBottomRightRadius: 4 }}
                />
            </View>
        </View>
    );
}

export default function ChatScreen({
    onSettingsPress,
}: {
    onSettingsPress?: () => void;
}) {
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
    const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
    const { width: windowWidth } = useWindowDimensions();
    const {
        chats,
        chatsLoading,
        activeChatID,
        activeChat,
        setActiveChatID,
        getChats,
        createNewChat,
        createNewChatWithMode,
        renameChat,
        deleteChat,
        rightSidebarVisible,
        setRightSidebarVisible,
    } = useMain();

    const [sidebarVisible, setSidebarVisible] = useState(false);

    // Attachment Logic
    const [imageViewerVisible, setImageViewerVisible] = useState(false);
    const [currentImageIndex, setCurrentImageIndex] = useState(0);
    const [previewImages, setPreviewImages] = useState<any[]>([]);
    const [attachmentPosition] = useState<'inside' | 'outside'>('inside');

    const styles = useMemo(() => createStyles(theme), [theme]);

    const assistantContainerMaxWidth = `${ASSISTANT_BUBBLE_WIDTH_RATIO * 100}%`;

    const screenBottomInset = insets.bottom;
    const animatedKeyboardStyle = useAnimatedStyle(() => ({
        flex: 1,
        paddingBottom: Math.max(-keyboardHeight.value, screenBottomInset),
    }));

    const giftedMessages = useGiftedMessages(messages, user?.id);

    // Track last message ID for optimization
    const lastMessageIdRef = React.useRef<string>('');
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

    // Dice Roll Logic
    const [diceOverlayVisible, setDiceOverlayVisible] = useState(false);
    const [diceExpression, setDiceExpression] = useState<string | null>(null);
    const [diceDC, setDiceDC] = useState<number | null>(null);
    // Track processed roll IDs to avoid showing the same roll twice
    const [processedRolls, setProcessedRolls] = useState<Set<string>>(
        new Set(),
    );

    useEffect(() => {
        // Scan for new tool calls that trigger dice rolls
        if (!messages || messages.length === 0) return;

        const lastMsg = messages[0];

        if (lastMsg.tool_calls && lastMsg.tool_calls.length > 0) {
            for (const tool of lastMsg.tool_calls) {
                if (
                    tool.tool?.name === 'roll_dice' &&
                    !processedRolls.has(lastMsg.id)
                ) {
                    // Try to parse result
                    let resultData: any = null;
                    if (tool.tool.result) {
                        try {
                            if (typeof tool.tool.result === 'string') {
                                resultData = JSON.parse(tool.tool.result);
                            } else {
                                resultData = tool.tool.result;
                            }
                        } catch (e) {
                            console.warn('Failed to parse dice result', e);
                        }
                    }

                    if (
                        resultData &&
                        resultData.__client_action__ === 'roll_dice'
                    ) {
                        console.log(
                            'Triggering client dice roll action',
                            resultData,
                        );
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
        console.log('[ChatScreen] Registered askUserDialog globally');
        return () => {
            delete (globalThis as any).__askUserDialog;
            console.log('[ChatScreen] Unregistered askUserDialog globally');
        };
    }, [showDialog]);

    const handleDiceComplete = useCallback(
        (resultMessage: string) => {
            setDiceOverlayVisible(false);
            setDiceExpression(null);
            setDiceDC(null);

            // Send the result back to the chat as a user message
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

    const currentUser = useMemo(
        () => ({
            _id: user?.id || 'user',
            name: 'You',
        }),
        [user?.id],
    );

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
        () =>
            [...(chats || [])].sort(
                (a, b) =>
                    getTimestamp(b.updated_at) - getTimestamp(a.updated_at),
            ),
        [chats, getTimestamp],
    );

    const handleDismissError = useCallback(() => {
        setError(null);
    }, [setError]);

    const handleRefreshHistory = useCallback(() => {
        if (!activeChatID || activeChatID === emptyChatID || isPluginThread)
            return;
        getMessages(activeChatID, { isRefresh: true });
    }, [activeChatID, getMessages, isPluginThread]);

    // Attachment Handlers
    const handleAttachmentPress = useCallback(
        async (attachment: Attachment) => {
            if (attachment.file_type?.startsWith('image/')) {
                const images: any[] = [];
                if (attachment.uri) {
                    images.push({ uri: attachment.uri });
                } else if (attachment.content) {
                    if (attachment.content.startsWith('data:image')) {
                        images.push({ uri: attachment.content });
                    } else {
                        images.push({
                            uri: `data:${
                                attachment.file_type || 'image/png'
                            };base64,${attachment.content}`,
                        });
                    }
                } else if (attachment.id) {
                    images.push({
                        uri: `${getApiUrl()}/attachments/${attachment.id}`,
                        headers: {
                            Authorization: `Bearer ${token}`,
                        },
                    });
                }

                setPreviewImages(images);
                setCurrentImageIndex(0);
                setImageViewerVisible(true);
            } else {
                try {
                    if (attachment.uri && attachment.uri.startsWith('http')) {
                        // Remote file
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
                        // Base64 content
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
        [],
    );

    const handleMessageAction = useCallback(
        async (messageId: string, action: MessageAction) => {
            try {
                await sidebarApi.executeMessageAction('any', messageId, action);
                console.log('Action executed:', action);
            } catch (e) {
                console.error('Failed to execute action', e);
            }
        },
        [],
    );

    // Optimization: Only re-render message if it actually changed
    const shouldUpdateMessage = useCallback(
        (currentProps: any, nextProps: any) => {
            const current = currentProps.currentMessage;
            const next = nextProps.currentMessage;

            // Fast comparison - check if same reference first
            if (current === next) return false;

            // Check key properties that affect rendering
            if (current._id !== next._id) return true;
            if (current.text !== next.text) return true;
            if (current.createdAt !== next.createdAt) return true;
            if ((current as any).content_parts !== (next as any).content_parts)
                return true;
            if ((current as any).tool_calls !== (next as any).tool_calls)
                return true;
            if ((current as any).actions !== (next as any).actions) return true;
            if ((current as any).attachments !== (next as any).attachments)
                return true;

            return false;
        },
        [],
    );

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

    const isWide = windowWidth >= 1024;
    const sidebarWidth = isWide ? 320 : Math.min(windowWidth * 0.9, 360);

    // Left Sidebar Animation Logic
    const sidebarTranslateX = useSharedValue(-sidebarWidth);
    // Right Sidebar Animation Logic
    const rightSidebarTranslateX = useSharedValue(sidebarWidth);

    useEffect(() => {
        if (isWide) {
            getChats();
        }
    }, [getChats, isWide]);

    // Update shared values if sidebarWidth changes
    useEffect(() => {
        if (!isWide && !sidebarVisible) {
            sidebarTranslateX.value = -sidebarWidth;
        }
        if (!isWide && !rightSidebarVisible) {
            rightSidebarTranslateX.value = sidebarWidth;
        }
    }, [sidebarWidth, isWide]);

    // Update right sidebar position when visibility changes
    useEffect(() => {
        if (rightSidebarVisible) {
            rightSidebarTranslateX.value = 0;
        } else {
            rightSidebarTranslateX.value = sidebarWidth;
        }
    }, [rightSidebarVisible, sidebarWidth]);

    // Close right sidebar when opening left
    const handleOpenMenu = useCallback(() => {
        if (rightSidebarVisible) {
            setRightSidebarVisible(false);
            rightSidebarTranslateX.value = withTiming(sidebarWidth);
        }
        Keyboard.dismiss();
        getChats({ preserveActiveChat: true });
        setSidebarVisible(true);
        sidebarTranslateX.value = withTiming(0);
    }, [
        getChats,
        sidebarTranslateX,
        rightSidebarVisible,
        rightSidebarTranslateX,
        sidebarWidth,
    ]);

    const handleCloseMenu = useCallback(() => {
        setSidebarVisible(false);
        sidebarTranslateX.value = withTiming(-sidebarWidth);
    }, [sidebarTranslateX, sidebarWidth]);

    // Close left sidebar when opening right
    const handleOpenInbox = useCallback(() => {
        if (sidebarVisible) {
            setSidebarVisible(false);
            sidebarTranslateX.value = withTiming(-sidebarWidth);
        }
        Keyboard.dismiss();
        setRightSidebarVisible(true);
        rightSidebarTranslateX.value = withTiming(0);
    }, [
        sidebarTranslateX,
        rightSidebarTranslateX,
        sidebarVisible,
        sidebarWidth,
    ]);

    const handleCloseInbox = useCallback(() => {
        setRightSidebarVisible(false);
        rightSidebarTranslateX.value = withTiming(sidebarWidth);
    }, [rightSidebarTranslateX, sidebarWidth]);

    const handleSelectChat = useCallback(
        (chatId: string) => {
            setActiveChatID(chatId);
            handleCloseMenu();
        },
        [setActiveChatID, handleCloseMenu],
    );

    const handleNewChat = useCallback(() => {
        clearPluginThread();
        createNewChat();
        handleCloseMenu();
    }, [createNewChat, handleCloseMenu, clearPluginThread]);

    const handleNewChatWithMode = useCallback(
        (mode: 'agent' | 'team', teamId: string | null) => {
            clearPluginThread();
            createNewChatWithMode(mode, teamId);
            handleCloseMenu();
        },
        [createNewChatWithMode, handleCloseMenu, clearPluginThread],
    );

    const dismissKeyboard = () => {
        Keyboard.dismiss();
    };

    // Gestures

    // Open gesture (edge swipe)
    const openGesture = Gesture.Pan()
        .maxPointers(1)
        .activeOffsetX([-10, 20]) // Activate if moved right > 20
        .failOffsetY([-20, 20]) // Fail if moved vertically
        .onStart(() => {
            runOnJS(dismissKeyboard)();
            runOnJS(getChats)({ preserveActiveChat: true });
        })
        .onUpdate(e => {
            const newTranslate = -sidebarWidth + e.translationX;
            sidebarTranslateX.value = Math.min(
                0,
                Math.max(-sidebarWidth, newTranslate),
            );
        })
        .onEnd(e => {
            if (
                sidebarTranslateX.value > -sidebarWidth * 0.6 ||
                e.velocityX > 500
            ) {
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
        .onUpdate(e => {
            if (e.translationX < 0) {
                // Dragging left
                sidebarTranslateX.value = Math.min(
                    0,
                    Math.max(-sidebarWidth, e.translationX),
                );
            }
        })
        .onEnd(e => {
            if (
                sidebarTranslateX.value < -sidebarWidth * 0.2 ||
                e.velocityX < -500
            ) {
                sidebarTranslateX.value = withTiming(-sidebarWidth);
                runOnJS(setSidebarVisible)(false);
            } else {
                sidebarTranslateX.value = withTiming(0);
                runOnJS(setSidebarVisible)(true);
            }
        });

    // Open right sidebar gesture (edge swipe from right)
    const openRightGesture = Gesture.Pan()
        .maxPointers(1)
        .activeOffsetX([-20, 10]) // Activate if moved left > 20
        .failOffsetY([-20, 20])
        .onStart(() => {
            runOnJS(dismissKeyboard)();
        })
        .onUpdate(e => {
            const newTranslate = sidebarWidth + e.translationX;
            rightSidebarTranslateX.value = Math.max(
                0,
                Math.min(sidebarWidth, newTranslate),
            );
        })
        .onEnd(e => {
            if (
                rightSidebarTranslateX.value < sidebarWidth * 0.6 ||
                e.velocityX < -500
            ) {
                rightSidebarTranslateX.value = withTiming(0);
                runOnJS(setRightSidebarVisible)(true);
            } else {
                rightSidebarTranslateX.value = withTiming(sidebarWidth);
                runOnJS(setRightSidebarVisible)(false);
            }
        });

    // Close right sidebar gesture
    const closeRightGesture = Gesture.Pan()
        .activeOffsetX([1000, 40]) // Activate when dragged right by 40px (more tolerance)
        .failOffsetY([-30, 30]) // Allow more vertical movement before failing (for scroll)
        .onUpdate(e => {
            if (e.translationX > 0) {
                rightSidebarTranslateX.value = Math.max(
                    0,
                    Math.min(sidebarWidth, e.translationX),
                );
            }
        })
        .onEnd(e => {
            if (
                rightSidebarTranslateX.value > sidebarWidth * 0.2 ||
                e.velocityX > 500
            ) {
                rightSidebarTranslateX.value = withTiming(sidebarWidth);
                runOnJS(setRightSidebarVisible)(false);
            } else {
                rightSidebarTranslateX.value = withTiming(0);
                runOnJS(setRightSidebarVisible)(true);
            }
        });

    const headerTitle =
        externalTitle ||
        activeChat?.title ||
        (messages.length === 0 ? 'Dashboard' : 'New Chat');
    const headerSubtitle = useMemo(() => {
        if (assistantWorking) {
            return 'typing...';
        }
        if (chatMode === 'team') {
            const team = AVAILABLE_TEAMS.find(t => t.id === selectedTeamId);
            return team?.name || '';
        }
        return '';
    }, [assistantWorking, chatMode, selectedTeamId]);

    return (
        <View style={styles.container}>
            <View style={styles.layout}>
                {isWide && (
                    <ChatSidebar
                        variant="inline"
                        width={sidebarWidth}
                        chats={sortedChats}
                        chatsLoading={chatsLoading}
                        activeChatID={activeChatID}
                        onSelectChat={handleSelectChat}
                        onNewChat={handleNewChat}
                        onNewChatWithMode={handleNewChatWithMode}
                        onSettingsPress={onSettingsPress}
                        onChatDelete={deleteChat}
                        onChatRename={renameChat}
                        isOpen={true}
                    />
                )}

                <View style={[styles.conversation, { zIndex: 0 }]}>
                    {/* Show Dashboard when no messages AND it's a new chat placeholder, Chat when there are messages or it's a persisted chat */}
                    <ChatHeader
                        title={headerTitle}
                        subtitle={headerSubtitle}
                        onMenuPress={handleOpenMenu}
                        onInboxPress={handleOpenInbox}
                        showMenu={!isWide}
                        showInbox={!isWide}
                        isInboxMode={isPluginThread}
                        icon={activeChat?.icon}
                        chatMode={chatMode}
                        teamId={selectedTeamId}
                        activeAgentsCount={activeAgentsCount}
                        isWorking={assistantWorking}
                    />
                    {messages.length === 0 &&
                    !messagesLoading &&
                    activeChatID === '00000000-0000-0000-0000-000000000000' ? (
                        <Animated.View style={animatedKeyboardStyle}>
                            <DashboardScreen />
                            {renderInputToolbar({})}
                        </Animated.View>
                    ) : (
                        <>
                            <Animated.View style={animatedKeyboardStyle}>
                                <GiftedChat
                                    messages={
                                        messagesLoading ? [] : giftedMessages
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
                                    minInputToolbarHeight={60}
                                    maxComposerHeight={100}
                                    renderAvatar={null}
                                    messagesContainerStyle={
                                        styles.messagesContainer
                                    }
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
                                        activeChatID &&
                                        activeChatID !== emptyChatID &&
                                        !isPluginThread
                                            ? {
                                                  refreshControl: (
                                                      <RefreshControl
                                                          refreshing={
                                                              refreshing
                                                          }
                                                          onRefresh={
                                                              handleRefreshHistory
                                                          }
                                                          tintColor={
                                                              theme.accent
                                                          }
                                                          colors={[
                                                              theme.accent,
                                                          ]}
                                                      />
                                                  ),
                                                  // Disable auto-scroll during streaming to prevent jumps
                                                  maintainVisibleContentPosition:
                                                      undefined,
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
                                    renderChatEmpty={() => {
                                        if (messagesLoading) {
                                            return (
                                                <View
                                                    style={{
                                                        flex: 1,
                                                        transform: [
                                                            { scaleY: -1 },
                                                        ],
                                                    }}
                                                >
                                                    <MessageListSkeleton />
                                                </View>
                                            );
                                        }
                                        return null;
                                    }}
                                />
                            </Animated.View>
                        </>
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

                    {/* Edge Swipe Detector - Left */}
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
                    {/* Edge Swipe Detector - Right */}
                    {!isWide && (
                        <GestureDetector gesture={openRightGesture}>
                            <View
                                style={{
                                    position: 'absolute',
                                    right: 0,
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
                    visible={true}
                    width={sidebarWidth}
                    chats={sortedChats}
                    chatsLoading={chatsLoading}
                    activeChatID={activeChatID}
                    onClose={handleCloseMenu}
                    onSelectChat={handleSelectChat}
                    onNewChat={handleNewChat}
                    onNewChatWithMode={handleNewChatWithMode}
                    onSettingsPress={onSettingsPress}
                    onChatDelete={deleteChat}
                    onChatRename={renameChat}
                    sidebarTranslateX={sidebarTranslateX}
                    dragGesture={closeGesture}
                    isOpen={sidebarVisible}
                />
            )}

            {!isWide && (
                <RightSidebar
                    variant="overlay"
                    width={sidebarWidth}
                    onClose={handleCloseInbox}
                    translateX={rightSidebarTranslateX}
                    dragGesture={closeRightGesture}
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
        </View>
    );
}
