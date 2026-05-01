import React, { useCallback, useMemo, memo, useEffect, useRef } from 'react';
import {
    Linking,
    View,
    Text,
    ActionSheetIOS,
    Pressable,
    StyleSheet,
    Animated,
    useWindowDimensions,
} from 'react-native';
import ReAnimated, {
    useAnimatedStyle,
    useSharedValue,
    SharedValue,
} from 'react-native-reanimated';
import Clipboard from '@react-native-clipboard/clipboard';
import { Bubble, Message, MessageText } from 'react-native-gifted-chat';
import Markdown from 'react-native-markdown-display';
import { NavArrowDown } from 'iconoir-react-native';
import { createChatTheme } from '../theme';
import InAppBrowser from 'react-native-inappbrowser-reborn';
import { ThemeColors } from '../../../themes/types';
import { showToast } from '../../../utils/toast';
import { useTheme } from '../../../context/ThemeContext';
import ChatInput from '../input/component';
import { ErrorBanner } from '../components/ErrorBanner';
import { MessageAttachments } from '../components/MessageAttachments';
import { MessageContextItems } from '../components/MessageContextItems';
import { MessageActions } from '../message/MessageActions';
import { Attachment, MessageAction } from '../../main/models';
import { createStyles, createMarkdownStyles } from '../message/dynamicStyles';
import { createMarkdownRules } from '../message/markdownRules';
import { useChat } from '../context';
import { ContentPartsRenderer } from '../message/ContentPartsRenderer';
import { GenerationStatusBar } from '../components/GenerationStatusBar';
import { Dimensions } from 'react-native';

const openLink = (url: string) => {
    InAppBrowser.isAvailable().then(available => {
        if (available) {
            InAppBrowser.open(url, {
                showTitle: true,
                dismissButtonStyle: 'close',
                modalEnabled: true,
                enableDefaultShare: false,
            });
        } else {
            Linking.openURL(url);
        }
    });
};

const copyLink = (url: string) => {
    Clipboard.setString(url);
    showToast('Link copied');
};

// Stable markdown rules - don't recreate on every render
const stableMarkdownRules = createMarkdownRules({
    onCodeCopy: code => {
        Clipboard.setString(code);
        showToast('Code copied');
    },
    onLinkPress: openLink,
    onLinkCopy: copyLink,
});

// Simple text styles for fast rendering during streaming
const createSimpleTextStyles = (theme: any) =>
    StyleSheet.create({
        text: {
            fontSize: 16,
            lineHeight: 22,
            color: theme.colors?.text || '#fff',
            fontFamily: undefined, // System font - fastest
        },
    });

/**
 * Detects if text contains markdown syntax
 */
function hasMarkdown(text: string): boolean {
    return (
        text.includes('**') ||
        text.includes('*') ||
        text.includes('`') ||
        text.includes('[') ||
        text.includes('#') ||
        text.includes('- ') ||
        text.includes('1.') ||
        text.includes('>') ||
        text.includes('```')
    );
}

/**
 * Fast text component for streaming - renders plain Text instead of Markdown
 */
const FastText = memo(function FastText({
    text,
    style,
    onLongPress,
    isStreaming = false,
}: {
    text: string;
    style: any;
    onLongPress: (text: string) => void;
    isStreaming?: boolean;
}) {
    const cursorOpacity = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        if (isStreaming) {
            const animation = Animated.loop(
                Animated.sequence([
                    Animated.timing(cursorOpacity, {
                        toValue: 0,
                        duration: 400,
                        useNativeDriver: true,
                    }),
                    Animated.timing(cursorOpacity, {
                        toValue: 1,
                        duration: 400,
                        useNativeDriver: true,
                    }),
                ]),
            );
            animation.start();
            return () => animation.stop();
        }
    }, [isStreaming, cursorOpacity]);

    return (
        <Pressable onLongPress={() => onLongPress(text)} delayLongPress={300}>
            <Text style={style}>
                {text}
                {isStreaming && (
                    <Animated.Text style={{ opacity: cursorOpacity }}>
                        ▋
                    </Animated.Text>
                )}
            </Text>
        </Pressable>
    );
});

