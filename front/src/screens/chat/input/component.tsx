import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ArrowUp,
    Plus,
    XmarkCircle,
    CursorPointer,
    Attachment as AttachmentIcon,
    Trash,
    Camera,
    Page,
    MediaImage,
    Check,
    Group,
    User,
    Brain,
    Square
} from 'iconoir-react-native';

import { ActionSheetIOS, Keyboard, Pressable, Text, TextInput, View, Image, ActivityIndicator, ScrollView, StyleSheet, Alert, NativeModules } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createStyles } from './styles.tsx';
import { useChat } from '../context';
import { ContextMenu, ContextMenuItem } from '../../../components/ContextMenu';
import { useTheme } from '../../../context/ThemeContext.tsx';
import { useAuth } from '../../auth/context';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';
import DocumentPicker from 'react-native-document-picker';
import { apiClient } from '../../../apiClient';
import { getApiUrl, API_URL } from '../../../config';
import { AVAILABLE_TEAMS, TeamDetails } from '../teams';

type Props = {
    onSend: (text: string) => void;
};

type LocalAttachment = {
    id: string; // Server ID
    uri: string;
    type: 'image' | 'file';
    mimeType: string;
    name: string;
    loading: boolean;
};

export default function ChatInput(props: Props) {
    const [value, setValue] = useState('');
    const [modelMenuVisible, setModelMenuVisible] = useState(false);
    const [teamMenuVisible, setTeamMenuVisible] = useState(false);
    const [plusMenuVisible, setPlusMenuVisible] = useState(false);
    const [thinkingMenuVisible, setThinkingMenuVisible] = useState(false);
    const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
    const [webSearchEnabled, setWebSearchEnabled] = useState(false);

    const { theme, palette } = useTheme();
    const insets = useSafeAreaInsets();
    const styles = useMemo(() => createStyles(theme), [theme]);

    const { selectedModel, setSelectedModel, availableModels, chatMode, setChatMode, teamCommand, setTeamCommand, messages, sendMessage, selectedTeamId, selectTeam, thinkingLevel, setThinkingLevel, assistantWorking, stopGeneration } = useChat();
    const { user, updateUser } = useAuth();

    // Initialize webSearchEnabled from user preference
    useEffect(() => {
        if (user?.web_search_enabled !== undefined) {
            setWebSearchEnabled(user.web_search_enabled);
        }
    }, [user?.web_search_enabled]);



    const handleSend = useCallback(() => {
        const text = (value ?? '').trim();
        const hasAttachments = attachments.length > 0 && !attachments.some(a => a.loading);

        if (!text && !hasAttachments) return;

        // Pass full attachments (including URI) to sendMessage for optimistic updates
        sendMessage(text, attachments, webSearchEnabled, thinkingLevel);

        Keyboard.dismiss();
        setValue('');
        setAttachments([]);
        setWebSearchEnabled(false);
    }, [value, attachments, sendMessage, webSearchEnabled, thinkingLevel]);



    const uploadFile = async (uri: string, name: string, type: string, fileType: 'image' | 'file') => {
        // Optimistic add
        const tempId = Math.random().toString();
        setAttachments(prev => [...prev, {
            id: tempId,
            uri,
            type: fileType,
            mimeType: type,
            name,
            loading: true
        }]);

        try {
            const uploaded = await apiClient.uploadFile({ uri, name, type });
            setAttachments(prev => prev.map(a => a.id === tempId ? { ...a, id: uploaded.id, loading: false } : a));
        } catch (err) {
            console.error('Upload failed', err);
            // Remove failed upload
            setAttachments(prev => prev.filter(a => a.id !== tempId));
        }
    };

    useEffect(() => {
        if (attachments.length > 0) {
            setWebSearchEnabled(false);
        }
    }, [attachments]);

    const pickImage = async () => {
        console.log('PickImage called');
        try {
            if (!NativeModules.ImagePicker && !(global as any).__turboModuleProxy) {
                console.error("NativeModules.ImagePicker is null");
                Alert.alert("Error", "ImagePicker Native Module is missing.");
                return;
            }

            console.log('Calling launchImageLibrary...');
            const result = await launchImageLibrary({
                mediaType: 'photo',
                quality: 0.8,
                selectionLimit: 1,
                includeExtra: true, // Force permission check
            });
            console.log('launchImageLibrary result:', result);

            if (result.errorCode) {
                console.error('ImagePicker Error: ', result.errorMessage);
                Alert.alert('Error', result.errorMessage || 'Failed to launch image library');
                return;
            }

            if (!result.didCancel && result.assets && result.assets.length > 0) {
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
                Alert.alert('Error', result.errorMessage || 'Failed to take photo');
                return;
            }

            if (!result.didCancel && result.assets && result.assets.length > 0) {
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
                Alert.alert('Error', 'Failed to pick document: ' + (err.message || String(err)));
            }
        }
    };

    const handlePlusPress = useCallback(() => {
        setPlusMenuVisible(true);
    }, []);

    const [isPickerActive, setPickerActive] = useState(false);

    const executeWithDelay = useCallback((action: () => Promise<void>) => {
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
    }, [isPickerActive]);

    const plusMenuItems: ContextMenuItem[] = useMemo(() => [
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
            id: 'web_search',
            label: 'Web Search',
            // icon: <Globe width={20} height={20} color={webSearchEnabled ? theme.accent : "#fff"} />, // Icon is handled by switch now or can be kept if we want both? UI usually has label + switch.
            isSwitch: true,
            switchValue: webSearchEnabled,
            onPress: async () => {
                const newValue = !webSearchEnabled;
                setWebSearchEnabled(newValue); // Optimistic update
                // setPlusMenuVisible(false); // Can keep open now

                if (user) {
                    try {
                        const updatedUser = await apiClient.put<any>(`${getApiUrl()}/auth/me`, {
                            web_search_enabled: newValue
                        });
                        if (updatedUser) {
                            updateUser(updatedUser);
                        }
                    } catch (e) {
                        console.error('Failed to update web search preference', e);
                        setWebSearchEnabled(!newValue); // Revert on failure
                    }
                }
            }
        },
        {
            id: 'thinking',
            label: `Thinking: ${thinkingLevel.charAt(0).toUpperCase() + thinkingLevel.slice(1)}`,
            icon: <Brain width={20} height={20} color={thinkingLevel !== 'off' ? theme.accent : "#fff"} />,
            onPress: () => {
                setPlusMenuVisible(false);
                setTimeout(() => setThinkingMenuVisible(true), 300);
            }
        },
        {
            id: 'mode_toggle',
            label: `Mode: ${chatMode === 'team' ? 'Team' : 'Agent'}`,
            icon: chatMode === 'team' ? <Group width={20} height={20} color="#fff" /> : <User width={20} height={20} color="#fff" />,
            onPress: () => {
                const newMode = chatMode === 'agent' ? 'team' : 'agent';
                setChatMode(newMode);
                setPlusMenuVisible(false); // Close menu on toggle
            }
        },
        ...(chatMode === 'team' ? [{
            id: 'select_team',
            label: 'Select Team',
            icon: <Group width={20} height={20} color="#fff" />, // Reuse group icon
            onPress: () => {
                setPlusMenuVisible(false);
                setTimeout(() => setTeamMenuVisible(true), 300);
            }
        }] : []),
    ], [pickDocument, pickImage, takePhoto, executeWithDelay, webSearchEnabled, thinkingLevel, theme.accent, chatMode, setChatMode]);

    const removeAttachment = (id: string) => {
        setAttachments(prev => prev.filter(a => a.id !== id));
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

    const modelMenuItems: ContextMenuItem[] = useMemo(() => {
        // Filter models: when thinking is enabled, show only models that support it
        let filteredModels = thinkingLevel !== 'off'
            ? availableModels.filter(model => model.supports_thinking === true)
            : availableModels;

        // Fallback: If filtering leaves no models (e.g. user selected High thinking but no models support it yet due to API change or bug),
        // show all models to avoid empty menu.
        if (filteredModels.length === 0) {
            filteredModels = availableModels;
        }

        return filteredModels.map(model => ({
            id: model.id,
            label: model.name || model.id,
            icon: model.id === selectedModel ? (
                <Check width={20} height={20} color={theme.accent} />
            ) : undefined,
            onPress: () => {
                const selectedModelId = model.id;
                setSelectedModel(selectedModelId);
                // Team command update is handled by effect in context
                setModelMenuVisible(false);
            },
        }));
    }, [availableModels, selectedModel, setSelectedModel, theme.accent, thinkingLevel]);

    const teamMenuItems: ContextMenuItem[] = useMemo(() => {
        return AVAILABLE_TEAMS.map(team => ({
            id: team.id,
            label: team.name, // + (team.description ? ` - ${team.description}` : ''), // Keep it short
            icon: team.id === selectedTeamId ? (
                <Check width={20} height={20} color={theme.accent} />
            ) : undefined,
            onPress: () => {
                selectTeam(team.id);
                setTeamMenuVisible(false);
            },
        }));
    }, [selectedTeamId, selectTeam, theme.accent]);

    const thinkingMenuItems: ContextMenuItem[] = useMemo(() => {
        const levels = ['off', 'low', 'medium', 'high'];
        return levels.map(level => ({
            id: level,
            label: level.charAt(0).toUpperCase() + level.slice(1),
            icon: level === thinkingLevel ? (
                <Check width={20} height={20} color={theme.accent} />
            ) : undefined,
            onPress: () => {
                setThinkingLevel(level);
                setThinkingMenuVisible(false);
                // If enabling thinking (not off) and current model doesn't support it, auto-select one that does
                if (level !== 'off') {
                    const currentModelObj = availableModels.find(m => m.id === selectedModel);
                    if (!currentModelObj?.supports_thinking) {
                        const thinkingModel = availableModels.find(m => m.supports_thinking === true);
                        if (thinkingModel) {
                            setSelectedModel(thinkingModel.id);
                        }
                    }
                }
            },
        }));
    }, [thinkingLevel, setThinkingLevel, theme.accent, availableModels, selectedModel, setSelectedModel]);

    const [isKeyboardVisible, setKeyboardVisible] = useState(false);
    const selectedModelName = useMemo(() => {
        // If in team mode, show team name + model? Or just team name?
        // Let's show Team Name if in team mode, or keep showing model but maybe with an icon?
        // For now, keeping model name behavior as it drives the underlying LLM mainly.
        // Maybe we should append "- Team" if in team mode?
        let name = '';
        if (!selectedModel) {
            name = availableModels.length > 0 ? (availableModels[0].name || 'Auto context') : 'Auto context';
        } else {
            const explicit = availableModels.find(m => m.id === selectedModel)?.name;
            if (explicit) name = explicit;
            else name = selectedModel.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
        }

        if (chatMode === 'team') {
            const team = AVAILABLE_TEAMS.find(t => t.id === selectedTeamId);
            if (team) return `${team.name}`; // Show Team Name instead of model when in team mode? Or "Team: Model"? 
            // Users probably care more about "Travel Agent" being active than "Gemini 1.5"
            return `${team?.name || 'Team'}`;
        }

        return name;
    }, [availableModels, selectedModel, chatMode, selectedTeamId]);
    const isSendDisabled = ((value?.length ?? 0) === 0 && attachments.length === 0) || attachments.some(a => a.loading);

    useEffect(() => {
        const keyboardDidShowListener = Keyboard.addListener(
            'keyboardDidShow',
            () => {
                setKeyboardVisible(true);
            }
        );
        const keyboardDidHideListener = Keyboard.addListener(
            'keyboardDidHide',
            () => {
                setKeyboardVisible(false);
            }
        );

        return () => {
            keyboardDidHideListener.remove();
            keyboardDidShowListener.remove();
        };
    }, []);

    return (
        <View style={styles.container}>
            <View style={[
                styles.inputWrapper,
                { paddingBottom: isKeyboardVisible ? 12 : Math.max(insets.bottom, 12) }
            ]}>


                {/* Attachments Preview */}
                {attachments.length > 0 && (
                    <ScrollView horizontal style={{ flexDirection: 'row', padding: 8, maxHeight: 100 }} contentContainerStyle={{ gap: 8 }}>
                        {attachments.map(att => (
                            <View key={att.id} style={{ width: 80, height: 80, borderRadius: 8, overflow: 'hidden', position: 'relative', backgroundColor: theme.surface }}>
                                {att.type === 'image' ? (
                                    <Image source={{ uri: att.uri }} style={{ width: '100%', height: '100%' }} />
                                ) : (
                                    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                                        <AttachmentIcon width={24} height={24} color={theme.text} />
                                        <Text numberOfLines={1} style={{ fontSize: 10, color: theme.text, paddingHorizontal: 2 }}>{att.name}</Text>
                                    </View>
                                )}
                                {att.loading && (
                                    <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', alignItems: 'center' }}>
                                        <ActivityIndicator color="#fff" />
                                    </View>
                                )}
                                <Pressable
                                    onPress={() => removeAttachment(att.id)}
                                    style={{ position: 'absolute', top: 2, right: 2, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 10, padding: 2 }}
                                >
                                    <XmarkCircle width={16} height={16} color="#fff" />
                                </Pressable>
                            </View>
                        ))}
                    </ScrollView>
                )}

                {/* Top row: Input field */}
                <TextInput
                    multiline
                    style={styles.input}
                    placeholder={webSearchEnabled ? "Search the web" : "Type a message..."}
                    placeholderTextColor="rgba(192, 202, 245, 0.6)"
                    value={value}
                    onChangeText={setValue}
                    textAlignVertical="center"
                    autoCorrect={false}
                    returnKeyType="send"
                    onSubmitEditing={handleSend}
                    onBlur={() => Keyboard.dismiss()}
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
                            <Plus
                                width={24}
                                height={24}
                                color={theme.text}
                            />
                        </Pressable>

                        <Pressable
                            onPress={showModelPicker}
                            style={({ pressed }) => [
                                styles.modelButton,
                                thinkingLevel !== 'off' && {
                                    backgroundColor: `${palette.orange}30`,
                                    borderColor: `${palette.orange}60`,
                                },
                                pressed && styles.modelButtonPressed,
                            ]}
                        >
                            <View style={styles.modelButtonIcon}>
                                <CursorPointer
                                    width={16}
                                    height={16}
                                    color={thinkingLevel !== 'off' ? palette.orange : theme.text}
                                />
                            </View>
                            <Text
                                style={[
                                    styles.modelButtonText,
                                    thinkingLevel !== 'off' && { color: palette.orange },
                                ]}
                                numberOfLines={1}
                                ellipsizeMode="tail"
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
                                    pressed && !isSendDisabled && styles.sendBtnPressed,
                                ]}
                                disabled={isSendDisabled}
                            >
                                <ArrowUp
                                    width={24}
                                    height={24}
                                    color={theme.background}
                                />
                            </Pressable>
                        )}
                    </View>
                </View>
            </View>


            <ContextMenu
                visible={modelMenuVisible}
                onClose={() => setModelMenuVisible(false)}
                items={modelMenuItems}
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
                visible={thinkingMenuVisible}
                onClose={() => setThinkingMenuVisible(false)}
                items={thinkingMenuItems}
                position="bottom-left"
                title="Thinking Level"
            />


        </View>
    );
}
