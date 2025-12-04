import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ArrowUp,
    Microphone,
    Plus,
    XmarkCircle,
    CursorPointer,
} from 'iconoir-react-native';

import { ActionSheetIOS, Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createStyles } from './styles.tsx';
import { useChat } from '../context';
import ModelSelector from './ModelSelector';
import { useTheme } from '../../../context/ThemeContext.tsx';
import { useVoiceRecorder } from './useVoiceRecorder';
import AudioWaveform from './AudioWaveform';

type Props = {
    onSend: (text: string) => void;
};

export default function ChatInput(props: Props) {
    const [value, setValue] = useState('');
    const [modelSelectorVisible, setModelSelectorVisible] = useState(false);
    const [voiceLanguage, setVoiceLanguage] = useState('auto');

    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const styles = useMemo(() => createStyles(theme), [theme]);

    const { selectedModel, setSelectedModel, availableModels, chatMode, setChatMode, teamCommand, setTeamCommand, messages } = useChat();

    const voiceRecorder = useVoiceRecorder();

    const handleSend = useCallback(() => {
        const text = (value ?? '').trim();
        if (!text) return;
        props.onSend(text);
        Keyboard.dismiss();
        setValue('');
    }, [props, value]);

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

    const showModelPicker = useCallback(() => {
        const options = [
            ...availableModels.map(m => m.name),
            'Cancel'
        ];

        ActionSheetIOS.showActionSheetWithOptions(
            {
                options,
                cancelButtonIndex: options.length - 1,
                userInterfaceStyle: 'dark',
                title: 'Select Model',
            },
            (buttonIndex) => {
                if (buttonIndex < availableModels.length) {
                    setSelectedModel(availableModels[buttonIndex].id);
                }
            }
        );
    }, [availableModels, setSelectedModel]);

    const [isKeyboardVisible, setKeyboardVisible] = useState(false);
    const selectedModelName = useMemo(() => {
        const explicit = availableModels.find(m => m.id === selectedModel)?.name;
        if (explicit) return explicit;
        if (availableModels.length > 0) {
            return availableModels[0].name || 'Auto context';
        }
        return 'Auto context';
    }, [availableModels, selectedModel]);
    const isMicDisabled = (value?.length ?? 0) > 0 || isProcessing;
    const isSendDisabled = (value?.length ?? 0) === 0;

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
                                        onPress={() => setModelSelectorVisible(true)}
                                        style={({ pressed }) => [
                                            styles.iconBtn,
                                            pressed && styles.iconBtnPressed,
                                        ]}
                                    >
                                        <Plus
                                            width={24}
                                            height={24}
                                            color={theme.icon}
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
                                                color="#ffffff"
                                            />
                                        </View>
                                        <Text style={styles.modelButtonText}>
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
                                            color={theme.icon}
                                        />
                                    </Pressable>
                                )}
                            </>
                        )}
                    </View>
                </View>
            </View>
            <ModelSelector
                visible={modelSelectorVisible}
                onClose={() => setModelSelectorVisible(false)}
                models={availableModels}
                selectedModel={selectedModel}
                onSelectModel={setSelectedModel}
                loading={availableModels.length === 0}
                chatMode={chatMode}
                onModeChange={setChatMode}
                teamCommand={teamCommand}
                onChangeTeamCommand={setTeamCommand}
                hasChatStarted={messages.length > 0}
                voiceLanguage={voiceLanguage}
                onSelectVoiceLanguage={setVoiceLanguage}
            />
        </View>
    );
}
