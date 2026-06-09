import React, { useCallback, useRef } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    TouchableWithoutFeedback,
    StyleSheet,
    Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { Xmark } from 'iconoir-react-native';
import { useTheme } from '../../../context/ThemeContext';
import { useVoiceConversation, VOICE_LANGUAGES } from './useVoiceConversation';
import { VoiceOrb } from './VoiceOrb';
import { VoiceTranscript } from './VoiceTranscript';
import { TAB_BAR_ICON_HEIGHT } from '../../../navigation/MainTabs';
import type { ChatStackParamList } from '../../../navigation/types';
import type { VoiceState } from './useVoiceConversation';

type VoiceScreenRoute = RouteProp<ChatStackParamList, 'VoiceScreen'>;

function statusLabel(state: VoiceState, permissionError: boolean): string {
    switch (state) {
        case 'loading':
            return 'Preparing…';
        case 'listening':
            return 'Listening…';
        case 'processing':
            return 'Thinking…';
        case 'speaking':
            return 'Speaking · tap to interrupt';
        case 'error':
            return permissionError ? 'Microphone access needed' : 'Unavailable';
        case 'idle':
        default:
            return 'Ready';
    }
}

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
        language,
        setLanguage,
        interrupt,
        stop,
        openSettings,
    } = useVoiceConversation({ chatId });

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
            {/* Subtle accent bloom behind the orb for depth. */}
            <LinearGradient
                colors={[`${theme.accent}24`, `${theme.accent}00`]}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 0.65 }}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
            />

            {/* Floating header — controls row + absolutely-centered title. */}
            <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
                <View style={styles.headerControls}>
                    <TouchableOpacity
                        onPress={handleClose}
                        style={[
                            styles.headerBtn,
                            {
                                backgroundColor: theme.surface,
                                borderColor: theme.border,
                            },
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

                    {/* In-call language switcher — changes the recognition locale.
                        Applies immediately while listening, otherwise next turn. */}
                    <View
                        style={[
                            styles.langToggle,
                            {
                                backgroundColor: theme.surface,
                                borderColor: theme.border,
                            },
                        ]}
                    >
                        {VOICE_LANGUAGES.map(opt => {
                            const active = language === opt.code;
                            return (
                                <TouchableOpacity
                                    key={opt.code}
                                    onPress={() => setLanguage(opt.code)}
                                    style={[
                                        styles.langToggleBtn,
                                        active && {
                                            backgroundColor: theme.accent,
                                        },
                                    ]}
                                    accessibilityRole="button"
                                    accessibilityState={{ selected: active }}
                                    accessibilityLabel={`Recognize ${opt.label}`}
                                >
                                    <Text
                                        style={[
                                            styles.langToggleText,
                                            {
                                                color: active
                                                    ? palette.white
                                                    : theme.textSecondary,
                                            },
                                        ]}
                                    >
                                        {opt.label}
                                    </Text>
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                </View>

                <View
                    style={[styles.headerTitleWrap, { top: insets.top + 8 }]}
                    pointerEvents="none"
                >
                    <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>
                        Voice
                    </Text>
                    <Text
                        style={[styles.headerStatus, { color: theme.textSecondary }]}
                        numberOfLines={1}
                    >
                        {statusLabel(state, errorKind === 'permission')}
                    </Text>
                </View>
            </View>

            <View style={styles.contentArea}>
                {/* Orb area — tap anywhere here to interrupt */}
                <TouchableWithoutFeedback onPress={handleScreenTap}>
                    <View style={styles.orbArea}>
                        <VoiceOrb state={state} />
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
                        {state === 'error' && errorKind === 'permission' && (
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
                </TouchableWithoutFeedback>

                {/* Transcript history — outside TouchableWithoutFeedback so FlatList can scroll.
                    Reserve the floating dock height so the card clears the tab bar. */}
                <View
                    style={[
                        styles.transcriptArea,
                        {
                            paddingBottom:
                                insets.bottom + TAB_BAR_ICON_HEIGHT + 16,
                        },
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
        paddingHorizontal: 16,
        paddingBottom: 8,
    },
    headerControls: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 40,
    },
    headerTitleWrap: {
        position: 'absolute',
        left: 0,
        right: 0,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerBtn: {
        width: 40,
        height: 40,
        borderRadius: 20,
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerTitle: {
        fontSize: 16,
        fontWeight: '600',
        letterSpacing: 0.3,
    },
    headerStatus: {
        fontSize: 12,
        fontWeight: '500',
        marginTop: 1,
    },
    orbArea: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
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
    langToggle: {
        flexDirection: 'row',
        borderRadius: 16,
        padding: 2,
        gap: 2,
        borderWidth: StyleSheet.hairlineWidth,
    },
    langToggleBtn: {
        minWidth: 34,
        paddingHorizontal: 8,
        paddingVertical: 6,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
    },
    langToggleText: {
        fontSize: 13,
        fontWeight: '600',
        letterSpacing: 0.5,
    },
    settingsBtn: {
        paddingHorizontal: 24,
        paddingVertical: 10,
        borderRadius: 20,
    },
    settingsBtnText: { fontSize: 14, fontWeight: '500' },
    transcriptArea: {
        height: '44%',
        paddingHorizontal: 16,
    },
});
