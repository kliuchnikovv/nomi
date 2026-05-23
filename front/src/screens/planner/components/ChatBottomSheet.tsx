import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import {
    Platform,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Spark } from 'iconoir-react-native';
import BottomSheet, {
    BottomSheetFooter,
    BottomSheetTextInput,
} from '@gorhom/bottom-sheet';
import type { BottomSheetFooterProps } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../context/ThemeContext';
import { usePlannerChat } from '../hooks/usePlannerChat';
import { PlanItem } from '../types';
import { TAB_BAR_ICON_HEIGHT } from '../../../navigation/MainTabs';
import { ChatView } from '../../../components/chat/ChatView';
import {
    isAskUserReply,
    plannerMessageToMessage,
} from '../../../components/chat/plannerAdapter';
import { Message, MessageAction } from '../../main/models';

type PlanningLevel = 'quick' | 'standard' | 'full';
const PLANNER_LEVEL_KEY = 'planner_level';

// Space reserved at the bottom of list content so the newest message is
// never hidden behind the absolutely-positioned BottomSheetFooter.
const INPUT_BAR_HEIGHT = 56;
const LEVEL_SELECTOR_HEIGHT = 44;

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
// Footer content (level selector + input)
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
                    {
                        backgroundColor: text.trim()
                            ? theme.accent
                            : theme.border,
                    },
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
                .map(
                    c =>
                        `[${c.type}:${c.id} ${c.value}${
                            c.source === 'user' ? ' 📌pinned' : ''
                        }]`,
                )
                .join(' ');
            return `ID:${i.id} ${i.text}${chips ? ' ' + chips : ''}`;
        });
    return `[Current plan:\n${lines.join(
        '\n',
    )}]\n[Note: chips marked 📌pinned were set by the user — do NOT change or remove them without explicit permission.]`;
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

    const handleSheetChanges = useCallback(
        (index: number) => {
            if (index === -1) onClose();
        },
        [onClose],
    );

    // Map ChatMessage[] → Message[] for ChatView, filtering empty drafts.
    const filteredMessages = useMemo(() => {
        return messages.filter(m => {
            if (m.role === 'user') return true;
            const empty = !m.text || m.text.trim().length === 0;
            const hasOptions = m.askUser && m.askUser.options.length > 0;
            return !(empty && !hasOptions && !m.isStreaming);
        });
    }, [messages]);

    const mappedMessages = useMemo<Message[]>(
        () => filteredMessages.map(plannerMessageToMessage),
        [filteredMessages],
    );

    const streamingIds = useMemo(() => {
        const set = new Set<string>();
        for (const m of filteredMessages) if (m.isStreaming) set.add(m.id);
        return set;
    }, [filteredMessages]);

    const isStreaming = useCallback(
        (msg: Message) => streamingIds.has(msg.id),
        [streamingIds],
    );

    const handleActionPress = useCallback(
        async (action: MessageAction) => {
            if (isAskUserReply(action)) {
                const reply = action.prompt ?? action.label;
                replyToAskUser(action.callId, reply);
            }
        },
        [replyToAskUser],
    );

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

    const headerNode = (
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
            <View
                style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    flex: 1,
                }}
            >
                <Spark width={18} height={18} color={theme.textPrimary} />
                <Text
                    style={[styles.headerTitle, { color: theme.textPrimary }]}
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
    );

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
            <ChatView
                listImpl="bottomsheet"
                messages={mappedMessages}
                isThinking={isThinking}
                isStreaming={isStreaming}
                input={null}
                loadMore={{ hasMore, onLoadMore: loadMore }}
                bubbleOptions={{
                    showToolCalls: false,
                    showReasoning: false,
                    showAttachments: false,
                    showActions: true,
                    showLocations: false,
                    showModelLabel: false,
                    showAgentLabel: false,
                    maxWidthPct: 80,
                }}
                onActionPress={handleActionPress}
                emptyState={
                    <Text
                        style={[
                            styles.emptyText,
                            { color: theme.textSecondary },
                        ]}
                    >
                        Ask Nomi about this day…
                    </Text>
                }
                header={headerNode}
                contentContainerStyle={{
                    paddingTop: 12,
                    paddingHorizontal: 12,
                    paddingBottom:
                        INPUT_BAR_HEIGHT + LEVEL_SELECTOR_HEIGHT + 12,
                    gap: 8,
                    flexGrow: 1,
                }}
            />
        </BottomSheet>
    );
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
