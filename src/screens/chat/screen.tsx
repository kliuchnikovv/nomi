import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
    FlatList,
    KeyboardAvoidingView,
    Platform,
    View,
    Animated,
} from 'react-native';
import { styles } from './styles';
import ChatInput from './input/component';
import { useChat } from './context';
import MessageScreen from './message/screen';
import { Action } from './message/models.tsx';

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

    const handleActionPress = useCallback(async (action: Action) => {
        await executeMessageAction(action, action.message_id);
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
                // contentInset={{ bottom: inputBarHeight }}
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
                    const showTyping = isLastAssistant && assistantWorking;

                    // Create a display message with typing effect if needed
                    const displayMessage = showTyping
                        ? {
                            ...item,
                            text: item.text.slice(0, Math.min(shownChars, item.text.length)),
                        }
                        : item;

                    const isDaemon = item.metadata?.originalRole === 'daemon';
                    const daemonHeaderText = isDaemon
                        ? (item.metadata?.header || item.metadata?.title || 'Daemon')
                        : null;

                    return (
                        <MessageScreen
                            message={displayMessage}
                            actions={isPluginThread ? item.actions || null : null}
                            header={daemonHeaderText}
                            importance={isPluginThread ? item.importance : undefined}
                            onActionPress={handleActionPress}
                        />
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
