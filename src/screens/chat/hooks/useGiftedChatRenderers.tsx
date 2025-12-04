import React, { useCallback, useMemo } from 'react';
import { Linking, View, Text, ActionSheetIOS } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { Bubble, Message, MessageText } from 'react-native-gifted-chat';
import Markdown from 'react-native-markdown-display';
import { createChatTheme, createMarkdownStyles } from '../theme';
import { ThemeColors } from '../../../themes/types';
import ChatInput from '../input/component';
import { ErrorBanner } from '../components/ErrorBanner';

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
}: GiftedChatRenderersParams) {
    const chatTheme = useMemo(() => createChatTheme(theme), [theme]);
    const markdownStyles = useMemo(() => createMarkdownStyles(chatTheme), [chatTheme]);

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

    const renderBubble = useCallback((props: any) => {
        return (
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
            />
        );
    }, [chatTheme, handleLongPress]);

    const renderInputToolbar = useCallback((props: any) => {
        // We ignore props from GiftedChat for the input and use our custom ChatInput
        // We might need to handle bottomInset here if ChatInput doesn't
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
        return (
            <Message
                {...props}
                containerStyle={{
                    left: [{ maxWidth: assistantContainerMaxWidth }],
                }}
            />
        );
    }, [assistantContainerMaxWidth]);

    const renderMessageText = useCallback((props: any) => {
        const isAssistant = props.currentMessage?.user?._id === 'assistant';
        if (!isAssistant) {
            return <MessageText {...props} />;
        }

        return (
            <Markdown
                style={markdownStyles as any}
                onLinkPress={url => {
                    Linking.openURL(url).catch(() => { });
                    return false;
                }}
            >
                {props.currentMessage?.text || ''}
            </Markdown>
        );
    }, [markdownStyles]);

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
