import React, { useEffect, useMemo, useRef, useState } from 'react';

import {
    FlatList,
    KeyboardAvoidingView,
    Platform,
    Text,
    View,
    Animated,
} from 'react-native';

import { styles } from './styles';

import ChatInput from './input/component';
import { useChat } from './context';

export default function ChatScreen() {
    const { messages, sendMessage, assistantWorking } = useChat();

    const flatRef = useRef<FlatList>(null);
    const blink = useRef(new Animated.Value(1)).current;
    const typingTimer = useRef<NodeJS.Timeout | null>(null);
    const [shownChars, setShownChars] = useState(0);
    const lastAssistantIndex = useMemo(() => {
        if (!messages || messages.length === 0) return -1;
        const idx = messages.length - 1;
        return messages[idx]?.role === 'assistant' ? idx : -1;
    }, [messages]);

    useEffect(() => {
        Animated.loop(
            Animated.sequence([
                Animated.timing(blink, { toValue: 0, duration: 450, useNativeDriver: true }),
                Animated.timing(blink, { toValue: 1, duration: 450, useNativeDriver: true }),
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

    return (
        <KeyboardAvoidingView
            style={styles.root}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={48}
        >
            <FlatList
                ref={flatRef}
                style={styles.list}
                contentContainerStyle={styles.listContent}
                keyboardShouldPersistTaps="handled"
                data={messages ?? []}
                keyExtractor={m => m.id}
                renderItem={({ item, index }) => {
                    const isLastAssistant =
                        index === (messages?.length ?? 0) - 1 &&
                        item.role === 'assistant';
                    const showTyping = isLastAssistant;
                    const displayedText = showTyping
                        ? item.text.slice(0, Math.min(shownChars, item.text.length))
                        : item.text;
                    return (
                    <View
                        style={[
                            styles.bubble,
                            item.role === 'user'
                                ? styles.bubbleUser
                                : styles.bubbleAssistant,
                        ]}
                    >
                        <Text style={styles.bubbleText}>{displayedText}</Text>
                        {showTyping && assistantWorking ? (
                            <Animated.Text style={[styles.bubbleText, { opacity: blink }]}>_</Animated.Text>
                        ) : null}
                    </View>
                )}}
            />
            <View style={styles.inputBar}>
                <ChatInput onSend={sendMessage} />
            </View>
        </KeyboardAvoidingView>
    );
}
