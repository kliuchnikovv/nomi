import {
    ActionSheetIOS,
    ImageStyle,
    Linking,
    Pressable,
    Text,
    TextStyle,
    View,
    ViewStyle,
} from 'react-native';
import Markdown from 'react-native-markdown-display';
import React, { useCallback } from 'react';
import { Action, Props, Role } from './models'
import { styles } from './styles.tsx';
import InAppBrowser from 'react-native-inappbrowser-reborn';
import Clipboard from '@react-native-clipboard/clipboard';

export default function MessageScreen(props: Props) {
    const onLongPressMsg = (text: string) => {
        const options = [
            'Copy',
            'Reply', // TODO:
            'Cancel',
        ]

        ActionSheetIOS.showActionSheetWithOptions(
            {
                options: options,
                cancelButtonIndex: options.length-1,
                userInterfaceStyle: 'dark',
            },
            idx => idx === 0 && Clipboard.setString(text || ''),
        );
    };

    const containerStylesByType: Record<Role, (ViewStyle | TextStyle | ImageStyle)[]> = {
        user: [styles.bubble, styles.bubbleUser],
        assistant: [styles.assistantContainer],
        daemon: [styles.daemonContainer]
    };

    const isDaemon = props.message.role === 'daemon';

    return (
        <View style={containerStylesByType[props.message.role]}>
            {props.header && (
                <Text style={styles.daemonHeader}>{props.header}</Text>
            )}
            <Pressable
                onLongPress={() => onLongPressMsg(props.message.text)}
                delayLongPress={250}
                style={({ pressed }) => [
                    isDaemon && [styles.bubble, styles.bubbleDaemon],
                    pressed && { opacity: 0.75 },
                ]}
            >
                <Markdown
                    style={styles.markdownStyles as any}
                    onLinkPress={url => {
                        Linking.openURL(url).catch(() => { });
                        return false;
                    }}
                >
                    {props.message.text || ''}
                </Markdown>
            </Pressable>
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
                                key={`${action.command}-${action.url || ''}`}
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
    const openWeb= useCallback(async (url: string) =>  {
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