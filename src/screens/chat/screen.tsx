import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Platform, KeyboardAvoidingView, Keyboard, Text, TouchableOpacity } from 'react-native';
import { GiftedChat, IMessage } from 'react-native-gifted-chat';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useWindowDimensions } from 'react-native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { useSharedValue, withTiming, runOnJS } from 'react-native-reanimated';
import ImageViewing from 'react-native-image-viewing';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Eye, EyeClosed } from 'iconoir-react-native';

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
import { Skeleton } from '../../components/Skeleton';
import { Attachment } from '../../main/models';

function MessageListSkeleton() {
    return (
        <View style={{ flex: 1, padding: 16, justifyContent: 'flex-end' }}>
            <View style={{ alignSelf: 'flex-end', alignItems: 'flex-end', marginBottom: 16, width: '70%' }}>
                <Skeleton width="100%" height={60} borderRadius={16} style={{ borderBottomRightRadius: 4 }} />
            </View>
            <View style={{ alignSelf: 'flex-start', alignItems: 'flex-start', marginBottom: 16, width: '70%' }}>
                <Skeleton width="100%" height={80} borderRadius={16} style={{ borderBottomLeftRadius: 4 }} />
            </View>
            <View style={{ alignSelf: 'flex-end', alignItems: 'flex-end', marginBottom: 16, width: '50%' }}>
                <Skeleton width="100%" height={40} borderRadius={16} style={{ borderBottomRightRadius: 4 }} />
            </View>
        </View>
    );
}

export default function ChatScreen({ onSettingsPress }: { onSettingsPress?: () => void }) {
    const {
        messages,
        messagesLoading,
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
    const { chats, chatsLoading, activeChatID, activeChat, setActiveChatID, getChats, createNewChat, renameChat, deleteChat } = useMain();

    const [sidebarVisible, setSidebarVisible] = useState(false);

    // Attachment Logic
    const [imageViewerVisible, setImageViewerVisible] = useState(false);
    const [currentImageIndex, setCurrentImageIndex] = useState(0);
    const [previewImages, setPreviewImages] = useState<any[]>([]);
    const [attachmentPosition, setAttachmentPosition] = useState<'inside' | 'outside'>('outside');

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

    // Attachment Handlers
    const handleAttachmentPress = useCallback(async (attachment: Attachment) => {
        if (attachment.file_type?.startsWith('image/')) {
            const images = [{ uri: attachment.uri || attachment.content }];
            // Ensure data URI if base64
            if (images[0].uri && !images[0].uri.startsWith('http') && !images[0].uri.startsWith('data:')) {
                 images[0].uri = `data:${attachment.file_type || 'image/png'};base64,${attachment.content}`;
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
                       const fileUri = FileSystem.documentDirectory + (attachment.file_name || 'download');
                       const downloadRes = await FileSystem.downloadAsync(attachment.uri, fileUri);
                       await Sharing.shareAsync(downloadRes.uri);
                   }
                } else if (attachment.content) {
                    // Base64 content
                    const fileUri = FileSystem.documentDirectory + (attachment.file_name || 'file');
                    await FileSystem.writeAsStringAsync(fileUri, attachment.content, { encoding: FileSystem.EncodingType.Base64 });
                    await Sharing.shareAsync(fileUri);
                }
            } catch (e) {
                console.error('Error sharing file:', e);
            }
        }
    }, []);

    const toggleAttachmentPosition = useCallback(() => {
        setAttachmentPosition(prev => prev === 'inside' ? 'outside' : 'inside');
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
                        chatsLoading={chatsLoading}
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

                    {/* Position Toggle Button - Visible */}
                    <View style={{position: 'absolute', top: 50, right: 10, zIndex: 100}}>
                         <TouchableOpacity
                            onPress={toggleAttachmentPosition}
                            style={{
                                padding: 8,
                                backgroundColor: chatTheme.background,
                                borderRadius: 20,
                                shadowColor: "#000",
                                shadowOffset: { width: 0, height: 2 },
                                shadowOpacity: 0.25,
                                shadowRadius: 3.84,
                                elevation: 5,
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: 6,
                                borderWidth: 1,
                                borderColor: chatTheme.border
                            }}>
                             {attachmentPosition === 'inside' ? (
                                <EyeClosed width={16} height={16} color={chatTheme.textPrimary} />
                             ) : (
                                <Eye width={16} height={16} color={chatTheme.textPrimary} />
                             )}
                             <Text style={{color: chatTheme.textPrimary, fontSize: 10, fontWeight: 'bold'}}>
                                {attachmentPosition === 'inside' ? 'Inside Bubble' : 'Outside Bubble'}
                             </Text>
                         </TouchableOpacity>
                    </View>

                    <KeyboardAvoidingView
                        style={{ flex: 1 }}
                        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                    >
                        {messagesLoading ? (
                            <MessageListSkeleton />
                        ) : (
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
                        )}
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
                    chatsLoading={chatsLoading}
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

            <ImageViewing
                images={previewImages}
                imageIndex={currentImageIndex}
                visible={imageViewerVisible}
                onRequestClose={() => setImageViewerVisible(false)}
            />
        </View>
    );
}
