import React, {
    ReactNode,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import {
    Animated,
    FlatList,
    FlatListProps,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import {
    BottomSheetFlatList,
    BottomSheetTextInput,
} from '@gorhom/bottom-sheet';

import { Message, MessageAction } from '../../screens/main/models';
import { useTheme } from '../../context/ThemeContext';
import { MessageBubble, MessageBubbleProps } from './MessageBubble';

export type ChatViewInput = {
    onSend: (text: string) => void;
    placeholder?: string;
    disabled?: boolean;
};

export type ChatViewProps = {
    messages: Message[];

    isThinking?: boolean;
    /** Returns true if the given message is still streaming (appends cursor in fallback path). */
    isStreaming?: (msg: Message) => boolean;

    /** Forwarded to every bubble. */
    bubbleOptions?: Omit<MessageBubbleProps, 'message'>;

    header?: ReactNode;
    footer?: ReactNode;

    /** Pass `null` (or omit) to hide the built-in input bar. */
    input?: ChatViewInput | null;

    emptyState?: ReactNode;

    /** When set, only the last N messages are rendered. */
    maxMessages?: number;

    /** Scroll to end on new messages. Default: true. */
    autoScroll?: boolean;

    loadMore?: { hasMore: boolean; onLoadMore: () => void };

    /** 'flatlist' (default) or 'bottomsheet' (uses @gorhom/bottom-sheet primitives). */
    listImpl?: 'flatlist' | 'bottomsheet';

    onLongPressMessage?: (text: string) => void;
    onActionPress?: (action: MessageAction) => Promise<void>;

    contentContainerStyle?: FlatListProps<Message>['contentContainerStyle'];
    listStyle?: FlatListProps<Message>['style'];
};

// ---------------------------------------------------------------------------
// Thinking indicator
// ---------------------------------------------------------------------------

function ThinkingIndicator() {
    const { theme } = useTheme();
    const opacity = useRef(new Animated.Value(0.4)).current;

    useEffect(() => {
        const anim = Animated.loop(
            Animated.sequence([
                Animated.timing(opacity, {
                    toValue: 1,
                    duration: 600,
                    useNativeDriver: true,
                }),
                Animated.timing(opacity, {
                    toValue: 0.4,
                    duration: 600,
                    useNativeDriver: true,
                }),
            ]),
        );
        anim.start();
        return () => anim.stop();
    }, [opacity]);

    return (
        <Animated.View
            style={[
                indicatorStyles.bubble,
                { opacity, backgroundColor: theme.surface },
            ]}
        >
            <Text
                style={[indicatorStyles.dots, { color: theme.textSecondary }]}
            >
                ···
            </Text>
        </Animated.View>
    );
}

const indicatorStyles = StyleSheet.create({
    bubble: {
        alignSelf: 'flex-start',
        borderRadius: 16,
        paddingHorizontal: 12,
        paddingVertical: 8,
        marginVertical: 4,
    },
    dots: { fontSize: 18, letterSpacing: 2 },
});

// ---------------------------------------------------------------------------
// Input bar
// ---------------------------------------------------------------------------

function InputBar({
    input,
    listImpl,
}: {
    input: ChatViewInput;
    listImpl: 'flatlist' | 'bottomsheet';
}) {
    const { theme } = useTheme();
    const [text, setText] = useState('');

    const handleSend = useCallback(() => {
        const t = text.trim();
        if (!t || input.disabled) return;
        input.onSend(t);
        setText('');
    }, [text, input]);

    const TextInputComp: any =
        listImpl === 'bottomsheet' ? BottomSheetTextInput : TextInput;

    return (
        <View
            style={[
                inputStyles.bar,
                {
                    borderTopColor: theme.border,
                    backgroundColor: theme.background,
                },
            ]}
        >
            <TextInputComp
                style={[
                    inputStyles.input,
                    {
                        color: theme.textPrimary,
                        backgroundColor: theme.surface,
                        borderColor: theme.border,
                    },
                ]}
                placeholder={input.placeholder ?? 'Message…'}
                placeholderTextColor={theme.textSecondary}
                value={text}
                onChangeText={setText}
                returnKeyType="send"
                onSubmitEditing={handleSend}
                blurOnSubmit={false}
                editable={!input.disabled}
            />
            <TouchableOpacity
                onPress={handleSend}
                disabled={!text.trim() || input.disabled}
                activeOpacity={0.7}
                style={[
                    inputStyles.sendBtn,
                    {
                        backgroundColor: text.trim()
                            ? theme.accent
                            : theme.border,
                    },
                ]}
            >
                <Text style={inputStyles.sendIcon}>↑</Text>
            </TouchableOpacity>
        </View>
    );
}

const inputStyles = StyleSheet.create({
    bar: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 10,
        gap: 8,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    input: {
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
    sendIcon: {
        color: '#FFFFFF',
        fontSize: 18,
        fontWeight: '700',
        lineHeight: 20,
    },
});

// ---------------------------------------------------------------------------
// ChatView
// ---------------------------------------------------------------------------

type ListItem = { kind: 'msg'; msg: Message } | { kind: 'thinking' };

export function ChatView({
    messages,
    isThinking,
    isStreaming,
    bubbleOptions,
    header,
    footer,
    input,
    emptyState,
    maxMessages,
    autoScroll = true,
    loadMore,
    listImpl = 'flatlist',
    onLongPressMessage,
    onActionPress,
    contentContainerStyle,
    listStyle,
}: ChatViewProps) {
    const { theme } = useTheme();
    const listRef = useRef<FlatList<ListItem>>(null);

    const displayMessages = useMemo(() => {
        if (maxMessages == null) return messages;
        return messages.slice(-maxMessages);
    }, [messages, maxMessages]);

    const data = useMemo<ListItem[]>(() => {
        const items: ListItem[] = displayMessages.map(msg => ({
            kind: 'msg' as const,
            msg,
        }));
        if (isThinking) items.push({ kind: 'thinking' });
        return items;
    }, [displayMessages, isThinking]);

    const scrollToEnd = useCallback(
        (animated: boolean) => {
            if (!autoScroll) return;
            listRef.current?.scrollToEnd({ animated });
        },
        [autoScroll],
    );

    useEffect(() => {
        if (data.length === 0) return;
        const id = setTimeout(() => scrollToEnd(true), 50);
        return () => clearTimeout(id);
    }, [data.length, scrollToEnd]);

    const renderItem = useCallback(
        ({ item }: { item: ListItem }) => {
            if (item.kind === 'thinking') return <ThinkingIndicator />;
            const streaming = isStreaming?.(item.msg) ?? false;
            return (
                <MessageBubble
                    {...bubbleOptions}
                    message={item.msg}
                    actions={bubbleOptions?.actions ?? item.msg.actions ?? null}
                    isStreaming={streaming}
                    onLongPress={
                        bubbleOptions?.onLongPress ?? onLongPressMessage
                    }
                    onActionPress={
                        bubbleOptions?.onActionPress ?? onActionPress
                    }
                />
            );
        },
        [bubbleOptions, isStreaming, onActionPress, onLongPressMessage],
    );

    const keyExtractor = useCallback(
        (item: ListItem, idx: number) =>
            item.kind === 'thinking' ? 'thinking' : item.msg.id ?? String(idx),
        [],
    );

    const ListComponent: any =
        listImpl === 'bottomsheet' ? BottomSheetFlatList : FlatList;

    const listHeader =
        loadMore && loadMore.hasMore ? (
            <TouchableOpacity
                onPress={loadMore.onLoadMore}
                style={chatViewStyles.loadMoreBtn}
                activeOpacity={0.7}
            >
                <Text
                    style={[
                        chatViewStyles.loadMoreText,
                        { color: theme.textSecondary },
                    ]}
                >
                    Load more
                </Text>
            </TouchableOpacity>
        ) : null;

    return (
        <View style={chatViewStyles.container}>
            {header}
            <ListComponent
                ref={listRef as any}
                data={data}
                keyExtractor={keyExtractor}
                renderItem={renderItem}
                style={[chatViewStyles.list, listStyle]}
                contentContainerStyle={[
                    chatViewStyles.content,
                    contentContainerStyle,
                ]}
                keyboardShouldPersistTaps="handled"
                onLayout={() => scrollToEnd(false)}
                onContentSizeChange={() => scrollToEnd(false)}
                ListHeaderComponent={listHeader}
                ListEmptyComponent={emptyState ?? null}
            />
            {footer}
            {input != null && <InputBar input={input} listImpl={listImpl} />}
        </View>
    );
}

const chatViewStyles = StyleSheet.create({
    container: { flex: 1 },
    list: { flex: 1, width: '100%' },
    content: {
        paddingHorizontal: 12,
        paddingTop: 8,
        paddingBottom: 12,
        gap: 6,
        flexGrow: 1,
    },
    loadMoreBtn: {
        alignSelf: 'center',
        paddingVertical: 6,
        paddingHorizontal: 16,
        marginBottom: 8,
        borderRadius: 14,
    },
    loadMoreText: { fontSize: 13, fontWeight: '500' },
});

export default ChatView;
