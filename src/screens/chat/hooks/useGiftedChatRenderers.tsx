import React, { useCallback } from 'react';
import { Linking, Text, TouchableOpacity, View } from 'react-native';
import { Bubble, Composer, InputToolbar, Message, MessageText, Send } from 'react-native-gifted-chat';
import Markdown from 'react-native-markdown-display';
import { Microphone, Plus, Sparks } from 'iconoir-react-native';
import { markdownStyles, palette } from '../theme';
import { styles } from '../styles';

interface GiftedChatRenderersParams {
    assistantContainerMaxWidth: string;
    assistantWorking: boolean;
    bottomInset: number;
}

export function useGiftedChatRenderers({
    assistantContainerMaxWidth,
    assistantWorking,
    bottomInset,
}: GiftedChatRenderersParams) {
    const renderBubble = useCallback((props: any) => {
        return (
            <Bubble
                {...props}
                wrapperStyle={{
                    right: {
                        backgroundColor: palette.userBubble,
                        borderRadius: 18,
                        borderBottomRightRadius: 6,
                        padding: 4,
                        marginBottom: 0,
                    },
                    left: {
                        backgroundColor: palette.background,
                        borderRadius: 18,
                        padding: 4,
                        paddingLeft: 10,
                        marginBottom: 0,
                    },
                }}
                textStyle={{
                    right: {
                        color: palette.textPrimary,
                        fontSize: 16,
                        lineHeight: 22,
                    },
                    left: {
                        color: palette.textPrimary,
                        fontSize: 16,
                        lineHeight: 22,
                    },
                }}
                timeTextStyle={{
                    right: { color: palette.textSecondary },
                    left: { color: palette.textSecondary },
                }}
            />
        );
    }, []);

    const renderInputToolbar = useCallback((props: any) => {
        return (
            <InputToolbar
                {...props}
                containerStyle={styles.inputToolbarContainer}
                primaryStyle={[
                    styles.inputToolbarPrimary,
                    { paddingBottom: Math.max(bottomInset, 20) },
                ]}
                renderActions={() => (
                    <TouchableOpacity style={styles.actionButton}>
                        <Plus width={24} height={24} color="#E8EAED" strokeWidth={2} />
                    </TouchableOpacity>
                )}
            />
        );
    }, [bottomInset]);

    const renderComposer = useCallback((props: any) => {
        return (
            <Composer
                {...props}
                textInputStyle={styles.textInput}
                placeholder="Ask Gemini"
                placeholderTextColor="#9AA0A6"
            />
        );
    }, []);

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
                    Linking.openURL(url).catch(() => {});
                    return false;
                }}
            >
                {props.currentMessage?.text || ''}
            </Markdown>
        );
    }, []);

    const renderSend = useCallback((props: any) => {
        const hasText = props.text && props.text.trim().length > 0;

        if (hasText) {
            return (
                <Send
                    {...props}
                    containerStyle={styles.sendContainer}
                >
                    <View style={styles.sendButton}>
                        <View style={styles.arrowUp} />
                    </View>
                </Send>
            );
        }

        return (
            <View style={styles.rightIconsContainer}>
                <TouchableOpacity style={styles.iconButton}>
                    <Microphone width={24} height={24} color={palette.textPrimary} strokeWidth={2} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.iconButton}>
                    <Sparks width={24} height={24} color={palette.textPrimary} strokeWidth={2} />
                </TouchableOpacity>
            </View>
        );
    }, []);

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
    }, [assistantWorking]);

    return {
        renderBubble,
        renderComposer,
        renderFooter,
        renderInputToolbar,
        renderMessage,
        renderMessageText,
        renderSend,
    };
}
