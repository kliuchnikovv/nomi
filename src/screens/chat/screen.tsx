import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';

import {
    FlatList,
    KeyboardAvoidingView,
    Platform,
    View,
    Animated,
    Linking,
    Pressable,
    ToastAndroid,
    Text,
} from 'react-native';
import InAppBrowser from 'react-native-inappbrowser-reborn';

import { styles } from './styles';

import Markdown from 'react-native-markdown-display';
import ChatInput from './input/component';
import { useChat } from './context';
import { ActionSheetIOS, Share } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';

export default function ChatScreen() {
    const { messages, sendMessage, assistantWorking, executeMessageAction, isPluginThread } = useChat();

    const flatRef = useRef<FlatList>(null);
    const blink = useRef(new Animated.Value(1)).current;
    const typingTimer = useRef<NodeJS.Timeout | null>(null);
    const [shownChars, setShownChars] = useState(0);
    const [inputBarHeight, setInputBarHeight] = useState(0);
    const lastAssistantIndex = useMemo(() => {
        if (!messages || messages.length === 0) return -1;
        const idx = messages.length - 1;
        return messages[idx]?.role === 'assistant' ? idx : -1;
    }, [messages]);

    useEffect(() => {
        Animated.loop(
            Animated.sequence([
                Animated.timing(blink, {
                    toValue: 0,
                    duration: 450,
                    useNativeDriver: true,
                }),
                Animated.timing(blink, {
                    toValue: 1,
                    duration: 450,
                    useNativeDriver: true,
                }),
            ]),
        ).start();
    }, [blink]);

    useEffect(() => {
        // Auto scroll to bottom on new message
        if (!flatRef.current) return;
        setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 0);
    }, [messages]);

    useEffect(() => {
        if (lastAssistantIndex === -1) return;
        const targetLen = messages[lastAssistantIndex]?.text?.length ?? 0;

        // Reset when new assistant message starts or when we finished previously
        if (!assistantWorking) {
            setShownChars(targetLen);
        } else if (shownChars > targetLen) {
            setShownChars(0);
        }

        if (typingTimer.current) {
            clearInterval(typingTimer.current);
            typingTimer.current = null;
        }

        const stepMs = 18;
        typingTimer.current = setInterval(() => {
            const latestLen = messages[lastAssistantIndex]?.text?.length ?? 0;
            setShownChars(prev => {
                if (!assistantWorking) return latestLen;
                if (prev >= latestLen) return prev;
                const step = latestLen - prev > 10 ? 2 : 1;
                return Math.min(prev + step, latestLen);
            });
        }, stepMs);

        return () => {
            if (typingTimer.current) {
                clearInterval(typingTimer.current);
                typingTimer.current = null;
            }
        };
    }, [messages, lastAssistantIndex, assistantWorking]);

    const copyMsg = (text: string) => {
        Clipboard.setString(text || '');
        if (Platform.OS === 'android') {
            ToastAndroid.show('Скопировано', ToastAndroid.SHORT);
        }
    };

    const onLongPressMsg = (text: string) => {
        if (Platform.OS === 'ios') {
            ActionSheetIOS.showActionSheetWithOptions(
                {
                    options: ['Копировать', 'Отмена'],
                    cancelButtonIndex: 1,
                    userInterfaceStyle: 'dark',
                },
                idx => idx === 0 && copyMsg(text),
            );
        } else {
            copyMsg(text);
        }
    };

    const handleActionPress = useCallback(async (action: any, messageId: string) => {
        if (action?.command === 'open_web' && action.url) {
            try {
                const isAvailable = await InAppBrowser.isAvailable();
                if (isAvailable) {
                    await InAppBrowser.open(action.url, {
                        showTitle: true,
                        dismissButtonStyle: 'close',
                        enableDefaultShare: false,
                    });
                } else {
                    await Linking.openURL(action.url);
                }
            } catch (err) {
                console.warn('Failed to open url', err);
                Linking.openURL(action.url).catch(() => {});
            }
        }
        await executeMessageAction(action, messageId);
    }, [executeMessageAction]);

    return (
        <KeyboardAvoidingView
            style={styles.root}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={48}
        >
            <FlatList
                ref={flatRef}
                style={styles.list}
                contentContainerStyle={[
                    styles.listContent,
                    { paddingBottom: inputBarHeight + 12 },
                ]}
                contentInset={{ bottom: inputBarHeight }}
                scrollIndicatorInsets={{ bottom: inputBarHeight }}
                keyboardShouldPersistTaps="handled"
                data={messages ?? []}
                keyExtractor={m => m.id}
                onContentSizeChange={() => {
                    // ensure scroll after layout/content changes
                    requestAnimationFrame(() =>
                        flatRef.current?.scrollToEnd({ animated: false }),
                    );
                }}
                renderItem={({ item, index }) => {
                    const isLastAssistant =
                        index === (messages?.length ?? 0) - 1 &&
                        item.role === 'assistant';
                    const showTyping = isLastAssistant;
                    const displayedText = showTyping
                        ? item.text.slice(
                              0,
                              Math.min(shownChars, item.text.length),
                          )
                        : item.text;
                    const isDaemon = item.metadata?.originalRole === 'daemon';
                    const daemonHeaderText = isDaemon
                        ? (item.metadata?.header || item.metadata?.title || 'Daemon')
                        : null;
                    return (
                        <View
                            style={
                                item.role === 'user'
                                    ? [styles.bubble, styles.bubbleUser]
                                    : [styles.assistantContainer, isDaemon && styles.daemonContainer]
                            }
                        >
                            {daemonHeaderText && (
                                <Text style={styles.daemonHeader}>{daemonHeaderText}</Text>
                            )}
                            <Pressable
                                onLongPress={() => onLongPressMsg(item.text)}
                                delayLongPress={250}
                                style={({ pressed }) => [
                                    item.role === 'user'
                                        ? [styles.bubble, styles.bubbleUser]
                                        : styles.assistantContainer,
                                    pressed && { opacity: 0.75 },
                                ]}
                            >
                                <Markdown
                                    style={styles.markdownStyles}
                                    onLinkPress={url => {
                                        Linking.openURL(url).catch(() => {});
                                        return false;
                                    }}
                                >
                                    {displayedText || ''}
                                </Markdown>
                            </Pressable>
                            {isPluginThread && item.importance && (
                                <View style={styles.importanceBadge}>
                                    <Text style={styles.importanceText}>{item.importance}</Text>
                                </View>
                            )}
                            {isPluginThread && item.actions && item.actions.length > 0 && (
                                <View style={{ marginTop: 6 }}>
                                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                                        {item.actions.map((action: any) => (
                                            <Pressable
                                                key={`${action.command}-${action.url || ''}-${action.prompt || ''}`}
                                                onPress={() => handleActionPress(action, item.id)}
                                                style={({ pressed }) => [
                                                    styles.actionButton,
                                                    { width: '48%' },
                                                    pressed && { opacity: 0.8 },
                                                ]}
                                            >
                                                <Text style={styles.actionLabel}>{action.label || action.command}</Text>
                                                {action.why ? (
                                                    <Text style={styles.actionWhy}>{action.why}</Text>
                                                ) : null}
                                            </Pressable>
                                        ))}
                                    </View>
                                </View>
                            )}
                        </View>
                    );
                }}
            />
            <View
                style={styles.inputBar}
                onLayout={e => setInputBarHeight(e.nativeEvent.layout.height)}
            >
                <ChatInput onSend={sendMessage} />
            </View>
        </KeyboardAvoidingView>
    );
}