// Memoized system message bubble
const SystemMessageBubble = memo(function SystemMessageBubble({
    text,
    theme,
}: {
    text: string;
    theme: any;
}) {
    const [expanded, setExpanded] = React.useState(false);
    const { palette } = useTheme();
    const dynamicStyles = useMemo(
        () => createStyles(theme, palette),
        [theme, palette],
    );
    const markdownStyles = useMemo(() => createMarkdownStyles(theme), [theme]);

    return (
        <View style={{ marginBottom: 8, paddingHorizontal: 16 }}>
            <View style={dynamicStyles.toolCallsContainer}>
                <Pressable
                    onPress={() => setExpanded(!expanded)}
                    style={({ pressed }) => [
                        dynamicStyles.toolCallsHeader,
                        pressed && { opacity: 0.7 },
                    ]}
                >
                    <Text style={dynamicStyles.toolCallsHeaderText}>
                        System Activity
                    </Text>
                    <NavArrowDown
                        width={12}
                        height={12}
                        color={theme.textSecondary}
                        style={{
                            transform: [
                                { rotate: expanded ? '0deg' : '-90deg' },
                            ],
                        }}
                    />
                </Pressable>
                {expanded && (
                    <View style={dynamicStyles.toolCallsList}>
                        <View style={dynamicStyles.toolCallItem}>
                            <Markdown
                                style={markdownStyles as any}
                                rules={stableMarkdownRules}
                            >
                                {text}
                            </Markdown>
                        </View>
                    </View>
                )}
            </View>
        </View>
    );
});

interface GiftedChatRenderersParams {
    assistantContainerMaxWidth: string;
    assistantWorking: boolean;
    bottomInset: number;
    inputAnimY?: SharedValue<number>;
    styles: any;
    theme: ThemeColors;
    onSend: (text: string) => void;
    error: string | null;
    onRetry: () => void;
    onDismissError: () => void;
    onAttachmentPress: (attachment: Attachment) => void;
    attachmentPosition: 'inside' | 'outside';
    onMessageAction?: (messageId: string, action: MessageAction) => void;
}

