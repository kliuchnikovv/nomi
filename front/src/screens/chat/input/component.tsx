import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ArrowUp,
    Plus,
    XmarkCircle,
    Attachment as AttachmentIcon,
    Trash,
    Camera,
    Page,
    MediaImage,
    Check,
    Group,
    User,
    Square,
    Eye,
    EyeClosed,
    MagicWand,
    Code,
    MapPin,
} from 'iconoir-react-native';

import {
    ActionSheetIOS,
    Keyboard,
    Pressable,
    Text,
    TextInput,
    View,
    Image,
    ActivityIndicator,
    ScrollView,
    StyleSheet,
    Alert,
    NativeModules,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createStyles } from './styles.tsx';
import { useChat } from '../context';
import {
    ContextMenu,
    ContextMenuItem,
    ContextMenuSection,
} from '../../../components/ContextMenu';
import { useTheme } from '../../../context/ThemeContext.tsx';
import { useAuth } from '../../auth/context';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';
import DocumentPicker from 'react-native-document-picker';
import { apiClient } from '../../../apiClient';
import { useMain } from '../../main/context';
import { getApiUrl, API_URL } from '../../../config';
import { AVAILABLE_TEAMS, TeamDetails } from '../teams';
import { ContextItem, ContextItemCard } from '../components/ContextItemCard';
import { contextStore } from '../../../services/ContextStore';
import { LocationPickerModal } from './LocationPickerModal';

type Props = {
    onSend: (text: string) => void;
};

type LocalAttachment = {
    id: string; // Server ID
    uri: string;
    type: 'image' | 'file';
    mimeType: string;
    file_type?: string;
    name: string;
    loading: boolean;
};

