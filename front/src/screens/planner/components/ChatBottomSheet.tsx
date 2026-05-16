import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    Platform,
    Animated,
    FlatList,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Spark } from 'iconoir-react-native';
import Markdown from 'react-native-markdown-display';
import BottomSheet, {
    BottomSheetFlatList,
    BottomSheetFooter,
    BottomSheetTextInput,
} from '@gorhom/bottom-sheet';
import type { BottomSheetFooterProps } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../context/ThemeContext';
import { ChatMessage, usePlannerChat } from '../hooks/usePlannerChat';
import { PlanItem } from '../types';
import { TAB_BAR_ICON_HEIGHT } from '../../../navigation/MainTabs';

type PlanningLevel = 'quick' | 'standard' | 'full';
const PLANNER_LEVEL_KEY = 'planner_level';

// Space reserved at the bottom of the FlatList content so the newest
// message is never hidden behind the absolutely-positioned footer.
const INPUT_BAR_HEIGHT = 56;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
    isOpen: boolean;
    onClose: () => void;
    date: string;
    items?: PlanItem[];
    autoSend?: boolean;
    autoSendWebSearch?: boolean;
    onAutoSendHandled?: () => void;
}

// ---------------------------------------------------------------------------
// Stable footer — defined OUTSIDE the parent so its identity never changes.
// Keyboard dismissal was caused by renderFooter changing reference on every
// keystroke (inputText in deps) → BottomSheet saw a new component type →
// unmount+remount → TextInput lost focus. Moving input state here and
// receiving only a stable onSend ref breaks that cycle.
// ---------------------------------------------------------------------------

interface FooterContentProps {
    theme: any;
    onSend: React.MutableRefObject<(text: string) => void>;
}

const LEVELS: { id: PlanningLevel; label: string }[] = [
    { id: 'quick', label: '⚡ Quick' },
    { id: 'standard', label: '📋 Standard' },
    { id: 'full', label: '🔍 Full' },
];

const LevelSelector = React.memo(function LevelSelector({
    theme,
    level,
    setLevel,
}: {
    theme: any;
    level: PlanningLevel;
    setLevel: (l: PlanningLevel) => void;
}) {
    return (
        <View style={levelStyles.row}>
            {LEVELS.map(({ id, label }) => (
                <TouchableOpacity
                    key={id}
                    onPress={() => setLevel(id)}
                    style={[
                        levelStyles.btn,
                        {
                            borderColor:
                                level === id ? theme.accent : theme.border,
                        },
                        level === id && {
                            backgroundColor: `${theme.accent}18`,
                        },
                    ]}
                    activeOpacity={0.7}
                >
                    <Text
                        style={[
                            levelStyles.btnText,
                            {
                                color:
                                    level === id
                                        ? theme.accent
                                        : theme.textSecondary,
                            },
                        ]}
                    >
                        {label}
                    </Text>
                </TouchableOpacity>
            ))}
        </View>
    );
});

const levelStyles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        gap: 6,
        paddingHorizontal: 12,
        paddingTop: 8,
        paddingBottom: 2,
    },
    btn: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: 5,
        borderRadius: 8,
        borderWidth: 1,
    },
    btnText: { fontSize: 12, fontWeight: '500' },
});

