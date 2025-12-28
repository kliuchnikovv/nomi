import React, { useCallback, useMemo } from 'react';
import { Linking, View, Text, ActionSheetIOS, Pressable } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { Bubble, Message, MessageText } from 'react-native-gifted-chat';
import Markdown from 'react-native-markdown-display';
import { createChatTheme, createMarkdownStyles } from '../theme';
import InAppBrowser from 'react-native-inappbrowser-reborn';
import { ThemeColors } from '../../../themes/types';
import ChatInput from '../input/component';
import { ErrorBanner } from '../components/ErrorBanner';
import { ToolCallsSection, SingleToolCall, ReasoningBlock, MemberResponseBlock } from '../message/ToolCalls';
import { MessageAttachments } from '../components/MessageAttachments';
import { MessageActions } from '../message/MessageActions';
import { Attachment, MessageAction } from '../../main/models';
import { ContentPart } from '../message/models';
import { styles as messageStyles } from '../message/styles';
import { useChat } from '../context';

function SystemMessageBubble({ text, theme }: { text: string, theme: any }) {
    const [expanded, setExpanded] = React.useState(false);

    // Create markdown styles with theme
    const markdownStyles = useMemo(() => createMarkdownStyles(createChatTheme(theme)), [theme]);

    return (
        <View style={{ marginBottom: 8, paddingHorizontal: 16 }}>
            <View style={messageStyles.toolCallsContainer}>
                <Pressable
                    onPress={() => setExpanded(!expanded)}
                    style={({ pressed }) => [
                        messageStyles.toolCallsHeader,
                        pressed && { opacity: 0.7 },
                    ]}
                >
                    <Text style={messageStyles.toolCallsHeaderText}>
                        System Activity
                    </Text>
                    <Text style={messageStyles.toolCallsExpandIcon}>
                        {expanded ? '▼' : '▶'}
                    </Text>
                </Pressable>
                {expanded && (
                    <View style={messageStyles.toolCallsList}>
                        <View style={messageStyles.toolCallItem}>
                            <Markdown style={markdownStyles as any}>
                                {text}
                            </Markdown>
                        </View>
                    </View>
                )}
            </View>
        </View>
    );
}

// Render content parts (text + inline tool calls + reasoning + member responses)
function ContentPartsRenderer({ parts, onLongPress, markdownStyles }: { parts: ContentPart[], onLongPress: (text: string) => void, markdownStyles: any }) {
    const { showToolCalls, showReasoning, showMemberResponses } = useChat();

    // Filter parts based on display settings
    const filteredParts = useMemo(() => {
        return parts.filter(part => {
            if (part.type === 'tool_call' && !showToolCalls) return false;
            if (part.type === 'reasoning' && !showReasoning) return false;
            if ((part as any).type === 'member_response' && !showMemberResponses) return false;
            return true;
        });
    }, [parts, showToolCalls, showReasoning, showMemberResponses]);

    // Merge consecutive text parts for proper markdown rendering
    const mergedParts = useMemo(() => {
        const result: ContentPart[] = [];
        for (const part of filteredParts) {
            if (part.type === 'text') {
                const last = result[result.length - 1];
                if (last && last.type === 'text') {
                    // Merge with previous text part
                    last.text = (last.text || '') + (part.text || '');
                } else {
                    // Create new text part (copy to avoid mutation)
                    result.push({ type: 'text', text: part.text || '' });
                }
            } else {
                result.push(part);
            }
        }
        return result;
    }, [filteredParts]);

    return (
        <>
            {mergedParts.map((part, index) => {
                if (part.type === 'text') {
                    return (
                        <Pressable
                            key={`text-${index}`}
                            onLongPress={() => onLongPress(part.text)}
                            delayLongPress={250}
                            style={({ pressed }) => [pressed && { opacity: 0.75 }]}
                        >
                            <Markdown style={markdownStyles as any}>
                                {part.text || ''}
                            </Markdown>
                        </Pressable>
                    );
                } else if (part.type === 'tool_call') {
                    return <SingleToolCall key={`tool-${index}`} toolCall={part.tool_call} />;
                } else if (part.type === 'reasoning') {
                    return <ReasoningBlock key={`reasoning-${index}`} reasoning={part.reasoning} />;
                } else if ((part as any).type === 'member_response') {
                    // Team member response
                    const memberPart = part as any;
                    return <MemberResponseBlock key={`member-${index}`} agentName={memberPart.agent_name} text={memberPart.text} />;
                }
                return null;
            })}
        </>
    );
}

