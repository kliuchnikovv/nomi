import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    Platform,
    Animated,
    FlatList,
} from 'react-native';
import Markdown from 'react-native-markdown-display';
import BottomSheet, {
    BottomSheetFlatList,
    BottomSheetTextInput,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../context/ThemeContext';
import { ChatMessage, usePlannerChat } from '../hooks/usePlannerChat';
import { Frame } from '../../main/models';
import { PlanItem } from '../types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
    isOpen: boolean;
    onClose: () => void;
    date: string;
    /** Current plan items — appended as invisible context to every user message */
    items?: PlanItem[];
    /** If true, automatically build and send the planning prompt when chat opens and socket is ready */
    autoSend?: boolean;
    /** Whether to enable web search for the auto-send message */
    autoSendWebSearch?: boolean;
    onAutoSendHandled?: () => void;
}

function currentDateTimeStr(): string {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getFullYear())} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function buildPlanningPrompt(items: PlanItem[], date: string): string {
    const namedItems = items.filter(i => !i.checked && i.text.trim() !== '');
    if (namedItems.length === 0) {
        return `Help me plan my day for ${date} (it's ${currentDateTimeStr()} now) — I have no tasks yet. Please suggest something.`;
    }
    // Use [Текущий план:] format — the planner agent recognises this block and immediately
    // starts scheduling tasks that are missing time chips, without asking first.
    const planLines = namedItems.map(i => {
        const chips = i.chips.map(c => `[${c.type}:${c.id} ${c.value}]`).join(' ');
        return `ID:${i.id} ${i.text}${chips ? ' ' + chips : ''}`;
    }).join('\n');
    return `Help me plan my day for ${date} (it's ${currentDateTimeStr()} now).\n\n[Текущий план:\n${planLines}]`;
}

function buildPlanContext(items: PlanItem[]): string {
    const lines = items.filter(i => !i.checked && i.text.trim() !== '').map(i => {
        const chips = i.chips.map(c => `[${c.type}:${c.id} ${c.value}]`).join(' ');
        return `ID:${i.id} ${i.text}${chips ? ' ' + chips : ''}`;
    });
    return `[Current plan:\n${lines.join('\n')}]`;
}

// ---------------------------------------------------------------------------
// ThinkingIndicator
// ---------------------------------------------------------------------------

