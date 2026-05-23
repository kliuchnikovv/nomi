import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActionSheetIOS,
    ActivityIndicator,
    Alert,
    Image,
    ImageStyle,
    Linking,
    Pressable,
    Text,
    TextStyle,
    View,
    ViewStyle,
} from 'react-native';
import Markdown from 'react-native-markdown-display';
import Clipboard from '@react-native-clipboard/clipboard';
import InAppBrowser from 'react-native-inappbrowser-reborn';

import { Attachment, Message, MessageAction } from '../../screens/main/models';
import { ContentPartsRenderer } from '../../screens/chat/message/ContentPartsRenderer';
import { ToolCallsSection } from '../../screens/chat/message/ToolCalls';
import {
    createMarkdownStyles,
    createStyles,
} from '../../screens/chat/message/dynamicStyles';
import { useTheme } from '../../context/ThemeContext';
import { getAgentIcon } from '../../utils/agentAvatars';
import { authStore } from '../../apiClient';
import { getApiUrl } from '../../config';

type Role = 'user' | 'assistant' | 'daemon' | 'system';

export type MessageBubbleProps = {
    message: Message;
    actions?: MessageAction[] | null;
    header?: string | null;
    importance?: string | null;
    onActionPress?: (action: MessageAction) => Promise<void>;
    onLongPress?: (text: string) => void;

    // Feature toggles — default to full main-chat behaviour
    showToolCalls?: boolean;
    showReasoning?: boolean;
    showAttachments?: boolean;
    showActions?: boolean;
    showLocations?: boolean;
    showModelLabel?: boolean;
    showAgentLabel?: boolean;

    // Visual
    maxWidthPct?: number; // 0..100; default 80
    isStreaming?: boolean; // appends streaming cursor to fallback text path
};

function AttachmentImage({ attachment }: { attachment: Attachment }) {
    const [token, setToken] = useState<string | null>(authStore.getToken());
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setToken(authStore.getToken());
    }, []);

    if (!token) {
        return (
            <View
                style={{ width: 100, height: 100, backgroundColor: '#333' }}
            />
        );
    }

    const source = attachment.uri
        ? { uri: attachment.uri }
        : {
              uri: `${getApiUrl()}/attachments/${attachment.id}`,
              headers: { Authorization: `Bearer ${token}` },
          };

    return (
        <View
            style={{
                width: 150,
                height: 150,
                borderRadius: 8,
                overflow: 'hidden',
                backgroundColor: '#000',
            }}
        >
            <Image
                source={source}
                style={{ width: '100%', height: '100%' }}
                resizeMode="cover"
                onLoadEnd={() => setLoading(false)}
            />
            {loading && (
                <View
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <ActivityIndicator color="#fff" />
                </View>
            )}
        </View>
    );
}

function ActionButton({
    action,
    onActionPress,
}: {
    action: MessageAction;
    onActionPress?: (action: MessageAction) => Promise<void>;
}) {
    const { theme, palette } = useTheme();
    const styles = useMemo(
        () => createStyles(theme, palette),
        [theme, palette],
    );

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
            Linking.openURL(url).catch(() => {});
        }
    }, []);

    const handlePress = useCallback(async () => {
        if (action?.command === 'open_maps' && action.url) {
            await Linking.openURL(action.url).catch(err =>
                console.warn('Failed to open Maps:', err),
            );
            return;
        }
        if (action?.command === 'open_web' && action.url) {
            await openWeb(action.url);
        }
        if (onActionPress) {
            await onActionPress(action);
        }
    }, [action, onActionPress, openWeb]);

    return (
        <Pressable
            onPress={handlePress}
            style={({ pressed }) => [
                styles.actionButton,
                { width: '48%' },
                pressed && { opacity: 0.8 },
            ]}
        >
            <Text style={styles.actionLabel}>
                {action.label || action.command}
            </Text>
            {action.why && <Text style={styles.actionWhy}>{action.why}</Text>}
        </Pressable>
    );
}