export function useGiftedChatRenderers({
    assistantContainerMaxWidth,
    theme,
    onSend,
    error,
    onRetry,
    onDismissError,
    onAttachmentPress,
    attachmentPosition,
    onMessageAction,
    inputAnimY,
}: GiftedChatRenderersParams) {
    const { width: windowWidth } = useWindowDimensions();
    const chatTheme = useMemo(() => createChatTheme(theme), [theme]);
    const markdownStyles = useMemo(() => createMarkdownStyles(theme), [theme]);
    const simpleStyles = useMemo(() => createSimpleTextStyles(theme), [theme]);

    // Animated style for input toolbar slide-in.
    // Always use a concrete SharedValue so the Reanimated worklet can track it properly.
    const fallbackInputAnimY = useSharedValue(0);
    const resolvedInputAnimY = inputAnimY ?? fallbackInputAnimY;
    const inputToolbarAnimStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: resolvedInputAnimY.value }],
    }));
    const {
        showToolCalls,
        isRateLimited,
        availableModels,
        setSelectedModel,
        setIsRateLimited,
        setError,
        generationStatus,
    } = useChat();

    // Stable handlers - use refs to avoid dependency changes
    const onSendRef = React.useRef(onSend);
    const onAttachmentPressRef = React.useRef(onAttachmentPress);
    const onMessageActionRef = React.useRef(onMessageAction);

    // Update refs when values change
    React.useEffect(() => {
        onSendRef.current = onSend;
    }, [onSend]);

    React.useEffect(() => {
        onAttachmentPressRef.current = onAttachmentPress;
    }, [onAttachmentPress]);

    React.useEffect(() => {
        onMessageActionRef.current = onMessageAction;
    }, [onMessageAction]);

    // Stable long press handler
    const handleLongPress = useCallback((context: any, message: any) => {
        const messageText = message?.text || '';
        if (!messageText) return;

        ActionSheetIOS.showActionSheetWithOptions(
            {
                options: ['Copy', 'Cancel'],
                cancelButtonIndex: 1,
                userInterfaceStyle: 'dark',
            },
            buttonIndex => {
                if (buttonIndex === 0) {
                    Clipboard.setString(messageText);
                }
            },
        );
    }, []);

    // Stable text long press handler
    const handleTextLongPress = useCallback((text: string) => {
        if (!text) return;
        ActionSheetIOS.showActionSheetWithOptions(
            {
                options: ['Copy', 'Cancel'],
                cancelButtonIndex: 1,
                userInterfaceStyle: 'dark',
            },
            buttonIndex => {
                if (buttonIndex === 0) {
                    Clipboard.setString(text);
                }
            },
        );
    }, []);

    // Stable renderBubble - minimal dependencies
    const renderBubble = useCallback(
        (props: any) => {
            return (
                <View style={{ width: '100%' }}>
                    <Bubble
                        {...props}
                        onLongPress={handleLongPress}
                        wrapperStyle={{
                            right: {
                                backgroundColor: theme.accent,
                                borderRadius: 18,
                                borderBottomRightRadius: 4,
                                borderBottomLeftRadius: 18,
                                padding: 4,
                                marginBottom: 2,
                            },
                            left: {
                                backgroundColor: 'transparent',
                                marginBottom: 2,
                                marginTop: 8,
                                borderRadius: 8,
                                overflow: 'hidden',
                                minWidth: Dimensions.get('window').width * 0.9, // Force expansion to ~90% of screen
                                alignSelf: 'stretch',
                                // width: '100%',
                            },
                        }}
                        textStyle={{
                            right: {
                                color: '#ffffff',
                                fontSize: 16,
                                lineHeight: 20,
                            },
                            left: {
                                color: theme.text,
                                fontSize: 16,
                                lineHeight: 20,
                            },
                        }}
                        timeTextStyle={{
                            right: { color: 'rgba(255,255,255,0.6)' },
                            left: { color: theme.textSecondary },
                        }}
                        containerToNextStyle={{
                            right: { marginBottom: 4 },
                            left: { marginBottom: 4 },
                        }}
                        containerToPreviousStyle={{
                            right: { marginBottom: 4 },
                            left: { marginBottom: 4 },
                        }}
                        renderTime={() => null}
                    />
                </View>
            );
        },
        [theme, handleLongPress],
    );

    const handleChangeModel = useCallback(() => {
        const modelNames = availableModels.map(m => m.name);
        ActionSheetIOS.showActionSheetWithOptions(
            {
                title: 'Select model',
                options: [...modelNames, 'Cancel'],
                cancelButtonIndex: modelNames.length,
                userInterfaceStyle: 'dark',
            },
            buttonIndex => {
                if (buttonIndex < modelNames.length) {
                    setSelectedModel(availableModels[buttonIndex].id, true);
                    setIsRateLimited(false);
                    setError(null);
                }
            },
        );
    }, [availableModels, setSelectedModel, setIsRateLimited, setError]);

    // Stable input toolbar
    const renderInputToolbar = useCallback(
        (_props: any) => {
            return (
                <ReAnimated.View
                    style={[
                        { backgroundColor: theme.background },
                        inputToolbarAnimStyle,
                    ]}
                >
                    {!error && (
                        <GenerationStatusBar
                            status={generationStatus}
                            theme={theme}
                        />
                    )}
                    <ErrorBanner
                        error={error}
                        onRetry={onRetry}
                        onDismiss={onDismissError}
                        theme={chatTheme}
                        onChangeModel={
                            isRateLimited ? handleChangeModel : undefined
                        }
                    />
                    <ChatInput onSend={onSendRef.current} />
                </ReAnimated.View>
            );
        },
        [
            error,
            onRetry,
            onDismissError,
            chatTheme,
            isRateLimited,
            handleChangeModel,
            theme.background,
            generationStatus,
            theme,
            inputToolbarAnimStyle,
        ],
    );

    // Stable message renderer
    const renderMessage = useCallback(
        (props: any) => {
            const {
                currentMessage,
                combineWithPrevious,
                previousMessageToolCalls,
            } = props;

            const attachments = currentMessage?.attachments;
            const hasAttachments = attachments && attachments.length > 0;
            const showAttachmentsOutside =
                hasAttachments && attachmentPosition === 'outside';

            if (currentMessage.user._id === 'system') {
                if (!showToolCalls) return null;
                return (
                    <SystemMessageBubble
                        text={currentMessage.text}
                        theme={theme}
                    />
                );
            }

            // If this message should be combined with previous, pass the tool_calls for merging
            const extendedProps =
                combineWithPrevious && previousMessageToolCalls
                    ? {
                          ...props,
                          // Merge tool_calls from previous message into current
                          content_parts: [
                              ...(previousMessageToolCalls.content_parts || []),
                              ...(currentMessage.content_parts || []),
                          ],
                          tool_calls: [
                              ...(previousMessageToolCalls.tool_calls || []),
                              ...(currentMessage.tool_calls || []),
                          ],
                      }
                    : props;

            const isAssistantMsg = currentMessage.user._id === 'assistant';
            const assistantPadding = windowWidth * 0.04;
            return (
                <View
                    style={
                        isAssistantMsg
                            ? {
                                  width: '100%',
                                  paddingHorizontal: assistantPadding,
                              }
                            : { width: '100%' }
                    }
                >
                    {showAttachmentsOutside && (
                        <View
                            style={{
                                marginLeft: isAssistantMsg ? 0 : 'auto',
                                marginRight: isAssistantMsg ? 'auto' : 0,
                                marginBottom: 4,
                                maxWidth: windowWidth * 0.8,
                                paddingHorizontal: 10,
                            }}
                        >
                            <MessageAttachments
                                attachments={attachments}
                                onAttachmentPress={onAttachmentPressRef.current}
                                theme={theme}
                            />
                        </View>
                    )}
                    <Message
                        {...extendedProps}
                        containerStyle={
                            isAssistantMsg
                                ? { left: [{ width: '100%', marginLeft: 0 }] }
                                : undefined
                        }
                    />
                </View>
            );
        },
        [
            assistantContainerMaxWidth,
            attachmentPosition,
            theme,
            showToolCalls,
            windowWidth,
        ],
    );

    // Stable message text renderer
    const renderMessageText = useCallback(
        (props: any) => {
            const isAssistant = props.currentMessage?.user?._id === 'assistant';
            const contentParts = props.currentMessage?.content_parts;
            const attachments = props.currentMessage?.attachments;
            const contextItems = props.currentMessage?.context_items;
            const hasAttachments = attachments && attachments.length > 0;
            const hasContextItems = contextItems && contextItems.length > 0;
            const showAttachmentsInside =
                hasAttachments && attachmentPosition === 'inside';
            const messageText = props.currentMessage?.text || '';
            const messageActions = props.currentMessage?.actions;

            // Detect if this message is currently streaming (assistant text without ending punctuation)
            const isStreaming =
                isAssistant &&
                messageText.length > 0 &&
                !/[.!?。！？]\s*$/.test(messageText.trim()) &&
                (!contentParts ||
                    contentParts.every((p: any) => p.type === 'text'));

            // Render attachments helper component
            const AttachmentsComponent = showAttachmentsInside ? (
                <View style={{ marginBottom: 8 }}>
                    <MessageAttachments
                        attachments={attachments}
                        onAttachmentPress={onAttachmentPressRef.current}
                        theme={theme}
                    />
                </View>
            ) : null;

            // Render context items helper component
            const ContextItemsComponent = hasContextItems ? (
                <MessageContextItems
                    contextItems={contextItems}
                    theme={theme}
                />
            ) : null;

            // Render actions helper
            const ActionsComponent = messageActions ? (
                <MessageActions
                    actions={messageActions}
                    theme={theme}
                    onActionPress={action => {
                        if (action.url) {
                            Linking.openURL(action.url).catch(() =>
                                Linking.openURL(
                                    `https://maps.google.com/?q=${action.url}`,
                                ),
                            );
                        } else if (action.prompt) {
                            onSendRef.current?.(action.prompt);
                        } else if (
                            onMessageActionRef.current &&
                            props.currentMessage?._id
                        ) {
                            onMessageActionRef.current(
                                String(props.currentMessage._id),
                                action,
                            );
                        }
                    }}
                    onActionLongPress={action => {
                        const routeUrl = action.route_url ?? action.url;
                        if (routeUrl) {
                            Linking.openURL(routeUrl).catch(() => {});
                        }
                    }}
                />
            ) : null;

            // Fast path: plain text content parts (most common during streaming)
            if (contentParts && contentParts.length > 0) {
                const allPlainText = contentParts.every(
                    (p: any) => p.type === 'text',
                );

                if (allPlainText && isAssistant) {
                    // During streaming: use FastText (plain Text component) for maximum speed
                    // After streaming: use Markdown only if text contains markdown syntax
                    const shouldUseFastText =
                        isStreaming || !hasMarkdown(messageText);

                    if (shouldUseFastText) {
                        return (
                            <View style={{ width: '100%' }}>
                                {ContextItemsComponent}
                                {AttachmentsComponent}
                                <FastText
                                    text={messageText}
                                    style={simpleStyles.text}
                                    onLongPress={handleTextLongPress}
                                    isStreaming={isStreaming}
                                />
                                {ActionsComponent}
                            </View>
                        );
                    }

                    return (
                        <View style={{ width: '100%' }}>
                            {ContextItemsComponent}
                            {AttachmentsComponent}
                            <Pressable
                                onLongPress={() =>
                                    handleTextLongPress(messageText)
                                }
                                delayLongPress={300}
                            >
                                <Markdown
                                    style={markdownStyles as any}
                                    rules={stableMarkdownRules}
                                >
                                    {messageText}
                                </Markdown>
                            </Pressable>
                            {ActionsComponent}
                        </View>
                    );
                }

                // Mixed content - use ContentPartsRenderer
                return (
                    <View style={{ width: '100%' }}>
                        {ContextItemsComponent}
                        {AttachmentsComponent}
                        <ContentPartsRenderer
                            parts={contentParts}
                            onLongPress={handleTextLongPress}
                        />
                        {ActionsComponent}
                    </View>
                );
            }

            // User message
            if (!isAssistant) {
                return (
                    <View>
                        {ContextItemsComponent}
                        {AttachmentsComponent}
                        <Pressable
                            onLongPress={() => handleTextLongPress(messageText)}
                            delayLongPress={300}
                        >
                            <MessageText {...props} />
                        </Pressable>
                    </View>
                );
            }

            // Fallback Assistant with fast path for streaming
            if (isStreaming && !hasMarkdown(messageText)) {
                return (
                    <View style={{ width: '100%' }}>
                        {ContextItemsComponent}
                        {AttachmentsComponent}
                        <FastText
                            text={messageText}
                            style={simpleStyles.text}
                            onLongPress={handleTextLongPress}
                            isStreaming={isStreaming}
                        />
                        {ActionsComponent}
                    </View>
                );
            }

            return (
                <View style={{ width: '100%' }}>
                    {ContextItemsComponent}
                    {AttachmentsComponent}
                    <Pressable
                        onLongPress={() => handleTextLongPress(messageText)}
                        delayLongPress={300}
                    >
                        <Markdown
                            style={markdownStyles as any}
                            rules={stableMarkdownRules}
                        >
                            {messageText}
                        </Markdown>
                    </Pressable>
                    {showToolCalls &&
                        contentParts &&
                        contentParts.length > 0 && (
                            <ContentPartsRenderer
                                parts={contentParts}
                                onLongPress={handleTextLongPress}
                            />
                        )}
                    {ActionsComponent}
                </View>
            );
        },
        [
            markdownStyles,
            simpleStyles,
            attachmentPosition,
            theme,
            handleTextLongPress,
            showToolCalls,
        ],
    );

    const renderFooter = useCallback(() => null, []);

    return {
        renderBubble,
        renderFooter,
        renderInputToolbar,
        renderMessage,
        renderMessageText,
        onLongPressMessage: handleLongPress,
    };
}
