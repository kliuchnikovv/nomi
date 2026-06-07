import React, { useCallback, useRef } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    TouchableWithoutFeedback,
    StyleSheet,
    Pressable,
    ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { Xmark } from 'iconoir-react-native';
import { useTheme } from '../../../context/ThemeContext';
import { useVoiceConversation } from './useVoiceConversation';
import { VoiceOrb } from './VoiceOrb';
import { VoiceTranscript } from './VoiceTranscript';
import type { ChatStackParamList } from '../../../navigation/types';

type VoiceScreenRoute = RouteProp<ChatStackParamList, 'VoiceScreen'>;

export function VoiceScreen() {
    const { theme, palette } = useTheme();
    const insets = useSafeAreaInsets();
    const navigation = useNavigation();
    const route = useRoute<VoiceScreenRoute>();
    const { chatId } = route.params;

    const {
        state,
        liveTranscript,
        errorKind,
        detectedLanguage,
        modelProgress,
        interrupt,
        stop,
        openSettings,
    } = useVoiceConversation({ chatId });

    const modelPercent =
        modelProgress?.progress != null
            ? Math.round(modelProgress.progress * 100)
            : null;

    const closingRef = useRef(false);
    const handleClose = useCallback(() => {
        if (closingRef.current) return;
        closingRef.current = true;
        stop();
        navigation.goBack();
    }, [stop, navigation]);

    const handleScreenTap = useCallback(() => {
        if (state === 'speaking') interrupt();
    }, [state, interrupt]);

    return (
        <View style={[styles.safe, { backgroundColor: theme.background }]}>
            {/* Header stays outside TouchableWithoutFeedback */}
            <View
                style={[
                    styles.header,
                    {
                        paddingTop: insets.top + 12,
                        backgroundColor: `${theme.accent}1F`,
                        borderBottomColor: `${theme.accent}40`,
                    },
                ]}
            >
                <TouchableOpacity
                    onPress={handleClose}
                    style={[
                        styles.headerBtn,
                        { backgroundColor: `${theme.accent}20` },
                    ]}
                    accessibilityLabel="Close voice mode"
                    accessibilityRole="button"
                >
                    <Xmark
                        width={20}
                        height={20}
                        color={theme.textPrimary}
                        strokeWidth={2}
                    />
                </TouchableOpacity>
                <Text
                    style={[styles.headerTitle, { color: theme.textPrimary }]}
                >
                    Voice
                </Text>
                <View style={styles.headerBtn} />
            </View>

            <View style={styles.contentArea}>
                {/* Orb area — tap anywhere here to interrupt */}
                <TouchableWithoutFeedback onPress={handleScreenTap}>
                    <View style={styles.orbArea}>
                        <VoiceOrb state={state} />
                        {state === 'loading' && (
                            <View style={styles.errorArea}>
                                <ActivityIndicator color={theme.accent} />
                                <Text
                                    style={[
                                        styles.errorText,
                                        { color: theme.textSecondary },
                                    ]}
                                >
                                    {modelPercent != null
                                        ? `Preparing voice model… ${modelPercent}%`
                                        : 'Preparing voice model…'}
                                </Text>
                            </View>
                        )}
                        {detectedLanguage != null &&
                            (state === 'listening' || state === 'speaking') && (
                                <View
                                    style={[
                                        styles.langBadge,
                                        {
                                            backgroundColor: `${theme.accent}20`,
                                            borderColor: `${theme.accent}40`,
                                        },
                                    ]}
                                >
                                    <Text
                                        style={[
                                            styles.langBadgeText,
                                            { color: theme.textSecondary },
                                        ]}
                                    >
                                        {detectedLanguage.toUpperCase()}
                                    </Text>
                                </View>
                            )}
                        {state === 'listening' && liveTranscript !== '' && (
                            <View
                                style={[
                                    styles.liveTranscriptCard,
                                    {
                                        backgroundColor: theme.surface,
                                        borderColor: theme.border,
                                    },
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.liveTranscript,
                                        { color: theme.textPrimary },
                                    ]}
                                >
                                    "{liveTranscript}"
                                </Text>
                            </View>
                        )}
                        {state === 'error' && (
                            <View style={styles.errorArea}>
                                <Text
                                    style={[
                                        styles.errorText,
                                        { color: theme.textSecondary },
                                    ]}
                                >
                                    {errorKind === 'permission'
                                        ? 'Microphone access required'
                                        : 'Speech recognition unavailable'}
                                </Text>
                                {errorKind === 'permission' && (
                                    <Pressable
                                        onPress={openSettings}
                                        accessibilityRole="button"
                                        style={[
                                            styles.settingsBtn,
                                            { backgroundColor: theme.accent },
                                        ]}
                                    >
                                        <Text
                                            style={[
                                                styles.settingsBtnText,
                                                { color: palette.white },
                                            ]}
                                        >
                                            Open Settings
                                        </Text>
                                    </Pressable>
                                )}
                            </View>
                        )}
                    </View>
                </TouchableWithoutFeedback>

                {/* Transcript history — outside TouchableWithoutFeedback so FlatList can scroll */}
                <View
                    style={[
                        styles.transcriptArea,
                        { paddingBottom: insets.bottom + 16 },
                    ]}
                >
                    <VoiceTranscript />
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    safe: { flex: 1 },
    contentArea: { flex: 1 },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomLeftRadius: 24,
        borderBottomRightRadius: 24,
        borderBottomWidth: 1,
    },
    headerBtn: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerTitle: {
        fontSize: 16,
        fontWeight: '600',
        letterSpacing: 0.3,
    },
    orbArea: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        paddingVertical: 24,
    },
    liveTranscriptCard: {
        maxWidth: '85%',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 20,
        borderWidth: 1,
    },
    liveTranscript: {
        fontSize: 15,
        fontStyle: 'italic',
        textAlign: 'center',
    },
    errorArea: { alignItems: 'center', gap: 12 },
    langBadge: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
        borderWidth: 1,
    },
    langBadgeText: {
        fontSize: 12,
        fontWeight: '600',
        letterSpacing: 0.5,
    },
    errorText: { fontSize: 14, textAlign: 'center' },
    settingsBtn: {
        paddingHorizontal: 24,
        paddingVertical: 10,
        borderRadius: 20,
    },
    settingsBtnText: { fontSize: 14, fontWeight: '500' },
    transcriptArea: {
        height: '40%',
        paddingHorizontal: 16,
        paddingBottom: 16,
    },
});