export default function ChatInput(props: Props) {
    const [value, setValue] = useState('');
    const [modelMenuVisible, setModelMenuVisible] = useState(false);
    const [teamMenuVisible, setTeamMenuVisible] = useState(false);
    const [plusMenuVisible, setPlusMenuVisible] = useState(false);
    const [detailMenuVisible, setDetailMenuVisible] = useState(false);
    const [locationPickerVisible, setLocationPickerVisible] = useState(false);

    const [attachments, setAttachments] = useState<LocalAttachment[]>([]);

    const [contextItems, setContextItems] = useState<ContextItem[]>([]);

    const { theme, palette } = useTheme();
    const insets = useSafeAreaInsets();
    const styles = useMemo(() => createStyles(theme), [theme]);
    const {
        selectedModel,
        setSelectedModel,
        availableModels,
        chatMode,
        setChatMode,
        teamCommand,
        setTeamCommand,
        messages,
        sendMessage,
        selectedTeamId,
        selectTeam,
        thinkingLevel,
        setThinkingLevel,
        assistantWorking,
        stopGeneration,
        detailLevel,
        setDetailLevel,
        showToolCalls,
        pendingInputText,
        setPendingInputText,
    } = useChat();
    const { user, updateUser } = useAuth();
    const { activeChatID } = useMain();

    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSend = useCallback(async () => {
        console.log('[ChatInput] handleSend called');
        console.log('[ChatInput] contextItems count:', contextItems.length);
        console.log('[ChatInput] contextItems:', contextItems);

        if (isSubmitting) return;
        const text = (value ?? '').trim();
        const hasAttachments =
            attachments.length > 0 && !attachments.some(a => a.loading);

        if (!text && !hasAttachments) return;

        setIsSubmitting(true);
        try {
            // Send text with context items
            await sendMessage(
                text,
                attachments,
                true,
                thinkingLevel,
                'user',
                contextItems,
            );
        } finally {
            setIsSubmitting(false);
        }

        Keyboard.dismiss();
        setValue('');
        setAttachments([]);
        // Clear context items after sending - they are now part of the message
        contextStore.clear();
    }, [
        value,
        attachments,
        contextItems,
        sendMessage,
        thinkingLevel,
        isSubmitting,
    ]);

    // Reset input when switching chats
    useEffect(() => {
        setValue('');
        setAttachments([]);
        // Don't clear context when switching chats - context should persist across messages
    }, [activeChatID]);

    // Restore message text to input when model is changed after an error
    useEffect(() => {
        if (pendingInputText !== null) {
            setValue(pendingInputText);
            setPendingInputText(null);
        }
    }, [pendingInputText, setPendingInputText]);

    // Listen for context item changes
    useEffect(() => {
        console.log('[ChatInput] Setting up contextStore subscription');
        const unsub = contextStore.subscribe(() => {
            const items = contextStore.getAll();
            console.log(
                '[ChatInput] Context updated, items count:',
                items.length,
            );
            console.log('[ChatInput] Context items:', items);
            setContextItems(items);
        });

        // Load initial items
        const initialItems = contextStore.getAll();
        console.log('[ChatInput] Initial context items:', initialItems.length);
        if (initialItems.length > 0) {
            setContextItems(initialItems);
        }

        return unsub;
    }, []);

    const uploadFile = async (
        uri: string,
        name: string,
        type: string,
        fileType: 'image' | 'file',
    ) => {
        // Optimistic add
        const tempId = Math.random().toString();
        setAttachments(prev => [
            ...prev,
            {
                id: tempId,
                uri,
                type: fileType,
                mimeType: type,
                name,
                loading: true,
            },
        ]);

        try {
            const uploaded = await apiClient.uploadFile({ uri, name, type });
            setAttachments(prev =>
                prev.map(a =>
                    a.id === tempId
                        ? { ...a, id: uploaded.id, loading: false }
                        : a,
                ),
            );
        } catch (err) {
            console.error('Upload failed', err);
            // Remove failed upload
            setAttachments(prev => prev.filter(a => a.id !== tempId));
        }
    };

    const pickImage = async () => {
        console.log('PickImage called');
        try {
            if (
                !NativeModules.ImagePicker &&
                !(global as any).__turboModuleProxy
            ) {
                console.error('NativeModules.ImagePicker is null');
                Alert.alert('Error', 'ImagePicker Native Module is missing.');
                return;
            }

            console.log('Calling launchImageLibrary...');
            const result = await launchImageLibrary({
                mediaType: 'photo',
                quality: 0.8,
                selectionLimit: 5,
                includeExtra: true, // Force permission check
            });
            console.log('launchImageLibrary result:', result);

            if (result.errorCode) {
                console.error('ImagePicker Error: ', result.errorMessage);
                Alert.alert(
                    'Error',
                    result.errorMessage || 'Failed to launch image library',
                );
                return;
            }

            if (
                !result.didCancel &&
                result.assets &&
                result.assets.length > 0
            ) {
                const asset = result.assets[0];
                const name = asset.fileName || 'image.jpg';
                const type = asset.type || 'image/jpeg';
                const uri = asset.uri!;
                await uploadFile(uri, name, type, 'image');
            }
        } catch (error: any) {
            console.error('pickImage error:', error);
            Alert.alert('Error', 'Failed to pick image: ' + error.message);
        }
    };

    const takePhoto = async () => {
        console.log('TakePhoto called');
        try {
            console.log('Calling launchCamera...');
            const result = await launchCamera({
                mediaType: 'photo',
                quality: 0.8,
                saveToPhotos: false,
                includeExtra: true, // Force permission check
            });
            console.log('launchCamera result:', result);

            if (result.errorCode) {
                console.error('Camera Error: ', result.errorMessage);
                Alert.alert(
                    'Error',
                    result.errorMessage || 'Failed to take photo',
                );
                return;
            }

            if (
                !result.didCancel &&
                result.assets &&
                result.assets.length > 0
            ) {
                const asset = result.assets[0];
                const name = asset.fileName || 'camera_photo.jpg';
                const type = asset.type || 'image/jpeg';
                const uri = asset.uri!;
                await uploadFile(uri, name, type, 'image');
            }
        } catch (error: any) {
            console.error('takePhoto error:', error);
            Alert.alert('Error', 'Failed to take photo: ' + error.message);
        }
    };

    const pickDocument = async () => {
        try {
            const result = await DocumentPicker.pick({
                type: [DocumentPicker.types.allFiles],
                copyTo: 'cachesDirectory',
            });

            if (result && result.length > 0) {
                const asset = result[0];
                const name = asset.name || 'document';
                const type = asset.type || 'application/octet-stream';
                await uploadFile(asset.uri, name, type, 'file');
            }
        } catch (err: any) {
            if (DocumentPicker.isCancel(err)) {
                // User cancelled
            } else {
                console.error('pickDocument error:', err);
                Alert.alert(
                    'Error',
                    'Failed to pick document: ' + (err.message || String(err)),
                );
            }
        }
    };

    const handlePlusPress = useCallback(() => {
        setPlusMenuVisible(true);
    }, []);

    const [isPickerActive, setPickerActive] = useState(false);

    const executeWithDelay = useCallback(
        (action: () => Promise<void>) => {
            if (isPickerActive) return;
            setPlusMenuVisible(false);
            setPickerActive(true);

            // Wait for menu close animation
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

    const selectedModelName = useMemo(() => {
        // If in team mode, we still show the model name in the input bar
        // because the team name is now displayed in the header.
        let name = '';
        if (!selectedModel) {
            name =
                availableModels.length > 0
                    ? availableModels[0].name || 'Auto context'
                    : 'Auto context';
        } else {
            const explicit = availableModels.find(
                m => m.id === selectedModel,
            )?.name;
            if (explicit) name = explicit;
            else
                name = selectedModel
                    .split('-')
                    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                    .join(' ');
        }
        return name;
    }, [availableModels, selectedModel]);

    const visionSupported = useMemo(
        () =>
            availableModels.find(m => m.id === selectedModel)?.supports_vision ??
            false,
        [availableModels, selectedModel],
    );

    useEffect(() => {
        if (!visionSupported && attachments.length > 0) {
            setAttachments([]);
        }
    }, [visionSupported]);

    const plusMenuItems: ContextMenuItem[] = useMemo(
        () => [
            {
                id: 'files',
                label: 'Files',
                icon: <AttachmentIcon width={20} height={20} color="#fff" />,
                onPress: () => executeWithDelay(pickDocument),
            },
            ...(visionSupported
                ? [
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
                  ]
                : []),
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
        [
            visionSupported,
            pickDocument,
            pickImage,
            takePhoto,
            executeWithDelay,
            theme.accent,
            detailLevel,
            setDetailLevel,
        ],
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
        [detailLevel, setDetailLevel, theme.accent],
    );

    const removeAttachment = (id: string) => {
        setAttachments(prev => prev.filter(a => a.id !== id));
    };

    const removeContextItem = (id: string) => {
        console.log('[ChatInput] Removing context item:', id);
        contextStore.remove(id);
    };

    // Helper to build default team command if switching model in team mode
    const buildDefaultTeamCommand = useCallback((modelId: string) => {
        return {
            name: 'Default Team',
            model: modelId,
            participants: [
                { type: 'mailer', model: modelId },
                { type: 'rag', model: modelId },
                { type: 'memoriser', model: modelId },
            ],
        };
    }, []);

    const showModelPicker = useCallback(() => {
        setModelMenuVisible(true);
    }, []);

    const modelMenuSections: ContextMenuSection[] = useMemo(() => {
        // Filter models: when thinking is enabled, show only models that support it
        let filteredModels =
            thinkingLevel !== 'off'
                ? availableModels.filter(
                      model => model.supports_thinking === true,
                  )
                : availableModels;

        if (filteredModels.length === 0) {
            filteredModels = availableModels;
        }

        const providerDisplayName = (provider: string | undefined) =>
            provider
                ? provider.charAt(0).toUpperCase() +
                  provider.slice(1).toLowerCase()
                : 'Other';

        const byProvider = new Map<string, ContextMenuItem[]>();
        for (const model of filteredModels) {
            const provider = model.provider ?? 'other';
            const items = byProvider.get(provider) ?? [];
            items.push({
                id: model.id,
                label: model.name || model.id,
                icon:
                    model.id === selectedModel ? (
                        <Check width={20} height={20} color={theme.accent} />
                    ) : undefined,
                onPress: () => {
                    setSelectedModel(model.id);
                    setModelMenuVisible(false);
                },
            });
            byProvider.set(provider, items);
        }

        return Array.from(byProvider.entries()).map(([provider, items]) => ({
            title: providerDisplayName(provider),
            items,
        }));
    }, [
        availableModels,
        selectedModel,
        setSelectedModel,
        theme.accent,
        thinkingLevel,
    ]);

    const teamMenuItems: ContextMenuItem[] = useMemo(() => {
        return AVAILABLE_TEAMS.map(team => ({
            id: team.id,
            label: team.name, // + (team.description ? ` - ${team.description}` : ''), // Keep it short
            icon:
                team.id === selectedTeamId ? (
                    <Check width={20} height={20} color={theme.accent} />
                ) : undefined,
            onPress: () => {
                selectTeam(team.id);
                setTeamMenuVisible(false);
            },
        }));
    }, [selectedTeamId, selectTeam, theme.accent]);

    const isSendDisabled =
        ((value?.length ?? 0) === 0 &&
            attachments.length === 0 &&
            contextItems.length === 0) ||
        attachments.some(a => a.loading);

    return (
        <View style={styles.container}>
            <View style={[styles.inputWrapper, { paddingBottom: 12 }]}>
                {/* Context Items Preview */}
                {contextItems.length > 0 && (
                    <ScrollView
                        horizontal
                        style={{ padding: 8, maxHeight: 100 }}
                        contentContainerStyle={{ gap: 8 }}
                    >
                        {contextItems.map(item => (
                            <View key={item.id} style={{ width: 230 }}>
                                <ContextItemCard
                                    item={item}
                                    onRemove={removeContextItem}
                                />
                            </View>
                        ))}
                    </ScrollView>
                )}

                {/* Attachments Preview */}
                {attachments.length > 0 && (
                    <ScrollView
                        horizontal
                        style={{
                            flexDirection: 'row',
                            padding: 8,
                            maxHeight: 100,
                        }}
                        contentContainerStyle={{ gap: 8 }}
                    >
                        {attachments.map(att => (
                            <View
                                key={att.id}
                                style={{
                                    width: 80,
                                    height: 80,
                                    borderRadius: 8,
                                    overflow: 'hidden',
                                    position: 'relative',
                                    backgroundColor: theme.surface,
                                }}
                            >
                                {att.type === 'image' ? (
                                    <Image
                                        source={{ uri: att.uri }}
                                        style={{
                                            width: '100%',
                                            height: '100%',
                                        }}
                                    />
                                ) : (
                                    <View
                                        style={{
                                            flex: 1,
                                            justifyContent: 'center',
                                            alignItems: 'center',
                                        }}
                                    >
                                        <AttachmentIcon
                                            width={24}
                                            height={24}
                                            color={theme.text}
                                        />
                                        <Text
                                            numberOfLines={1}
                                            style={{
                                                fontSize: 10,
                                                color: theme.text,
                                                paddingHorizontal: 2,
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
                                            backgroundColor: 'rgba(0,0,0,0.3)',
                                            justifyContent: 'center',
                                            alignItems: 'center',
                                        }}
                                    >
                                        <ActivityIndicator color="#fff" />
                                    </View>
                                )}
                                <Pressable
                                    onPress={() => removeAttachment(att.id)}
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
                                        width={16}
                                        height={16}
                                        color="#fff"
                                    />
                                </Pressable>
                            </View>
                        ))}
                    </ScrollView>
                )}

                {/* Top row: Input field */}
                <TextInput
                    multiline
                    autoCapitalize="sentences"
                    style={styles.input}
                    placeholder="Type a message..."
                    placeholderTextColor="rgba(192, 202, 245, 0.6)"
                    value={value}
                    onChangeText={setValue}
                    textAlignVertical="center"
                    autoCorrect={false}
                    returnKeyType="send"
                    onSubmitEditing={handleSend}
                    onBlur={() => Keyboard.dismiss()}
                    keyboardAppearance="dark"
                />

                {/* Bottom row: Buttons */}
                <View style={styles.buttonRow}>
                    <View style={styles.leftActions}>
                        <Pressable
                            onPress={handlePlusPress}
                            style={({ pressed }) => [
                                styles.iconBtn,
                                pressed && styles.iconBtnPressed,
                            ]}
                        >
                            <Plus width={24} height={24} color={theme.text} />
                        </Pressable>
                        <Pressable
                            onPress={showModelPicker}
                            style={({ pressed }) => [
                                styles.modelButton,
                                pressed && styles.modelButtonPressed,
                            ]}
                        >
                            <Text
                                style={styles.modelButtonText}
                                numberOfLines={1}
                            >
                                {selectedModelName}
                            </Text>
                        </Pressable>
                    </View>

                    <View style={styles.rightActions}>
                        {assistantWorking ? (
                            <Pressable
                                onPress={stopGeneration}
                                style={({ pressed }) => [
                                    styles.sendBtn,
                                    { backgroundColor: '#e74c3c' },
                                    pressed && { opacity: 0.7 },
                                ]}
                            >
                                <Square
                                    width={16}
                                    height={16}
                                    color={theme.background}
                                    fill={theme.background}
                                />
                            </Pressable>
                        ) : (
                            <Pressable
                                onPress={handleSend}
                                style={({ pressed }) => [
                                    styles.sendBtn,
                                    isSendDisabled && styles.iconBtnDisabled,
                                    pressed &&
                                        !isSendDisabled &&
                                        !isSubmitting &&
                                        styles.sendBtnPressed,
                                ]}
                                disabled={isSendDisabled || isSubmitting}
                            >
                                {isSubmitting ? (
                                    <ActivityIndicator
                                        size="small"
                                        color={theme.background}
                                    />
                                ) : (
                                    <ArrowUp
                                        width={24}
                                        height={24}
                                        color={theme.background}
                                    />
                                )}
                            </Pressable>
                        )}
                    </View>
                </View>
            </View>

            <ContextMenu
                visible={modelMenuVisible}
                onClose={() => setModelMenuVisible(false)}
                sections={modelMenuSections}
                position="bottom-left"
                title="Select Model"
            />

            <ContextMenu
                visible={teamMenuVisible}
                onClose={() => setTeamMenuVisible(false)}
                items={teamMenuItems}
                position="bottom-left"
                title="Select Team"
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
                title="Select Detail Level"
            />

            <LocationPickerModal
                visible={locationPickerVisible}
                onClose={() => setLocationPickerVisible(false)}
            />
        </View>
    );
}
