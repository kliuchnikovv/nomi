import {
    ActionSheetIOS,
    ImageStyle,
    Linking,
    Pressable,
    Text,
    TextStyle,
    View,
    ViewStyle,
    Image,
    ActivityIndicator
} from 'react-native';
import { ToolCallsSection, SingleToolCall, ReasoningBlock, MemberResponseBlock } from './ToolCalls';
import Markdown from 'react-native-markdown-display';
import React, { useCallback, useState, useEffect, useMemo } from 'react';
import { Action, Props, Role, Attachment, ContentPart } from './models'
import { createStyles, createMarkdownStyles } from './dynamicStyles';
import { useTheme } from '../../../context/ThemeContext';
import InAppBrowser from 'react-native-inappbrowser-reborn';
import Clipboard from '@react-native-clipboard/clipboard';
import { authStore } from '../../../apiClient';
import { getApiUrl, API_URL } from '../../../config';
import { useChat } from '../context';
import { getAgentIcon } from '../../../utils/agentAvatars';

function AttachmentImage({ attachment }: { attachment: Attachment }) {
    const [token, setToken] = useState<string | null>(authStore.getToken());
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Ensure we have a token (or handle refresh if possible, but simplest is to get current)
        setToken(authStore.getToken());
    }, []);

    if (!token) return <View style={{ width: 100, height: 100, backgroundColor: '#333' }} />;

    const source = attachment.uri
        ? { uri: attachment.uri }
        : {
            uri: `${getApiUrl()}/attachments/${attachment.id}`,
            headers: { Authorization: `Bearer ${token}` }
        };

    return (
        <View style={{ width: 150, height: 150, borderRadius: 8, overflow: 'hidden', backgroundColor: '#000' }}>
            <Image
                source={source}
                style={{ width: '100%', height: '100%' }}
                resizeMode="cover"
                onLoadEnd={() => setLoading(false)}
            />
            {loading && (
                <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
                    <ActivityIndicator color="#fff" />
                </View>
            )}
        </View>
    );
}