interface GiftedChatRenderersParams {
    assistantContainerMaxWidth: string;
    assistantWorking: boolean;
    bottomInset: number;
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
    assistantWorking,
    bottomInset,
    styles,
    theme,
    onSend,
    error,
    onRetry,
    onDismissError,
    onAttachmentPress,
    attachmentPosition,
    onMessageAction,
}: GiftedChatRenderersParams) {
    const chatTheme = useMemo(() => createChatTheme(theme), [theme]);
    const markdownStyles = useMemo(() => createMarkdownStyles(chatTheme), [chatTheme]);
    const { showToolCalls } = useChat();

    const handleLongPress = useCallback((context: any, message: any) => {
        console.log('handleLongPress called', { context, message });
        const messageText = message?.text || '';
        if (!messageText) {
            console.log('No message text');
            return;
        }

        ActionSheetIOS.showActionSheetWithOptions(
            {
                options: ['Copy', 'Cancel'],
                cancelButtonIndex: 1,
                userInterfaceStyle: 'dark',
            },
            (buttonIndex) => {
                if (buttonIndex === 0) {
                    Clipboard.setString(messageText);
                    console.log('Copied to clipboard:', messageText.substring(0, 50));
                }
            }
        );
    }, []);

    // Direct long press handler for text content
    const handleTextLongPress = useCallback((text: string) => {
        console.log('handleTextLongPress called', text?.substring(0, 50));
        if (!text) return;

        ActionSheetIOS.showActionSheetWithOptions(
            {
                options: ['Copy', 'Cancel'],
                cancelButtonIndex: 1,
                userInterfaceStyle: 'dark',
            },
            (buttonIndex) => {
                if (buttonIndex === 0) {
                    Clipboard.setString(text);
                    console.log('Copied to clipboard');
                }
            }
        );
    }, []);

    const renderBubble = useCallback((props: any) => {
        const { currentMessage } = props;
        const attachments = currentMessage?.attachments;
        const hasAttachments = attachments && attachments.length > 0;
        const showAttachmentsInside = hasAttachments && attachmentPosition === 'inside';

        return (
            <View>
                {/*
                   If using custom logic inside Bubble, we can inject children or modify content.
                   GiftedChat Bubble is a bit rigid.
                   We can use renderCustomView to render something INSIDE the bubble
                   but usually at the bottom of the bubble (below text).

                   However, user often wants attachments ABOVE text.
                   GiftedChat renderMessageImage (which is usually top of bubble)
                   isn't easily swappable without reimplementing the whole Bubble.

                   But wait, renderBubble wraps everything.
                   If we want to render attachments INSIDE the bubble but TOP of text,
                   we might need to check if we can abuse `renderMessageImage`.

                   Actually, let's use `renderCustomView`? It renders BELOW text by default.

                   To render ABOVE text inside bubble, we can wrapper the MessageText.
                */}
                <Bubble
                    {...props}
                    onLongPress={handleLongPress}
                    wrapperStyle={{
                        right: {
                            backgroundColor: chatTheme.userBubble,
                            borderRadius: 18,
                            borderBottomRightRadius: 6,
                            padding: 4,
                            marginBottom: 0,
                        },
                        left: {
                            backgroundColor: chatTheme.background,
                            borderRadius: 18,
                            padding: 4,
                            paddingLeft: 10,
                            marginBottom: 0,
                        },
                    }}
                    textStyle={{
                        right: {
                            color: chatTheme.textPrimary,
                            fontSize: 16,
                            lineHeight: 20,
                        },
                        left: {
                            color: chatTheme.textPrimary,
                            fontSize: 16,
                            lineHeight: 20,
                        },
                    }}
                    timeTextStyle={{
                        right: { color: 'rgba(255, 255, 255, 0.6)' },
                        left: { color: 'rgba(255, 255, 255, 0.6)' },
                    }}
                    containerToNextStyle={{
                        right: { marginBottom: 4 },
                        left: { marginBottom: 4 },
                    }}
                    containerToPreviousStyle={{
                        right: { marginBottom: 4 },
                        left: { marginBottom: 4 },
                    }}
                // We can hijack renderMessageText to include attachments above text if we want "inside"
                />
            </View>
        );
    }, [chatTheme, handleLongPress, attachmentPosition]);

    const renderInputToolbar = useCallback((props: any) => {
        return (
            <View>
                <ErrorBanner
                    error={error}
                    onRetry={onRetry}
                    onDismiss={onDismissError}
                    theme={chatTheme}
                />
                <ChatInput onSend={onSend} />
            </View>
        );
    }, [onSend, error, onRetry, onDismissError, chatTheme]);

    const renderMessage = useCallback((props: any) => {
        const { currentMessage } = props;
        const attachments = currentMessage?.attachments;
        const hasAttachments = attachments && attachments.length > 0;
        const showAttachmentsOutside = hasAttachments && attachmentPosition === 'outside';

        // Check for system message (Tool Call style)
        if (currentMessage.user._id === 'system') {
            return <SystemMessageBubble text={currentMessage.text} theme={theme} />;
        }

        return (
            <View>
                {showAttachmentsOutside && (
                    <View style={{
                        marginLeft: currentMessage.user._id === 'assistant' ? 0 : 'auto',
                        marginRight: currentMessage.user._id === 'assistant' ? 'auto' : 0,
                        marginBottom: 4,
                        maxWidth: '80%', // Limit width
                        paddingHorizontal: 10
                    }}>
                        <MessageAttachments
                            attachments={attachments}
                            onAttachmentPress={onAttachmentPress}
                            theme={theme}
                        />
                    </View>
                )}
                <Message
                    {...props}
                    containerStyle={{
                        left: [{ maxWidth: assistantContainerMaxWidth }],
                    }}
                />
            </View>
        );
    }, [assistantContainerMaxWidth, attachmentPosition, theme, onAttachmentPress, markdownStyles]);



    const renderMessageText = useCallback((props: any) => {
        const isAssistant = props.currentMessage?.user?._id === 'assistant';
        const toolCalls = props.currentMessage?.tool_calls;

        const attachments = props.currentMessage?.attachments;
        const hasAttachments = attachments && attachments.length > 0;
        const showAttachmentsInside = hasAttachments && attachmentPosition === 'inside';

        // Helper to render attachments inside bubble
        const renderAttachments = () => (
            <View style={{ marginBottom: 8 }}>
                <MessageAttachments
                    attachments={attachments}
                    onAttachmentPress={onAttachmentPress}
                    theme={theme}
                />
            </View>
        );

        const userMessageText = props.currentMessage?.text || '';

        // Handle Content Parts (inline rendering for reasoning, tool calls, member responses)
        if (props.currentMessage?.content_parts && props.currentMessage.content_parts.length > 0) {
            return (
                <View>
                    {showAttachmentsInside && renderAttachments()}
                    <ContentPartsRenderer
                        parts={props.currentMessage.content_parts}
                        onLongPress={handleTextLongPress}
                        markdownStyles={markdownStyles}
                    />
                    <MessageActions
                        actions={props.currentMessage?.actions}
                        theme={theme}
                        onActionPress={(action) => {
                            if (action.url) {
                                Linking.openURL(action.url).catch(err => console.error("Failed to open URL:", err));
                            } else if (action.prompt) {
                                onSend(action.prompt);
                            } else {
                                console.log('Action pressed:', action);
                                if (onMessageAction && props.currentMessage?._id) {
                                    onMessageAction(String(props.currentMessage._id), action);
                                }
                            }
                        }}
                    />
                </View>
            );
        }

        // Fallback to standard text + grouped tool calls (legacy)
        if (!isAssistant) {
            return (
                <View>
                    {showAttachmentsInside && renderAttachments()}
                    <Pressable
                        onLongPress={() => handleTextLongPress(userMessageText)}
                        delayLongPress={300}
                    >
                        <MessageText {...props} />
                    </Pressable>
                </View>
            );
        }

        const messageText = props.currentMessage?.text || '';

        return (
            <View>
                {showAttachmentsInside && renderAttachments()}
                <Pressable
                    onLongPress={() => handleTextLongPress(messageText)}
                    delayLongPress={300}
                >
                    <Markdown
                        style={markdownStyles as any}
                        onLinkPress={(url) => {
                            const openLink = async () => {
                                try {
                                    if (await InAppBrowser.isAvailable()) {
                                        await InAppBrowser.open(url, {
                                            showTitle: true,
                                            dismissButtonStyle: 'close',
                                            modalEnabled: true,
                                            enableDefaultShare: false,
                                        });
                                    } else {
                                        await Linking.openURL(url);
                                    }
                                } catch {
                                    await Linking.openURL(url).catch(() => { });
                                }
                            };
                            openLink();
                            return false;
                        }}
                    >
                        {messageText}
                    </Markdown>
                </Pressable>
                {showToolCalls && toolCalls && toolCalls.length > 0 && (
                    <ToolCallsSection toolCalls={toolCalls} />
                )}
                <MessageActions
                    actions={props.currentMessage?.actions}
                    theme={theme}
                    onActionPress={(action) => {
                        if (action.url) {
                            Linking.openURL(action.url).catch(err => console.error("Failed to open URL:", err));
                        } else if (action.prompt) {
                            onSend(action.prompt);
                        } else {
                            console.log('Action pressed:', action);
                            if (onMessageAction && props.currentMessage?._id) {
                                onMessageAction(String(props.currentMessage._id), action);
                            }
                        }
                    }}
                />
            </View >
        );
    }, [markdownStyles, attachmentPosition, theme, onAttachmentPress, handleTextLongPress, onSend, onMessageAction, showToolCalls]);

    const renderFooter = useCallback(() => {
        if (!assistantWorking) {
            return null;
        }

        return (
            <View style={styles.footerContainer}>
                <View style={styles.typingDot} />
                <Text style={styles.footerText}>Assistant is thinking…</Text>
            </View>
        );
    }, [assistantWorking, styles]);

    return {
        renderBubble,
        renderFooter,
        renderInputToolbar,
        renderMessage,
        renderMessageText,
        onLongPressMessage: handleLongPress,
    };
}
