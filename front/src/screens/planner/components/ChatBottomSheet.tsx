import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import {
    Alert,
    Image,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    Spark,
    Plus,
    Check,
    Eye,
    EyeClosed,
    Code,
    MagicWand,
    MediaImage,
    Attachment as AttachmentIcon,
    Camera,
    MapPin,
    XmarkCircle,
} from 'iconoir-react-native';
import BottomSheet, {
    BottomSheetFooter,
    BottomSheetTextInput,
} from '@gorhom/bottom-sheet';
import type { BottomSheetFooterProps } from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';
import DocumentPicker from 'react-native-document-picker';
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
import {
    ContextMenu,
    ContextMenuItem,
    ContextMenuSection,
} from '../../../components/ContextMenu';
import { apiClient, modelsApi } from '../../../apiClient';
import { ModelDetail } from '../../../types/Model';
import { PLANNER_MODEL_KEY, PLANNER_PROVIDER_KEY } from '../../settings/screen';
import { LocationPickerModal } from '../../../screens/chat/input/LocationPickerModal';

type PlanningLevel = 'quick' | 'standard' | 'full';
type DetailLevel = 'hide' | 'tool_calls' | 'think' | 'all';

type LocalAttachment = {
    id: string;
    uri: string;
    type: 'image' | 'file';
    name: string;
    loading: boolean;
};

const LEVEL_LABELS: Record<PlanningLevel, string> = {
    quick: '⚡ Quick',
    standard: '📋 Standard',
    full: '🔍 Full',
};

const INPUT_BAR_HEIGHT = 56;
const OPTIONS_ROW_HEIGHT = 60;

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
// Footer content
// ---------------------------------------------------------------------------

interface FooterContentProps {
    theme: any;
    onSend: React.MutableRefObject<(text: string) => void>;
    selectedModelName: string;
    levelLabel: string;
    onModelPress: () => void;
    onLevelPress: () => void;
    onPlusPress: () => void;
    attachments: LocalAttachment[];
    onRemoveAttachment: (id: string) => void;
}