function defaultLongPress(text: string) {
    const options = ['Copy', 'Reply', 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions(
        {
            options,
            cancelButtonIndex: options.length - 1,
            userInterfaceStyle: 'dark',
        },
        idx => idx === 0 && Clipboard.setString(text || ''),
    );
}

function asRole(role: string): Role {
    if (
        role === 'user' ||
        role === 'assistant' ||
        role === 'daemon' ||
        role === 'system'
    ) {
        return role;
    }
    return 'assistant';
}

export const MessageBubble = React.memo(function MessageBubble(
    props: MessageBubbleProps,
) {
    const {
        message,
        actions,
        header,
        importance,
        onActionPress,
        onLongPress,
        showToolCalls = true,
        showReasoning = true,
        showAttachments = true,
        showActions = true,
        showLocations = true,
        showModelLabel = true,
        showAgentLabel = true,
        maxWidthPct = 80,
        isStreaming = false,
    } = props;

    const { theme, palette } = useTheme();
    const styles = useMemo(
        () => createStyles(theme, palette),
        [theme, palette],
    );
    const markdownStyles = useMemo(() => createMarkdownStyles(theme), [theme]);

    const role = asRole(message.role);
    if (role === 'system') return null;

    const handleLongPress = onLongPress ?? defaultLongPress;

    const containerStylesByType: Record<
        Role,
        (ViewStyle | TextStyle | ImageStyle)[]
    > = {
        user: [styles.bubble, styles.userBubble],
        assistant: [styles.bubble, styles.assistantBubble],
        daemon: [styles.bubble, styles.bubbleDaemon],
        system: [styles.bubble, styles.systemBubble],
    };

    const bubbleStyle: (ViewStyle | TextStyle | ImageStyle)[] = [
        ...containerStylesByType[role],
        { maxWidth: `${maxWidthPct}%` as `${number}%` },
    ];

    const hasContentParts =
        message.content_parts && message.content_parts.length > 0;

    const locationItems = showLocations
        ? message.context_items?.filter(
              (ci: any) => ci?.sourceType === 'location',
          ) ?? []
        : [];

    return (
        <View style={bubbleStyle}>
            {showAgentLabel && message.agent_id && (
                <View style={styles.agentLabel}>
                    {getAgentIcon(message.agent_id, theme.textSecondary)}
                    <Text style={styles.agentLabelText}>
                        {message.agent_id}
                    </Text>
                </View>
            )}
            {header && <Text style={styles.daemonHeader}>{header}</Text>}

            {hasContentParts ? (
                <ContentPartsRenderer
                    parts={message.content_parts! as any}
                    onLongPress={handleLongPress}
                    showToolCalls={showToolCalls}
                    showReasoning={showReasoning}
                />
            ) : (
                <>
                    <Pressable
                        onLongPress={() => handleLongPress(message.text)}
                        delayLongPress={250}
                        style={({ pressed }) => [pressed && { opacity: 0.75 }]}
                    >
                        <Markdown
                            style={markdownStyles as any}
                            onLinkPress={url => {
                                Linking.openURL(url).catch(() => {});
                                return false;
                            }}
                        >
                            {(() => {
                                const rawText = message.text || '';
                                let display = rawText;
                                try {
                                    const parsed = JSON.parse(rawText);
                                    if (
                                        parsed &&
                                        typeof parsed === 'object' &&
                                        'msg' in parsed &&
                                        typeof parsed.msg === 'string'
                                    ) {
                                        display = parsed.msg;
                                    }
                                } catch {
                                    /* not JSON */
                                }
                                return isStreaming ? display + ' ▍' : display;
                            })()}
                        </Markdown>
                    </Pressable>
                    {showToolCalls &&
                        message.tool_calls &&
                        message.tool_calls.length > 0 && (
                            <ToolCallsSection toolCalls={message.tool_calls} />
                        )}
                </>
            )}

            {showAttachments &&
                message.attachments &&
                message.attachments.length > 0 && (
                    <View
                        style={{
                            marginTop: 8,
                            flexDirection: 'row',
                            flexWrap: 'wrap',
                            gap: 8,
                        }}
                    >
                        {message.attachments.map(att => (
                            <View key={att.id}>
                                {att.file_type &&
                                (att.file_type.startsWith('image/') ||
                                    att.file_type === 'image') ? (
                                    <AttachmentImage attachment={att} />
                                ) : (
                                    <View
                                        style={{
                                            flexDirection: 'row',
                                            alignItems: 'center',
                                            backgroundColor: 'rgba(0,0,0,0.1)',
                                            padding: 8,
                                            borderRadius: 8,
                                        }}
                                    >
                                        <Text>{att.file_name}</Text>
                                    </View>
                                )}
                            </View>
                        ))}
                    </View>
                )}

            {locationItems.length > 0 && (
                <View style={styles.locationContainer}>
                    {locationItems.map((ci: any) => (
                        <Pressable
                            key={ci.id}
                            style={styles.locationPill}
                            onPress={() => {
                                const lat = ci.metadata?.lat;
                                const lon = ci.metadata?.lon;
                                if (lat != null && lon != null) {
                                    Linking.openURL(
                                        `maps://?ll=${lat},${lon}&q=${encodeURIComponent(
                                            ci.title,
                                        )}`,
                                    ).catch(() =>
                                        Linking.openURL(
                                            `https://maps.google.com/?q=${lat},${lon}`,
                                        ),
                                    );
                                }
                            }}
                            onLongPress={() => {
                                const address =
                                    ci.metadata?.address ?? ci.title;
                                Alert.alert(ci.title, address);
                            }}
                        >
                            <Text style={{ fontSize: 18 }}>📍</Text>
                            <View style={{ flex: 1 }}>
                                <Text
                                    style={[
                                        styles.locationTitle,
                                        { color: theme.textPrimary },
                                    ]}
                                    numberOfLines={2}
                                >
                                    {ci.title}
                                </Text>
                                {ci.metadata?.lat != null && (
                                    <Text
                                        style={[
                                            styles.locationCoords,
                                            { color: theme.textSecondary },
                                        ]}
                                    >
                                        {Number(ci.metadata.lat).toFixed(4)},{' '}
                                        {Number(ci.metadata.lon).toFixed(4)}
                                    </Text>
                                )}
                            </View>
                        </Pressable>
                    ))}
                </View>
            )}

            {showModelLabel && message.model && (
                <Text style={styles.modelText}>Model: {message.model}</Text>
            )}

            {importance && (
                <View style={styles.importanceBadge}>
                    <Text style={styles.importanceText}>{importance}</Text>
                </View>
            )}

            {showActions && actions && actions.length > 0 && (
                <View style={{ marginTop: 6 }}>
                    <View
                        style={{
                            flexDirection: 'row',
                            flexWrap: 'wrap',
                            gap: 8,
                        }}
                    >
                        {actions.map((action, i) => (
                            <ActionButton
                                key={`${action.command}-${action.url || ''}-${
                                    action.label || ''
                                }-${action.prompt || ''}-${i}`}
                                action={action}
                                onActionPress={onActionPress}
                            />
                        ))}
                    </View>
                </View>
            )}
        </View>
    );
});

export default MessageBubble;