const ChatFooterContent = React.memo(function ChatFooterContent({
    theme,
    onSend,
}: FooterContentProps) {
    const [text, setText] = useState('');

    const handleSend = () => {
        const t = text.trim();
        if (!t) return;
        onSend.current(t);
        setText('');
    };

    return (
        <View
            style={[
                styles.inputBar,
                {
                    borderTopColor: theme.border,
                    backgroundColor: theme.background,
                },
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
                placeholder="Message Nomi…"
                placeholderTextColor={theme.textSecondary}
                value={text}
                onChangeText={setText}
                returnKeyType="send"
                onSubmitEditing={handleSend}
                blurOnSubmit={false}
            />
            <TouchableOpacity
                onPress={handleSend}
                disabled={!text.trim()}
                activeOpacity={0.7}
                style={[
                    styles.sendBtn,
                    { backgroundColor: text.trim() ? '#5856D6' : theme.border },
                ]}
            >
                <Text style={styles.sendBtnIcon}>↑</Text>
            </TouchableOpacity>
        </View>
    );
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function currentDateTimeStr(): string {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}.${String(
        d.getMonth() + 1,
    ).padStart(2, '0')} ${String(d.getFullYear())} ${String(
        d.getHours(),
    ).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function buildPlanningPrompt(items: PlanItem[], date: string): string {
    const namedItems = items.filter(i => !i.checked && i.text.trim() !== '');
    if (namedItems.length === 0) {
        return `Help me plan my day for ${date} (it's ${currentDateTimeStr()} now) — I have no tasks yet. Please suggest something.`;
    }
    const planLines = namedItems.map(i => `ID:${i.id} ${i.text}`).join('\n');
    return `Help me plan my day for ${date} (it's ${currentDateTimeStr()} now).\n\n[Current plan:\n${planLines}]`;
}

function buildPlanContext(items: PlanItem[]): string {
    const lines = items
        .filter(i => !i.checked && i.text.trim() !== '')
        .map(i => {
            const chips = i.chips
                .map(c => `[${c.type}:${c.id} ${c.value}${c.source === 'user' ? ' 📌pinned' : ''}]`)
                .join(' ');
            return `ID:${i.id} ${i.text}${chips ? ' ' + chips : ''}`;
        });
    return `[Current plan:\n${lines.join('\n')}]\n[Note: chips marked 📌pinned were set by the user — do NOT change or remove them without explicit permission.]`;
}

// ---------------------------------------------------------------------------
// ThinkingIndicator
// ---------------------------------------------------------------------------

function ThinkingIndicator() {
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
                styles.bubble,
                styles.assistantBubble,
                { opacity, alignSelf: 'flex-start' },
            ]}
        >
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
    const { top: topInset, bottom: bottomInset } = useSafeAreaInsets();
    const bottomSheetRef = useRef<BottomSheet>(null);
    const listRef = useRef<FlatList<ChatMessage | 'thinking'>>(null);
    const snapPoints = ['55%', '92%'];

    const {
        messages,
        sendMessage,
        isConnected,
        isThinking,
        replyToAskUser,
        hasMore,
        loadMore,
    } = usePlannerChat(date);

    // Planning level state — persisted across sessions
    const [level, setLevelState] = useState<PlanningLevel>('standard');
    const levelRef = useRef<PlanningLevel>('standard');
    useEffect(() => {
        AsyncStorage.getItem(PLANNER_LEVEL_KEY).then(v => {
            if (v === 'quick' || v === 'standard' || v === 'full') {
                setLevelState(v);
                levelRef.current = v;
            }
        });
    }, []);
    const setLevel = useCallback((l: PlanningLevel) => {
        setLevelState(l);
        levelRef.current = l;
        AsyncStorage.setItem(PLANNER_LEVEL_KEY, l);
    }, []);

    // Stable send ref — ChatFooterContent reads this ref so renderFooter
    // never needs to change identity when items/sendMessage change.
    const onSendRef = useRef<(text: string) => void>(() => {});
    useEffect(() => {
        onSendRef.current = (text: string) => {
            const namedItems = items
                ? items.filter(i => !i.checked && i.text.trim() !== '')
                : [];
            const context =
                namedItems.length > 0 ? buildPlanContext(items!) : undefined;
            sendMessage(text, { context, level: levelRef.current });
        };
    }, [items, sendMessage]);

    // Sync open/close → sheet index
    useEffect(() => {
        if (isOpen) {
            bottomSheetRef.current?.snapToIndex(0);
        } else {
            bottomSheetRef.current?.close();
        }
    }, [isOpen]);

    // Auto-send
    const autoSentRef = useRef(false);
    const itemsRef = useRef(items);
    useEffect(() => {
        itemsRef.current = items;
    });

    useEffect(() => {
        if (isOpen && isConnected && autoSend && !autoSentRef.current) {
            autoSentRef.current = true;
            const prompt = buildPlanningPrompt(itemsRef.current ?? [], date);
            sendMessage(prompt, {
                webSearch: autoSendWebSearch ?? false,
                level: levelRef.current,
            });
            onAutoSendHandled?.();
        }
    }, [
        isOpen,
        isConnected,
        autoSend,
        date,
        sendMessage,
        onAutoSendHandled,
        autoSendWebSearch,
    ]);

    useEffect(() => {
        if (!autoSend) autoSentRef.current = false;
    }, [autoSend]);

    // Natural order: oldest → newest; FlatList scrolls to end (bottom = newest)
    const listData = useMemo(
        () => [...messages, ...(isThinking ? ['thinking' as const] : [])],
        [messages, isThinking],
    );

    // Scroll to bottom helpers
    const scrollToBottom = useCallback((animated: boolean) => {
        listRef.current?.scrollToEnd({ animated });
    }, []);

    // Scroll to bottom whenever new content arrives
    useEffect(() => {
        scrollToBottom(true);
    }, [listData.length, scrollToBottom]);

    // Scroll to bottom (non-animated) when the sheet opens or expands
    const handleSheetChanges = useCallback(
        (index: number) => {
            if (index === -1) {
                onClose();
            } else {
                setTimeout(() => scrollToBottom(false), 300);
            }
        },
        [onClose, scrollToBottom],
    );

    // ---------------------------------------------------------------------------
    // Footer — stable reference: only depends on theme (never changes during typing)
    // ---------------------------------------------------------------------------

    const renderFooter = useCallback(
        (props: BottomSheetFooterProps) => (
            <BottomSheetFooter {...props}>
                <LevelSelector
                    theme={theme}
                    level={level}
                    setLevel={setLevel}
                />
                <ChatFooterContent theme={theme} onSend={onSendRef} />
            </BottomSheetFooter>
        ),
        [theme, level, setLevel],
    );

    // ---------------------------------------------------------------------------
    // Render item
    // ---------------------------------------------------------------------------

    const renderMessage = ({ item }: { item: ChatMessage }) => {
        const isUser = item.role === 'user';
        const emptyText = !item.text || item.text.trim().length === 0;
        const hasOptions = item.askUser && item.askUser.options.length > 0;

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
                        : [
                              styles.assistantBubble,
                              { backgroundColor: theme.surface },
                          ],
                ]}
            >
                <Markdown style={markdownStyles(textColor)}>
                    {item.text + (item.isStreaming ? ' ▍' : '')}
                </Markdown>

                {item.askUser && item.askUser.options.length > 0 && (
                    <View style={styles.optionsContainer}>
                        {item.askUser.options.map(opt => (
                            <TouchableOpacity
                                key={opt}
                                style={styles.optionChip}
                                onPress={() =>
                                    replyToAskUser(item.askUser!.callId, opt)
                                }
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
            bottomInset={TAB_BAR_ICON_HEIGHT + bottomInset}
            enablePanDownToClose
            keyboardBehavior="fillParent"
            keyboardBlurBehavior="restore"
            android_keyboardInputMode="adjustResize"
            onChange={handleSheetChanges}
            footerComponent={renderFooter}
            handleComponent={() => (
                <View style={styles.handleContainer}>
                    <View style={styles.handle} />
                </View>
            )}
            backgroundStyle={{ backgroundColor: theme.background }}
        >
            <View style={styles.container}>
                {/* Header */}
                <View
                    style={[styles.header, { borderBottomColor: theme.border }]}
                >
                    <View
                        style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 6,
                            flex: 1,
                        }}
                    >
                        <Spark
                            width={18}
                            height={18}
                            color={theme.textPrimary}
                        />
                        <Text
                            style={[
                                styles.headerTitle,
                                { color: theme.textPrimary },
                            ]}
                        >
                            Nomi
                        </Text>
                    </View>
                    {!isConnected && (
                        <Text
                            style={[
                                styles.connectingLabel,
                                { color: theme.textSecondary },
                            ]}
                        >
                            connecting...
                        </Text>
                    )}
                    <TouchableOpacity
                        onPress={onClose}
                        style={styles.closeBtn}
                        activeOpacity={0.7}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                        <Text
                            style={[
                                styles.closeBtnText,
                                { color: theme.textSecondary },
                            ]}
                        >
                            Close
                        </Text>
                    </TouchableOpacity>
                </View>

                {/* Messages */}
                <BottomSheetFlatList
                    ref={listRef as any}
                    data={listData}
                    keyExtractor={(
                        item: ChatMessage | 'thinking',
                        idx: number,
                    ) =>
                        item === 'thinking'
                            ? 'thinking'
                            : (item as ChatMessage).id ?? String(idx)
                    }
                    renderItem={({
                        item,
                    }: {
                        item: ChatMessage | 'thinking';
                    }) => {
                        if (item === 'thinking') return <ThinkingIndicator />;
                        return renderMessage({ item: item as ChatMessage });
                    }}
                    style={styles.messagesList}
                    contentContainerStyle={styles.messageListContent}
                    keyboardShouldPersistTaps="handled"
                    onLayout={() => scrollToBottom(false)}
                    onContentSizeChange={() => scrollToBottom(false)}
                    ListHeaderComponent={
                        hasMore ? (
                            <TouchableOpacity
                                onPress={loadMore}
                                style={styles.loadMoreBtn}
                                activeOpacity={0.7}
                            >
                                <Text
                                    style={[
                                        styles.loadMoreText,
                                        { color: theme.textSecondary },
                                    ]}
                                >
                                    Load more
                                </Text>
                            </TouchableOpacity>
                        ) : null
                    }
                    ListEmptyComponent={
                        <Text
                            style={[
                                styles.emptyText,
                                { color: theme.textSecondary },
                            ]}
                        >
                            Ask Nomi about this day…
                        </Text>
                    }
                />
            </View>
        </BottomSheet>
    );
}

// ---------------------------------------------------------------------------
// Markdown styles
// ---------------------------------------------------------------------------

function markdownStyles(color: string) {
    return {
        body: { color, fontSize: 15, lineHeight: 22 },
        paragraph: { marginTop: 0, marginBottom: 4 },
        bullet_list: { marginTop: 0, marginBottom: 4 },
        ordered_list: { marginTop: 0, marginBottom: 4 },
        list_item: { marginBottom: 2 },
        bullet_list_content: { flex: 1, flexShrink: 1 },
        ordered_list_content: { flex: 1, flexShrink: 1 },
        strong: { fontWeight: '700' as const, color },
        em: { fontStyle: 'italic' as const, color },
        code_inline: {
            fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
            fontSize: 13,
            color,
        },
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
        paddingTop: 12,
        paddingHorizontal: 12,
        // Extra bottom padding reserves space for the absolutely-positioned
        // footer so the last message is never hidden behind the input bar.
        paddingBottom: INPUT_BAR_HEIGHT + 12,
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
    loadMoreBtn: {
        alignSelf: 'center',
        paddingVertical: 6,
        paddingHorizontal: 16,
        marginBottom: 8,
        borderRadius: 14,
    },
    loadMoreText: {
        fontSize: 13,
        fontWeight: '500',
    },
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
