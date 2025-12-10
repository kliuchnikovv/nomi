import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ArrowUp,
    Microphone,
    Plus,
    XmarkCircle,
    CursorPointer,
    Attachment as AttachmentIcon,
    Trash,
    Camera,
    Page,
    MediaImage,
    Translate,
    Check,
    Globe
} from 'iconoir-react-native';

import { ActionSheetIOS, Keyboard, Pressable, Text, TextInput, View, Image, ActivityIndicator, ScrollView, StyleSheet, Alert, NativeModules } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createStyles } from './styles.tsx';
import { useChat } from '../context';
import { ContextMenu, ContextMenuItem } from '../../../components/ContextMenu';
import { useTheme } from '../../../context/ThemeContext.tsx';
import { useVoiceRecorder } from './useVoiceRecorder';
import AudioWaveform from './AudioWaveform';
import { launchImageLibrary, launchCamera } from 'react-native-image-picker';
import DocumentPicker from 'react-native-document-picker';
import { apiClient } from '../../../apiClient';

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
    const [plusMenuVisible, setPlusMenuVisible] = useState(false);
    const [voiceLanguageMenuVisible, setVoiceLanguageMenuVisible] = useState(false);
    const [voiceLanguage, setVoiceLanguage] = useState('auto');
    const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
    const [webSearchEnabled, setWebSearchEnabled] = useState(false);

    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const styles = useMemo(() => createStyles(theme), [theme]);

    const { selectedModel, setSelectedModel, availableModels, chatMode, setChatMode, teamCommand, setTeamCommand, messages, sendMessage } = useChat();

    const voiceRecorder = useVoiceRecorder();

    const handleSend = useCallback(() => {
        const text = (value ?? '').trim();
        const hasAttachments = attachments.length > 0 && !attachments.some(a => a.loading);

        if (!text && !hasAttachments) return;

        // Pass full attachments (including URI) to sendMessage for optimistic updates
        sendMessage(text, attachments, webSearchEnabled);

        Keyboard.dismiss();
        setValue('');
        setAttachments([]);
        setWebSearchEnabled(false);
    }, [value, attachments, sendMessage, webSearchEnabled]);

    const toggleRecord = useCallback(async () => {
        if (voiceRecorder.state === 'idle') {
            await voiceRecorder.startRecording(voiceLanguage === 'auto' ? undefined : voiceLanguage);
        } else if (voiceRecorder.state === 'recording') {
            await voiceRecorder.stopRecording();
        }
    }, [voiceRecorder, voiceLanguage]);

    // When transcription is complete, insert it into the input
    useEffect(() => {
        if (voiceRecorder.transcribedText && voiceRecorder.state === 'idle') {
            setValue(voiceRecorder.transcribedText);
            voiceRecorder.reset();
        }
    }, [voiceRecorder.transcribedText, voiceRecorder.state]);

    const isRecording = voiceRecorder.state === 'recording';
    const isProcessing = voiceRecorder.state === 'processing';

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

    const pickImage = async () => {
        console.log('PickImage called');
        try {
            if (!NativeModules.ImagePicker && !global.__turboModuleProxy) {
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
            icon: <Globe width={20} height={20} color={webSearchEnabled ? theme.accent : "#fff"} />,
            onPress: () => {
                setWebSearchEnabled(prev => !prev);
                setPlusMenuVisible(false);
            }
        },
        {
            id: 'voice_language',
            label: `Voice Language: ${voiceLanguage === 'auto' ? 'Auto' : voiceLanguage}`,
            icon: <Translate width={20} height={20} color="#fff" />,
            onPress: () => {
                // Close main menu and open language menu
                setPlusMenuVisible(false);
                setTimeout(() => setVoiceLanguageMenuVisible(true), 300);
            },
        }
    ], [voiceLanguage, pickDocument, pickImage, takePhoto, executeWithDelay, webSearchEnabled, theme.accent]);

    const voiceLanguageItems: ContextMenuItem[] = useMemo(() => [
        { id: 'auto', label: 'Auto (Device Default)', onPress: () => setVoiceLanguage('auto') },
        { id: 'en-US', label: 'English', onPress: () => setVoiceLanguage('en-US') },
        { id: 'ru-RU', label: 'Russian', onPress: () => setVoiceLanguage('ru-RU') },
        { id: 'es-ES', label: 'Spanish', onPress: () => setVoiceLanguage('es-ES') },
        { id: 'de-DE', label: 'German', onPress: () => setVoiceLanguage('de-DE') },
        { id: 'fr-FR', label: 'French', onPress: () => setVoiceLanguage('fr-FR') },
    ].map(item => ({
        ...item,
        icon: item.id === voiceLanguage ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.accent }} /> : undefined
    })), [voiceLanguage, theme.accent]);

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
        return availableModels.map(model => ({
            id: model.id,
            label: model.name || model.id,
            icon: model.id === selectedModel ? (
                <Check width={20} height={20} color={theme.accent} />
            ) : undefined,
            onPress: () => {
                const selectedModelId = model.id;
                setSelectedModel(selectedModelId);

                if (chatMode === 'team') {
                    setTeamCommand(buildDefaultTeamCommand(selectedModelId));
                }
                setModelMenuVisible(false);
            },
        }));
    }, [availableModels, selectedModel, chatMode, setTeamCommand, buildDefaultTeamCommand, theme.accent]);

    const [isKeyboardVisible, setKeyboardVisible] = useState(false);
    const selectedModelName = useMemo(() => {
        if (!selectedModel) {
            if (availableModels.length > 0) {
                return availableModels[0].name || 'Auto context';
            }
            return 'Auto context';
        }
        const explicit = availableModels.find(m => m.id === selectedModel)?.name;
        if (explicit) return explicit;

        // If selected model is not in the list, show it formatted or as-is
        // e.g. gemini-2.0-flash-exp -> Gemini 2.0 Flash Exp
        return selectedModel
            .split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }, [availableModels, selectedModel]);
    const isMicDisabled = ((value?.length ?? 0) > 0 || isProcessing) && attachments.length === 0;
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
                {(attachments.length > 0 || webSearchEnabled) && (
                    <ScrollView horizontal style={{ flexDirection: 'row', padding: 8, maxHeight: 100 }} contentContainerStyle={{ gap: 8 }}>
                        {webSearchEnabled && (
                            <View style={{ width: 80, height: 80, borderRadius: 8, overflow: 'hidden', position: 'relative', backgroundColor: theme.surface, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: theme.accent }}>
                                <Globe width={24} height={24} color={theme.accent} />
                                <Text numberOfLines={1} style={{ fontSize: 10, color: theme.accent, paddingHorizontal: 2, marginTop: 4 }}>Web Search</Text>
                                <Pressable
                                    onPress={() => setWebSearchEnabled(false)}
                                    style={{ position: 'absolute', top: 2, right: 2, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 10, padding: 2 }}
                                >
                                    <XmarkCircle width={16} height={16} color="#fff" />
                                </Pressable>
                            </View>
                        )}
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

                {/* Top row: Input field or waveform */}
                {isRecording ? (
                    <AudioWaveform
                        audioLevels={voiceRecorder.audioLevels}
                        duration={voiceRecorder.duration}
                        maxDuration={voiceRecorder.maxDuration}
                    />
                ) : (
                    <TextInput
                        multiline
                        style={styles.input}
                        placeholder="Type a message..."
                        placeholderTextColor="rgba(192, 202, 245, 0.6)"
                        value={value}
                        onChangeText={setValue}
                        textAlignVertical="center"
                        autoCorrect={false}
                        returnKeyType="send"
                        onSubmitEditing={handleSend}
                        editable={!isProcessing}
                        onBlur={() => Keyboard.dismiss()}
                    />
                )}

                {/* Bottom row: Buttons */}
                <View style={styles.buttonRow}>
                    <View style={styles.leftActions}>
                        {isRecording ? (
                            <Pressable
                                onPress={voiceRecorder.cancelRecording}
                                style={({ pressed }) => [
                                    styles.iconBtn,
                                    styles.cancelBtn,
                                    pressed && styles.iconBtnPressed,
                                ]}
                            >
                                <XmarkCircle
                                    width={24}
                                    height={24}
                                    color="#ffffff"
                                />
                            </Pressable>
                        ) : (
                            !isProcessing && (
                                <>
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
                                            pressed && styles.modelButtonPressed,
                                        ]}
                                    >
                                        <View style={styles.modelButtonIcon}>
                                            <CursorPointer
                                                width={16}
                                                height={16}
                                                color={theme.text}
                                            />
                                        </View>
                                        <Text
                                            style={styles.modelButtonText}
                                            numberOfLines={1}
                                            ellipsizeMode="tail"
                                        >
                                            {selectedModelName}
                                        </Text>
                                    </Pressable>
                                </>
                            )
                        )}
                    </View>

                    <View style={styles.rightActions}>
                        {isRecording && (
                            <Pressable
                                onPress={toggleRecord}
                                style={({ pressed }) => [
                                    styles.sendBtn,
                                    pressed && styles.sendBtnPressed,
                                ]}
                            >
                                <Microphone
                                    width={24}
                                    height={24}
                                    color={theme.icon}
                                />
                            </Pressable>
                        )}
                        {!isRecording && (
                            <>
                                <Pressable
                                    onPress={toggleRecord}
                                    disabled={isMicDisabled}
                                    style={({ pressed }) => [
                                        styles.iconBtn,
                                        isMicDisabled && styles.iconBtnDisabled,
                                        pressed && !isMicDisabled && styles.iconBtnPressed,
                                    ]}
                                >
                                    <Microphone
                                        width={24}
                                        height={24}
                                        color={theme.icon}
                                    />
                                </Pressable>

                                {!isProcessing && (
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
                            </>
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
                visible={plusMenuVisible}
                onClose={() => setPlusMenuVisible(false)}
                items={plusMenuItems}
                position="bottom-left"
            />

            <ContextMenu
                visible={voiceLanguageMenuVisible}
                onClose={() => setVoiceLanguageMenuVisible(false)}
                items={voiceLanguageItems}
                title="Select Voice Language"
                position="center"
            />
        </View>
    );
}