import { ContentPartsRenderer } from './ContentPartsRenderer';
export default function MessageScreen(props: Props) {
    const { showToolCalls, showReasoning } = useChat();
    const { theme, palette } = useTheme();

    const styles = useMemo(() => createStyles(theme, palette), [theme, palette]);
    const markdownStyles = useMemo(() => createMarkdownStyles(theme), [theme]);

    // Debug logging
    console.log('[MessageScreen] Render:', {
        id: props.message.id,
        role: props.message.role,
        hasContentParts: props.message.content_parts && props.message.content_parts.length > 0,
        partsCount: props.message.content_parts?.length,
        showReasoning,
    });

    if (props.message.role === 'system') {
        return null;
    }
    const onLongPressMsg = (text: string) => {
        const options = [
            'Copy',
            'Reply', // TODO:
            'Cancel',
        ]

        ActionSheetIOS.showActionSheetWithOptions(
            {
                options: options,
                cancelButtonIndex: options.length - 1,
                userInterfaceStyle: 'dark',
            },
            idx => idx === 0 && Clipboard.setString(text || ''),
        );
    };

    const containerStylesByType: Record<Role, (ViewStyle | TextStyle | ImageStyle)[]> = {
        user: [styles.bubble, styles.userBubble],
        assistant: [styles.bubble, styles.assistantBubble],
        daemon: [styles.bubble, styles.bubbleDaemon],
        system: [styles.bubble, styles.systemBubble]
    };

    const isDaemon = props.message.role === 'daemon';

    // Use content_parts for inline rendering, fallback to text + grouped tool_calls
    const hasContentParts = props.message.content_parts && props.message.content_parts.length > 0;

    // Debug logging
    console.log('[MessageScreen] Render:', {
        id: props.message.id,
        role: props.message.role,
        hasContentParts,
        partsCount: props.message.content_parts?.length,
        showReasoning, // from context hook
    });

    if (props.message.role === 'assistant') {
        console.log('[MessageScreen] Rendering assistant message:', {
            id: props.message.id,
            hasContentParts,
            contentPartsLength: props.message.content_parts?.length || 0,
            contentPartsTypes: props.message.content_parts?.map(p => p.type) || [],
            textLength: props.message.text?.length || 0,
        });
    }

    return (
        <View style={containerStylesByType[props.message.role]}>
            {props.message.agent_id && (
                <View style={styles.agentLabel}>
                    <Text style={styles.agentLabelText}>
                        {getAgentIcon(props.message.agent_id)} {props.message.agent_id}
                    </Text>
                </View>
            )}
            {props.header && (
                <Text style={styles.daemonHeader}>{props.header}</Text>
            )}
            {hasContentParts ? (
                // New: Render content_parts inline
                <ContentPartsRenderer
                    parts={props.message.content_parts!}
                    onLongPress={onLongPressMsg}
                />
            ) : (
                // Fallback: Old rendering (text + grouped tool calls)
                <>
                    <Pressable
                        onLongPress={() => onLongPressMsg(props.message.text)}
                        delayLongPress={250}
                        style={({ pressed }) => [
                            pressed && { opacity: 0.75 },
                        ]}
                    >
                        <Markdown
                            style={markdownStyles as any}
                            onLinkPress={url => {
                                Linking.openURL(url).catch(() => { });
                                return false;
                            }}
                        >
                            {props.message.text || ''}
                        </Markdown>
                    </Pressable>
                    {showToolCalls && props.message.tool_calls && props.message.tool_calls.length > 0 && (
                        <ToolCallsSection toolCalls={props.message.tool_calls} />
                    )}
                </>
            )}
            {props.message.attachments && props.message.attachments.length > 0 && (
                <View style={{ marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {props.message.attachments.map(att => {
                        console.log('Attachment:', att);
                        return (
                            <View key={att.id}>
                                {(att.file_type && (att.file_type.startsWith('image/') || att.file_type === 'image')) ? (
                                    <AttachmentImage attachment={att} />
                                ) : (
                                    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.1)', padding: 8, borderRadius: 8 }}>
                                        <Text>{att.file_name}</Text>
                                    </View>
                                )}
                            </View>
                        );
                    })}
                </View>
            )}
            {props.message.model && (
                <Text style={styles.modelText}>Model: {props.message.model}</Text>
            )}
            {props.importance && (
                <View style={styles.importanceBadge}>
                    <Text style={styles.importanceText}>{props.importance}</Text>
                </View>
            )}
            {props.actions && props.actions.length > 0 && (
                <View style={{ marginTop: 6 }}>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                        {props.actions.map((action: Action) => (
                            <ActionScreen
                                key={`${action.command}-${action.url || ''}-${action.label || ''}-${action.prompt || ''}`}
                                action={action}
                                onActionPress={props.onActionPress}
                                messageID={props.message.id}
                            />
                        ))}
                    </View>
                </View>
            )}
        </View>
    );
}



export function ActionScreen({
    action,
    onActionPress,
    messageID,
}: {
    action: Action;
    onActionPress?: (action: Action) => Promise<void>;
    messageID: string;
}) {
    const { theme, palette } = useTheme();
    const styles = useMemo(() => createStyles(theme, palette), [theme, palette]);

    const openWeb = useCallback(async (url: string) => {
        try {
            const isAvailable = await InAppBrowser.isAvailable();
            if (isAvailable) {
                await InAppBrowser.open(url, {
                    showTitle: true,
                    dismissButtonStyle: 'close',
                    enableDefaultShare: false,
                });
            } else {
                await Linking.openURL(url);
            }
        } catch (err) {
            console.warn('Failed to open url', err);
            Linking.openURL(url).catch(() => { });
        }
    }, []);

    const handleActionPress = useCallback(async (action: Action) => {
        if (action?.command === 'open_web' && action.url) {
            await openWeb(action.url);
        }

        if (onActionPress) {
            action.message_id = messageID;
            await onActionPress(action);
        }
    }, [onActionPress, openWeb, messageID]);

    return (
        <Pressable
            onPress={() => handleActionPress(action)}
            style={({ pressed }) => [
                styles.actionButton,
                { width: '48%' },
                pressed && { opacity: 0.8 },
            ]}
        >
            <Text style={styles.actionLabel}>{action.label || action.command}</Text>
            {action.why && (
                <Text style={styles.actionWhy}>{action.why}</Text>
            )}
        </Pressable>
    );
}
