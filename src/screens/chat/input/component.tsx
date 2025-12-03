import React, { useCallback, useMemo, useState } from 'react';
import {
    Send,
    MicrophoneSpeakingSolid,
    MicrophoneMuteSolid,
    Plus,
} from 'iconoir-react-native';

import { Keyboard, Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createStyles } from './styles.tsx';
import { useChat } from '../context';
import ModelSelector from './ModelSelector';
import { useTheme } from '../../../context/ThemeContext.tsx';

type Props = {
    onSend: (text: string) => void;
};

export default function ChatInput(props: Props) {
    const [value, setValue] = useState('');
    const [recording, setRecording] = useState(false);
    const [modelSelectorVisible, setModelSelectorVisible] = useState(false);

    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const styles = useMemo(() => createStyles(theme), [theme]);

    const { selectedModel, setSelectedModel, availableModels, chatMode, setChatMode, teamCommand, setTeamCommand, messages } = useChat();

    const handleSend = useCallback(() => {
        const text = (value ?? '').trim();
        if (!text) return;
        props.onSend(text);
        // setInputHeight(minHeight);
        Keyboard.dismiss();
        setValue('');
    }, [props, value]);

    const toggleRecord = useCallback(() => {
        // Stub for voice recording. Wire real speech-to-text later.
        setRecording(r => !r);
    }, []);

    return (
        <View style={styles.container}>
            <View style={[
                styles.inputWrapper,
                { paddingBottom: Math.max(insets.bottom, 12) + 12 }
            ]}>
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
                />
                <Pressable
                    onPress={toggleRecord}
                    disabled={(value?.length ?? 0) > 0}
                    style={[
                        styles.iconBtn,
                        recording && styles.iconBtnActive,
                        (value?.length ?? 0) > 0 && styles.iconBtnDisabled,
                    ]}
                >
                    {recording ? (
                        <MicrophoneSpeakingSolid
                            width={28}
                            height={28}
                            color={theme.attention}
                        />
                    ) : (
                        <MicrophoneMuteSolid
                            width={28}
                            height={28}
                            color={theme.icon}
                        />
                    )}
                </Pressable>
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
