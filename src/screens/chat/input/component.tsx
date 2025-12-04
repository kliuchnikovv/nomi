import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Send,
    MicrophoneSpeakingSolid,
    MicrophoneMuteSolid,
    Plus,
    XmarkCircle,
} from 'iconoir-react-native';

import { Keyboard, Pressable, TextInput, View } from 'react-native';
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
            await voiceRecorder.startRecording();
        } else if (voiceRecorder.state === 'recording') {
            await voiceRecorder.stopRecording();
        }
    }, [voiceRecorder]);

    // When transcription is complete, insert it into the input
    useEffect(() => {
        if (voiceRecorder.transcribedText && voiceRecorder.state === 'idle') {
            setValue(voiceRecorder.transcribedText);
            voiceRecorder.reset();
        }
    }, [voiceRecorder.transcribedText, voiceRecorder.state]);

    const isRecording = voiceRecorder.state === 'recording';
    const isProcessing = voiceRecorder.state === 'processing';

    return (
        <View style={styles.container}>
            <View style={[
                styles.inputWrapper,
                { paddingBottom: Math.max(insets.bottom, 12) + 12 }
            ]}>
                {!isRecording && !isProcessing && (
                    <Pressable
                        onPress={() => setModelSelectorVisible(true)}
                        style={({ pressed }) => [
                            styles.iconBtn,
                            pressed && {
                                backgroundColor: 'rgba(192, 202, 245, 0.1)',
                            },
                        ]}
                    >
                        <Plus
                            width={28}
                            height={28}
                            color={theme.icon}
                        />
                    </Pressable>
                )}

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
                    />
                )}

                <Pressable
                    onPress={toggleRecord}
                    disabled={(value?.length ?? 0) > 0 || isProcessing}
                    style={[
                        styles.iconBtn,
                        isRecording && styles.stopBtn,
                        ((value?.length ?? 0) > 0 || isProcessing) && styles.iconBtnDisabled,
                    ]}
                >
                    {isRecording ? (
                        <XmarkCircle
                            width={28}
                            height={28}
                            color="#ffffff"
                        />
                    ) : isProcessing ? (
                        <MicrophoneSpeakingSolid
                            width={28}
                            height={28}
                            color={theme.icon}
                        />
                    ) : (
                        <MicrophoneMuteSolid
                            width={28}
                            height={28}
                            color={theme.icon}
                        />
                    )}
                </Pressable>

                {!isRecording && !isProcessing && (
                    <Pressable
                        onPress={handleSend}
                        style={({ pressed }) => [
                            styles.sendBtn,
                            pressed && {
                                backgroundColor: 'rgba(192, 202, 245, 0.1)',
                            },
                        ]}
                        disabled={(value?.length ?? 0) === 0}
                    >
                        <Send
                            width={28}
                            height={28}
                            color={theme.icon}
                            style={styles.sendBtn}
                        />
                    </Pressable>
                )}
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
            />
        </View>
    );
}