function ThinkingIndicator() {
    const opacity = useRef(new Animated.Value(0.4)).current;

    useEffect(() => {
        const anim = Animated.loop(
            Animated.sequence([
                Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
                Animated.timing(opacity, { toValue: 0.4, duration: 600, useNativeDriver: true }),
            ]),
        );
        anim.start();
        return () => anim.stop();
    }, [opacity]);

    return (
        <Animated.View style={[styles.bubble, styles.assistantBubble, { opacity, alignSelf: 'flex-start' }]}>
            <Text style={styles.thinkingDots}>···</Text>
        </Animated.View>
    );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ChatBottomSheet({
    isOpen,
    onClose,
    date,
    items,
    autoSend,
    autoSendWebSearch,
    onAutoSendHandled,
}: Props) {
    const { theme } = useTheme();
    const { top: topInset } = useSafeAreaInsets();
    const bottomSheetRef = useRef<BottomSheet>(null);
    const snapPoints = ['45%', '85%'];

    const { messages, sendMessage, isConnected, isThinking, replyToAskUser } = usePlannerChat(date);
    const [inputText, setInputText] = useState('');
    const listRef = useRef<FlatList<ChatMessage | 'thinking'>>(null);

    // Sync open/close state → bottom sheet index
    useEffect(() => {
        if (isOpen) {
            bottomSheetRef.current?.snapToIndex(0);
        } else {
            bottomSheetRef.current?.close();
        }
    }, [isOpen]);

    // Auto-send planning prompt when chat opens and socket is ready
    const autoSentRef = useRef(false);
    // Keep items ref always current so auto-send uses the latest items even if they
    // finish loading after isConnected becomes true
    const itemsRef = useRef(items);
    useEffect(() => {
        itemsRef.current = items;
    });

    useEffect(() => {
        if (isOpen && isConnected && autoSend && !autoSentRef.current) {
            autoSentRef.current = true;
            const prompt = buildPlanningPrompt(itemsRef.current ?? [], date);
            sendMessage(prompt, { webSearch: autoSendWebSearch ?? false });
            onAutoSendHandled?.();
        }
    }, [isOpen, isConnected, autoSend, date, sendMessage, onAutoSendHandled, autoSendWebSearch]);

    // Reset auto-send flag when trigger resets
    useEffect(() => {
        if (!autoSend) {
            autoSentRef.current = false;
        }
    }, [autoSend]);

    const listData = useMemo(() =>
        [...messages, ...(isThinking ? ['thinking' as const] : [])],
        [messages, isThinking]
    );

    // Scroll to bottom whenever the list grows (new messages, initial load)
    const scrollToBottom = useCallback((animated: boolean) => {
        listRef.current?.scrollToEnd({ animated });
    }, []);

    const handleSheetChanges = useCallback(
        (index: number) => {
            if (index === -1) {
                onClose();
            } else {
                // Sheet just opened or expanded — scroll to latest message after animation settles
                setTimeout(() => scrollToBottom(false), 150);
            }
        },
        [onClose, scrollToBottom],
    );

    const handleSend = useCallback(() => {
        const text = inputText.trim();
        if (!text) return;
        // Append current plan state so agent always knows which chips exist (skip if all items are empty)
        const namedItems = items ? items.filter(i => !i.checked && i.text.trim() !== '') : [];
        const context = namedItems.length > 0 ? buildPlanContext(items!) : undefined;
        sendMessage(text, { context });
        setInputText('');
    }, [inputText, sendMessage, items]);

    // ---------------------------------------------------------------------------
    // Render item
    // ---------------------------------------------------------------------------

    const renderMessage = ({ item }: { item: ChatMessage }) => {
        const isUser = item.role === 'user';
        const emptyText = !item.text || item.text.trim().length === 0;
        const hasOptions = item.askUser && item.askUser.options.length > 0;

        // Hide empty assistant bubbles that are just silent tool calls (not streaming, no text, no options)
        if (!isUser && emptyText && !hasOptions && !item.isStreaming) {
            return null;
        }

        const textColor = isUser ? '#FFFFFF' : theme.textPrimary;
        return (
            <View
                style={[
                    styles.bubble,
                    isUser
                        ? [styles.userBubble, { backgroundColor: '#5856D6' }]
                        : [styles.assistantBubble, { backgroundColor: theme.surface }],
                ]}
            >
                <Markdown style={markdownStyles(textColor)}>
                    {item.text + (item.isStreaming ? ' ▍' : '')}
                </Markdown>

                {/* Quick-reply options from ask_user */}
                {item.askUser && item.askUser.options.length > 0 && (
                    <View style={styles.optionsContainer}>
                        {item.askUser.options.map(opt => (
                            <TouchableOpacity
                                key={opt}
                                style={styles.optionChip}
                                onPress={() => replyToAskUser(item.askUser!.callId, opt)}
                                activeOpacity={0.75}
                            >
                                <Text style={styles.optionText}>{opt}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                )}
            </View>
        );
    };



    return (
        <BottomSheet
            ref={bottomSheetRef}
            index={-1}
            snapPoints={snapPoints}
            topInset={topInset}
            enablePanDownToClose
            keyboardBehavior="fillParent"
            keyboardBlurBehavior="restore"
            android_keyboardInputMode="adjustResize"
            onChange={handleSheetChanges}
            handleComponent={() => (
                <View style={styles.handleContainer}>
                    <View style={styles.handle} />
                </View>
            )}
            backgroundStyle={{ backgroundColor: theme.background }}
        >
            <View style={styles.container}>
                {/* Header */}
                <View style={[styles.header, { borderBottomColor: theme.border }]}>
                    <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>
                        ✦ Genie
                    </Text>
                    {!isConnected && (
                        <Text style={[styles.connectingLabel, { color: theme.textSecondary }]}>
                            connecting...
                        </Text>
                    )}
                    <TouchableOpacity
                        onPress={onClose}
                        style={styles.closeBtn}
                        activeOpacity={0.7}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                        <Text style={[styles.closeBtnText, { color: theme.textSecondary }]}>
                            Close
                        </Text>
                    </TouchableOpacity>
                </View>

                {/* Messages */}
                <BottomSheetFlatList
                    ref={listRef as any}
                    data={listData}
                    keyExtractor={(item: ChatMessage | 'thinking', idx: number) =>
                        item === 'thinking' ? 'thinking' : (item as ChatMessage).id ?? String(idx)
                    }
                    renderItem={({ item }: { item: ChatMessage | 'thinking' }) => {
                        if (item === 'thinking') return <ThinkingIndicator />;
                        return renderMessage({ item: item as ChatMessage });
                    }}
                    style={styles.messagesList}
                    contentContainerStyle={styles.messageListContent}
                    keyboardShouldPersistTaps="handled"
                    onContentSizeChange={() => scrollToBottom(false)}
                    ListEmptyComponent={
                        <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                            Ask Genie about this day…
                        </Text>
                    }
                />

                {/* Input bar */}
                <View
                    style={[
                        styles.inputBar,
                        { borderTopColor: theme.border, backgroundColor: theme.background },
                    ]}
                >
                    <BottomSheetTextInput
                        style={StyleSheet.flatten([
                            styles.textInput,
                            {
                                color: theme.textPrimary,
                                backgroundColor: theme.surface,
                                borderColor: theme.border,
                            },
                        ])}
                        placeholder="Написать Genie…"
                        placeholderTextColor={theme.textSecondary}
                        value={inputText}
                        onChangeText={setInputText}
                        returnKeyType="send"
                        onSubmitEditing={handleSend}
                        blurOnSubmit={false}
                    />
                    <TouchableOpacity
                        onPress={handleSend}
                        disabled={!inputText.trim()}
                        activeOpacity={0.7}
                        style={[
                            styles.sendBtn,
                            { backgroundColor: inputText.trim() ? '#5856D6' : theme.border },
                        ]}
                    >
                        <Text style={styles.sendBtnIcon}>↑</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </BottomSheet>
    );
}

// ---------------------------------------------------------------------------
// Markdown styles (dynamic — depends on text color)
// ---------------------------------------------------------------------------

function markdownStyles(color: string) {
    return {
        body: { color, fontSize: 15, lineHeight: 22 },
        paragraph: { marginTop: 0, marginBottom: 4 },
        bullet_list: { marginTop: 0, marginBottom: 4 },
        ordered_list: { marginTop: 0, marginBottom: 4 },
        list_item: { marginBottom: 2 },
        // Ensure list item content wraps instead of expanding the bubble width
        bullet_list_content: { flex: 1, flexShrink: 1 },
        ordered_list_content: { flex: 1, flexShrink: 1 },
        strong: { fontWeight: '700' as const, color },
        em: { fontStyle: 'italic' as const, color },
        code_inline: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13, color },
    };
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
    handleContainer: {
        alignItems: 'center',
        paddingTop: 8,
        paddingBottom: 4,
    },
    handle: {
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: '#8E8E93',
    },
    container: {
        flex: 1,
    },
    messagesList: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
        gap: 8,
    },
    headerTitle: {
        fontSize: 16,
        fontWeight: '700',
        flex: 1,
    },
    connectingLabel: {
        fontSize: 12,
    },
    closeBtn: {
        paddingHorizontal: 4,
    },
    closeBtnText: {
        fontSize: 14,
    },
    messageListContent: {
        padding: 12,
        gap: 8,
        flexGrow: 1,
    },
    bubble: {
        maxWidth: '80%',
        borderRadius: 16,
        paddingHorizontal: 12,
        paddingVertical: 8,
        marginBottom: 6,
    },
    userBubble: {
        alignSelf: 'flex-end',
        borderBottomRightRadius: 4,
    },
    assistantBubble: {
        alignSelf: 'flex-start',
        borderBottomLeftRadius: 4,
    },
    thinkingDots: {
        fontSize: 18,
        color: '#8E8E93',
        letterSpacing: 2,
    },
    optionsContainer: {
        marginTop: 8,
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
    },
    optionChip: {
        backgroundColor: '#EEF0FF',
        borderRadius: 12,
        paddingVertical: 5,
        paddingHorizontal: 10,
        borderWidth: 1,
        borderColor: '#5856D6',
    },
    optionText: { color: '#5856D6', fontSize: 13, fontWeight: '500' },
    emptyText: {
        textAlign: 'center',
        marginTop: 32,
        fontSize: 14,
    },
    inputBar: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 10,
        gap: 8,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    textInput: {
        flex: 1,
        fontSize: 15,
        borderRadius: 18,
        borderWidth: 1,
        paddingHorizontal: 14,
        paddingVertical: Platform.OS === 'ios' ? 8 : 6,
        minHeight: 36,
    },
    sendBtn: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    sendBtnIcon: {
        color: '#FFFFFF',
        fontSize: 18,
        fontWeight: '700',
        lineHeight: 20,
    },
});