const ChatFooterContent = React.memo(function ChatFooterContent({
    theme,
    onSend,
    selectedModelName,
    levelLabel,
    onModelPress,
    onLevelPress,
    onPlusPress,
    attachments,
    onRemoveAttachment,
}: FooterContentProps) {
    const [text, setText] = useState('');

    const handleSend = () => {
        const t = text.trim();
        if (!t && attachments.length === 0) return;
        onSend.current(t);
        setText('');
    };

    return (
        <View style={{ backgroundColor: theme.background + 'D0' }}>
            {/* Attachment preview strip */}
            {attachments.length > 0 && (
                <ScrollView
                    horizontal
                    style={{
                        paddingHorizontal: 12,
                        paddingTop: 8,
                        maxHeight: 96,
                    }}
                    contentContainerStyle={{ gap: 8 }}
                >
                    {attachments.map(att => (
                        <View
                            key={att.id}
                            style={{
                                width: 76,
                                height: 76,
                                borderRadius: 10,
                                overflow: 'hidden',
                                backgroundColor: theme.surface,
                            }}
                        >
                            {att.type === 'image' ? (
                                <Image
                                    source={{ uri: att.uri }}
                                    style={{ width: '100%', height: '100%' }}
                                />
                            ) : (
                                <View
                                    style={{
                                        flex: 1,
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}
                                >
                                    <AttachmentIcon
                                        width={24}
                                        height={24}
                                        color={theme.textPrimary}
                                    />
                                    <Text
                                        numberOfLines={1}
                                        style={{
                                            fontSize: 10,
                                            color: theme.textPrimary,
                                            paddingHorizontal: 4,
                                            marginTop: 4,
                                        }}
                                    >
                                        {att.name}
                                    </Text>
                                </View>
                            )}
                            {att.loading && (
                                <View
                                    style={{
                                        ...StyleSheet.absoluteFillObject,
                                        backgroundColor: 'rgba(0,0,0,0.4)',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}
                                >
                                    <Text
                                        style={{ color: '#fff', fontSize: 11 }}
                                    >
                                        uploading…
                                    </Text>
                                </View>
                            )}
                            <Pressable
                                onPress={() => onRemoveAttachment(att.id)}
                                style={{
                                    position: 'absolute',
                                    top: 2,
                                    right: 2,
                                    backgroundColor: 'rgba(0,0,0,0.5)',
                                    borderRadius: 10,
                                    padding: 2,
                                }}
                            >
                                <XmarkCircle
                                    width={14}
                                    height={14}
                                    color="#fff"
                                />
                            </Pressable>
                        </View>
                    ))}
                </ScrollView>
            )}

            {/* Options row: + | model pill | level pill */}
            <View style={styles.optionsRow}>
                <Pressable
                    onPress={onPlusPress}
                    style={({ pressed }) => [
                        styles.circleBtn,
                        {
                            backgroundColor: theme.surface,
                            opacity: pressed ? 0.7 : 1,
                        },
                    ]}
                >
                    <Plus width={22} height={22} color={theme.text} />
                </Pressable>
                <Pressable
                    onPress={onModelPress}
                    style={({ pressed }) => [
                        styles.modelPill,
                        {
                            backgroundColor: theme.surface,
                            opacity: pressed ? 0.7 : 1,
                        },
                    ]}
                >
                    <Text
                        style={[styles.modelPillText, { color: theme.text }]}
                        numberOfLines={1}
                    >
                        {selectedModelName}
                    </Text>
                </Pressable>
                <Pressable
                    onPress={onLevelPress}
                    style={({ pressed }) => [
                        styles.levelPill,
                        {
                            backgroundColor: theme.surface,
                            opacity: pressed ? 0.7 : 1,
                        },
                    ]}
                >
                    <Text style={[styles.modelPillText, { color: theme.text }]}>
                        {levelLabel}
                    </Text>
                </Pressable>
            </View>

            {/* Input row */}
            <View style={styles.inputBar}>
                <BottomSheetTextInput
                    style={StyleSheet.flatten([
                        styles.textInput,
                        {
                            color: theme.textPrimary,
                            backgroundColor: theme.surface,
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
                <Pressable
                    onPress={handleSend}
                    disabled={!text.trim() && attachments.length === 0}
                    style={({ pressed }) => [
                        styles.sendBtn,
                        {
                            backgroundColor:
                                text.trim() || attachments.length > 0
                                    ? theme.accent
                                    : theme.border,
                            opacity: pressed ? 0.7 : 1,
                        },
                    ]}
                >
                    <Text style={styles.sendBtnIcon}>↑</Text>
                </Pressable>
            </View>
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

    // ---------------------------------------------------------------------------
    // Model state
    // ---------------------------------------------------------------------------

    const [models, setModels] = useState<ModelDetail[]>([]);
    const [selectedModelId, setSelectedModelId] = useState('');
    const [selectedProvider, setSelectedProvider] = useState('');

    useEffect(() => {
        Promise.all([
            modelsApi.getModels().catch(() => [] as ModelDetail[]),
            AsyncStorage.getItem(PLANNER_MODEL_KEY),
            AsyncStorage.getItem(PLANNER_PROVIDER_KEY),
        ]).then(([allModels, savedId, savedProvider]) => {
            setModels(allModels.filter((m: ModelDetail) => m.supports_tools));
            if (savedId) setSelectedModelId(savedId);
            if (savedProvider) setSelectedProvider(savedProvider);
        });
    }, []);

    const selectedModelName = useMemo(() => {
        const found = models.find(m => m.id === selectedModelId);
        if (found) return found.name || found.id;
        if (selectedModelId)
            return selectedModelId
                .split('-')
                .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                .join(' ');
        return models[0]?.name ?? 'Model';
    }, [models, selectedModelId]);

    // ---------------------------------------------------------------------------
    // Attachment state
    // ---------------------------------------------------------------------------

    const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
    const [isPickerActive, setPickerActive] = useState(false);
    const [locationPickerVisible, setLocationPickerVisible] = useState(false);

    const uploadFile = useCallback(
        async (
            uri: string,
            name: string,
            mimeType: string,
            type: 'image' | 'file',
        ): Promise<string | null> => {
            const tempId = `tmp-${Date.now()}`;
            setAttachments(prev => [
                ...prev,
                { id: tempId, uri, type, name, loading: true },
            ]);
            try {
                const result = await (apiClient as any).uploadFile({
                    uri,
                    name,
                    type: mimeType,
                });
                setAttachments(prev =>
                    prev.map(a =>
                        a.id === tempId
                            ? { ...a, id: result.id, loading: false }
                            : a,
                    ),
                );
                return result.id;
            } catch {
                setAttachments(prev => prev.filter(a => a.id !== tempId));
                Alert.alert('Upload failed', 'Could not upload the file.');
                return null;
            }
        },
        [],
    );

    const executeWithDelay = useCallback(
        (action: () => Promise<void>) => {
            if (isPickerActive) return;
            setPlusMenuVisible(false);
            setPickerActive(true);
            setTimeout(async () => {
                try {
                    await action();
                } finally {
                    setPickerActive(false);
                }
            }, 500);
        },
        [isPickerActive],
    );

    const pickImage = useCallback(async () => {
        const res = await launchImageLibrary({
            mediaType: 'photo',
            quality: 0.8,
        });
        if (res.assets?.[0]) {
            const { uri, fileName, type } = res.assets[0];
            if (uri)
                await uploadFile(
                    uri,
                    fileName ?? 'photo.jpg',
                    type ?? 'image/jpeg',
                    'image',
                );
        }
    }, [uploadFile]);

    const takePhoto = useCallback(async () => {
        const res = await launchCamera({ mediaType: 'photo', quality: 0.8 });
        if (res.assets?.[0]) {
            const { uri, fileName, type } = res.assets[0];
            if (uri)
                await uploadFile(
                    uri,
                    fileName ?? 'photo.jpg',
                    type ?? 'image/jpeg',
                    'image',
                );
        }
    }, [uploadFile]);

    const pickDocument = useCallback(async () => {
        try {
            const res = await DocumentPicker.pickSingle({
                type: [DocumentPicker.types.allFiles],
            });
            if (res.uri)
                await uploadFile(
                    res.uri,
                    res.name ?? 'file',
                    res.type ?? 'application/octet-stream',
                    'file',
                );
        } catch (e) {
            if (!DocumentPicker.isCancel(e))
                Alert.alert('Error', 'Failed to pick document.');
        }
    }, [uploadFile]);

    const removeAttachment = useCallback((id: string) => {
        setAttachments(prev => prev.filter(a => a.id !== id));
    }, []);

    // ---------------------------------------------------------------------------
    // Level / detail
    // ---------------------------------------------------------------------------

    const [level, setLevel] = useState<PlanningLevel>('standard');
    const levelRef = useRef<PlanningLevel>('standard');
    const [detailLevel, setDetailLevel] = useState<DetailLevel>('hide');

    // ---------------------------------------------------------------------------
    // Menu visibility
    // ---------------------------------------------------------------------------

    const [modelMenuVisible, setModelMenuVisible] = useState(false);
    const [levelMenuVisible, setLevelMenuVisible] = useState(false);
    const [plusMenuVisible, setPlusMenuVisible] = useState(false);
    const [detailMenuVisible, setDetailMenuVisible] = useState(false);

    // ---------------------------------------------------------------------------
    // Context menu items
    // ---------------------------------------------------------------------------

    const modelMenuSections: ContextMenuSection[] = useMemo(() => {
        const byProvider = new Map<string, ContextMenuItem[]>();
        for (const model of models) {
            const provider = model.provider ?? 'other';
            const providerItems = byProvider.get(provider) ?? [];
            const isSelected = model.id === selectedModelId;
            providerItems.push({
                id: model.id,
                label: model.name || model.id,
                badges: model.supports_vision ? (
                    <MediaImage
                        width={13}
                        height={13}
                        color={isSelected ? theme.accent : theme.textSecondary}
                    />
                ) : undefined,
                icon: isSelected ? (
                    <Check width={20} height={20} color={theme.accent} />
                ) : undefined,
                onPress: async () => {
                    setSelectedModelId(model.id);
                    setSelectedProvider(model.provider ?? '');
                    setModelMenuVisible(false);
                    await AsyncStorage.setItem(PLANNER_MODEL_KEY, model.id);
                    await AsyncStorage.setItem(
                        PLANNER_PROVIDER_KEY,
                        model.provider ?? '',
                    );
                },
            });
            byProvider.set(provider, providerItems);
        }
        const cap = (s: string) =>
            s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
        return Array.from(byProvider.entries()).map(([p, items]) => ({
            title: cap(p),
            items,
        }));
    }, [models, selectedModelId, theme.accent, theme.textSecondary]);

    const levelMenuItems: ContextMenuItem[] = useMemo(
        () => [
            {
                id: 'quick',
                label: '⚡ Quick',
                icon:
                    level === 'quick' ? (
                        <Check width={20} height={20} color={theme.accent} />
                    ) : undefined,
                onPress: () => {
                    setLevel('quick');
                    levelRef.current = 'quick';
                    setLevelMenuVisible(false);
                },
            },
            {
                id: 'standard',
                label: '📋 Standard',
                icon:
                    level === 'standard' ? (
                        <Check width={20} height={20} color={theme.accent} />
                    ) : undefined,
                onPress: () => {
                    setLevel('standard');
                    levelRef.current = 'standard';
                    setLevelMenuVisible(false);
                },
            },
            {
                id: 'full',
                label: '🔍 Full',
                icon:
                    level === 'full' ? (
                        <Check width={20} height={20} color={theme.accent} />
                    ) : undefined,
                onPress: () => {
                    setLevel('full');
                    levelRef.current = 'full';
                    setLevelMenuVisible(false);
                },
            },
        ],
        [level, theme.accent],
    );

    const detailMenuItems: ContextMenuItem[] = useMemo(
        () => [
            {
                id: 'hide',
                label: 'Hide Details',
                icon: (
                    <EyeClosed
                        width={20}
                        height={20}
                        color={detailLevel === 'hide' ? theme.accent : '#fff'}
                    />
                ),
                onPress: () => {
                    setDetailLevel('hide');
                    setDetailMenuVisible(false);
                },
            },
            {
                id: 'tool_calls',
                label: 'Tool Calls Only',
                icon: (
                    <Code
                        width={20}
                        height={20}
                        color={
                            detailLevel === 'tool_calls' ? theme.accent : '#fff'
                        }
                    />
                ),
                onPress: () => {
                    setDetailLevel('tool_calls');
                    setDetailMenuVisible(false);
                },
            },
            {
                id: 'think',
                label: 'Thinking Only',
                icon: (
                    <MagicWand
                        width={20}
                        height={20}
                        color={detailLevel === 'think' ? theme.accent : '#fff'}
                    />
                ),
                onPress: () => {
                    setDetailLevel('think');
                    setDetailMenuVisible(false);
                },
            },
            {
                id: 'all',
                label: 'Show Everything',
                icon: (
                    <Eye
                        width={20}
                        height={20}
                        color={detailLevel === 'all' ? theme.accent : '#fff'}
                    />
                ),
                onPress: () => {
                    setDetailLevel('all');
                    setDetailMenuVisible(false);
                },
            },
        ],
        [detailLevel, theme.accent],
    );

    const plusMenuItems: ContextMenuItem[] = useMemo(
        () => [
            {
                id: 'files',
                label: 'Files',
                icon: <AttachmentIcon width={20} height={20} color="#fff" />,
                onPress: () => executeWithDelay(pickDocument),
            },
            {
                id: 'photos',
                label: 'Photos',
                icon: <MediaImage width={20} height={20} color="#fff" />,
                onPress: () => executeWithDelay(pickImage),
            },
            {
                id: 'camera',
                label: 'Camera',
                icon: <Camera width={20} height={20} color="#fff" />,
                onPress: () => executeWithDelay(takePhoto),
            },
            {
                id: 'location',
                label: 'Location',
                icon: <MapPin width={20} height={20} color="#34A853" />,
                onPress: () => {
                    setPlusMenuVisible(false);
                    setTimeout(() => setLocationPickerVisible(true), 300);
                },
            },
            {
                id: 'detail_level',
                label: 'Detail Level',
                icon: <Eye width={20} height={20} color={theme.accent} />,
                onPress: () => {
                    setPlusMenuVisible(false);
                    setTimeout(() => setDetailMenuVisible(true), 300);
                },
            },
        ],
        [executeWithDelay, pickDocument, pickImage, takePhoto, theme.accent],
    );

    // ---------------------------------------------------------------------------
    // Bubble options (wired to detailLevel)
    // ---------------------------------------------------------------------------

    const bubbleOptions = useMemo(
        () => ({
            showToolCalls:
                detailLevel === 'tool_calls' || detailLevel === 'all',
            showReasoning: detailLevel === 'think' || detailLevel === 'all',
            showAttachments: true,
            showActions: true,
            showLocations: false,
            showModelLabel: false,
            showAgentLabel: false,
            maxWidthPct: 80,
        }),
        [detailLevel],
    );

    // ---------------------------------------------------------------------------
    // Send ref
    // ---------------------------------------------------------------------------

    const onSendRef = useRef<(text: string) => void>(() => {});
    useEffect(() => {
        onSendRef.current = (text: string) => {
            const namedItems = items
                ? items.filter(i => !i.checked && i.text.trim() !== '')
                : [];
            const context =
                namedItems.length > 0 ? buildPlanContext(items!) : undefined;
            const readyAttachmentIds = attachments
                .filter(a => !a.loading)
                .map(a => a.id);
            sendMessage(text, {
                context,
                level: levelRef.current,
                model: selectedModelId || undefined,
                provider: selectedProvider || undefined,
                attachmentIds: readyAttachmentIds.length
                    ? readyAttachmentIds
                    : undefined,
            });
            setAttachments([]);
        };
    }, [items, sendMessage, selectedModelId, selectedProvider, attachments]);

    // ---------------------------------------------------------------------------
    // Sheet open/close
    // ---------------------------------------------------------------------------

    useEffect(() => {
        if (isOpen) bottomSheetRef.current?.snapToIndex(0);
        else bottomSheetRef.current?.close();
    }, [isOpen]);

    // ---------------------------------------------------------------------------
    // Auto-send
    // ---------------------------------------------------------------------------

    const autoSentRef = useRef(false);
    const itemsRef = useRef(items);
    useEffect(() => {
        itemsRef.current = items;
    });

    useEffect(() => {
        if (isOpen && isConnected && autoSend && !autoSentRef.current) {
            autoSentRef.current = true;
            sendMessage(buildPlanningPrompt(itemsRef.current ?? [], date), {
                webSearch: autoSendWebSearch ?? false,
                level: levelRef.current,
                model: selectedModelId || undefined,
                provider: selectedProvider || undefined,
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
        selectedModelId,
        selectedProvider,
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

    // ---------------------------------------------------------------------------
    // Messages
    // ---------------------------------------------------------------------------

    const filteredMessages = useMemo(
        () =>
            messages.filter(m => {
                if (m.role === 'user') return true;
                const empty = !m.text || m.text.trim().length === 0;
                const hasOptions = m.askUser && m.askUser.options.length > 0;
                return !(empty && !hasOptions && !m.isStreaming);
            }),
        [messages],
    );

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
            if (isAskUserReply(action))
                replyToAskUser(action.callId, action.prompt ?? action.label);
        },
        [replyToAskUser],
    );

    // ---------------------------------------------------------------------------
    // Footer
    // ---------------------------------------------------------------------------

    const renderFooter = useCallback(
        (props: BottomSheetFooterProps) => (
            <BottomSheetFooter {...props}>
                <ChatFooterContent
                    theme={theme}
                    onSend={onSendRef}
                    selectedModelName={selectedModelName}
                    levelLabel={LEVEL_LABELS[level]}
                    onModelPress={() => setModelMenuVisible(true)}
                    onLevelPress={() => setLevelMenuVisible(true)}
                    onPlusPress={() => setPlusMenuVisible(true)}
                    attachments={attachments}
                    onRemoveAttachment={removeAttachment}
                />
            </BottomSheetFooter>
        ),
        [theme, selectedModelName, level, attachments, removeAttachment],
    );

    const headerNode = (
        <View
            style={[
                styles.header,
                { backgroundColor: theme.background + 'D0' },
            ]}
        >
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
                style={[styles.closeBtn, { backgroundColor: theme.surface }]}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
                <Text
                    style={[styles.closeBtnText, { color: theme.textPrimary }]}
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
                bubbleOptions={bubbleOptions}
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
                    paddingBottom: INPUT_BAR_HEIGHT + OPTIONS_ROW_HEIGHT + 12,
                    gap: 8,
                    flexGrow: 1,
                }}
            />

            <ContextMenu
                visible={modelMenuVisible}
                onClose={() => setModelMenuVisible(false)}
                sections={modelMenuSections}
                position="bottom-left"
                title="Select Model"
            />
            <ContextMenu
                visible={levelMenuVisible}
                onClose={() => setLevelMenuVisible(false)}
                items={levelMenuItems}
                position="bottom-left"
                title="Planning Level"
            />
            <ContextMenu
                visible={plusMenuVisible}
                onClose={() => setPlusMenuVisible(false)}
                items={plusMenuItems}
                position="bottom-left"
            />
            <ContextMenu
                visible={detailMenuVisible}
                onClose={() => setDetailMenuVisible(false)}
                items={detailMenuItems}
                position="bottom-left"
                title="Detail Level"
            />

            <LocationPickerModal
                visible={locationPickerVisible}
                onClose={() => setLocationPickerVisible(false)}
            />
        </BottomSheet>
    );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
    handleContainer: { alignItems: 'center', paddingTop: 8, paddingBottom: 4 },
    handle: {
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: '#8E8E93',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 8,
        gap: 8,
    },
    headerTitle: { fontSize: 16, fontWeight: '700', flex: 1 },
    connectingLabel: { fontSize: 12 },
    closeBtn: {
        paddingHorizontal: 14,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    closeBtnText: { fontSize: 13, fontWeight: '600' },
    emptyText: { textAlign: 'center', marginTop: 32, fontSize: 14 },
    optionsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingTop: 8,
        paddingBottom: 4,
        gap: 8,
    },
    circleBtn: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    modelPill: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        height: 44,
        borderRadius: 22,
        flexShrink: 1,
    },
    levelPill: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        height: 44,
        borderRadius: 22,
        flexShrink: 0,
    },
    modelPillText: {
        fontSize: 14,
        fontWeight: '600',
    },
    inputBar: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 8,
        gap: 8,
    },
    textInput: {
        flex: 1,
        fontSize: 15,
        borderRadius: 22,
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 12,
        minHeight: 44,
        maxHeight: 120,
    },
    sendBtn: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    sendBtnIcon: {
        color: '#FFFFFF',
        fontSize: 18,
        fontWeight: '700',
        lineHeight: 20,
    },
});
