import React, { useCallback } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    TouchableWithoutFeedback,
    StyleSheet,
    SafeAreaView,
    Pressable,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useTheme } from '../../../context/ThemeContext';
import { useVoiceConversation } from './useVoiceConversation';
import { VoiceOrb } from './VoiceOrb';
import { VoiceTranscript } from './VoiceTranscript';
import type { ChatStackParamList } from '../../../navigation/types';

type VoiceScreenRoute = RouteProp<ChatStackParamList, 'VoiceScreen'>;

const STATE_LABELS: Record<string, string> = {
    idle: '',
    listening: 'Listening…',
    processing: 'Thinking…',
    speaking: 'Tap to interrupt',
    error: '',
};

export function VoiceScreen() {
    const { theme, palette } = useTheme();
    const navigation = useNavigation();
    const route = useRoute<VoiceScreenRoute>();
    const { chatId } = route.params;

    const { state, liveTranscript, errorKind, interrupt, stop, openSettings } =
        useVoiceConversation({ chatId });

    const handleClose = useCallback(() => {
        stop();
        navigation.goBack();
    }, [stop, navigation]);

    const handleScreenTap = useCallback(() => {
        if (state === 'speaking') interrupt();
    }, [state, interrupt]);

    return (
        <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
            <TouchableWithoutFeedback onPress={handleScreenTap}>
                <View style={styles.container}>
                    {/* Header */}
                    <View style={styles.header}>
                        <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
                            <Text style={[styles.closeText, { color: theme.textSecondary }]}>✕</Text>
                        </TouchableOpacity>
                        <Text style={[styles.headerTitle, { color: theme.textSecondary }]}>Voice</Text>
                        <View style={styles.headerSpacer} />
                    </View>

                    {/* Orb + status */}
                    <View style={styles.orbArea}>
                        <VoiceOrb state={state} />
                        <Text style={[styles.stateLabel, { color: theme.textSecondary }]}>
                            {STATE_LABELS[state] ?? ''}
                        </Text>
                        {state === 'listening' && liveTranscript !== '' && (
                            <Text style={[styles.liveTranscript, { color: theme.textPrimary }]}>
                                "{liveTranscript}"
                            </Text>
                        )}
                        {state === 'error' && (
                            <View style={styles.errorArea}>
                                <Text style={[styles.errorText, { color: theme.textSecondary }]}>
                                    {errorKind === 'permission'
                                        ? 'Microphone access required'
                                        : 'Speech recognition unavailable'}
                                </Text>
                                {errorKind === 'permission' && (
                                    <Pressable
                                        onPress={openSettings}
                                        style={[styles.settingsBtn, { backgroundColor: theme.accent }]}
                                    >
                                        <Text style={[styles.settingsBtnText, { color: palette.white }]}>Open Settings</Text>
                                    </Pressable>
                                )}
                            </View>
                        )}
                    </View>

                    {/* Transcript history */}
                    <View style={[styles.transcriptArea, { borderTopColor: theme.border }]}>
                        <VoiceTranscript chatId={chatId} />
                    </View>
                </View>
            </TouchableWithoutFeedback>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safe: { flex: 1 },
    container: { flex: 1 },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    closeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    closeText: { fontSize: 18 },
    headerTitle: { flex: 1, textAlign: 'center', fontSize: 15, fontWeight: '500' },
    headerSpacer: { width: 36 },
    orbArea: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        paddingBottom: 24,
    },
    stateLabel: { fontSize: 13, letterSpacing: 0.5 },
    liveTranscript: { fontSize: 15, fontStyle: 'italic', textAlign: 'center', paddingHorizontal: 32 },
    errorArea: { alignItems: 'center', gap: 12 },
    errorText: { fontSize: 14, textAlign: 'center' },
    settingsBtn: { paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20 },
    settingsBtnText: { fontSize: 14, fontWeight: '500' },
    transcriptArea: { height: '35%', borderTopWidth: StyleSheet.hairlineWidth },
});
