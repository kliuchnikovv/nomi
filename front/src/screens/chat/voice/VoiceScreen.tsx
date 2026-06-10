import React, { useCallback, useRef } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    TouchableWithoutFeedback,
    StyleSheet,
    Pressable,
    ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { Xmark } from 'iconoir-react-native';
import { useTheme } from '../../../context/ThemeContext';
import { useVoiceConversation } from './useVoiceConversation';
import { VoiceOrb } from './VoiceOrb';
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
        assistantText,
        errorKind,
        interrupt,
        stop,
        openSettings,
    } = useVoiceConversation({ chatId });

    const showAssistantText =
        (state === 'speaking' || state === 'processing') &&
        assistantText !== '';

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

            {/* Floating header — close button + absolutely-centered title. */}
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
                </View>

                <View
                    style={[styles.headerTitleWrap, { top: insets.top + 8 }]}
                    pointerEvents="none"
                >
                    <Text
                        style={[
                            styles.headerTitle,
                            { color: theme.textPrimary },
                        ]}
                    >
                        Voice
                    </Text>
                    <Text
                        style={[
                            styles.headerStatus,
                            { color: theme.textSecondary },
                        ]}
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

                {/* The model's current message — shown while it thinks/speaks.
                    Outside TouchableWithoutFeedback so long replies can scroll.
                    Reserve the floating dock height so it clears the tab bar. */}
                {showAssistantText && (
                    <ScrollView
                        style={styles.messageArea}
                        contentContainerStyle={[
                            styles.messageScroll,
                            {
                                paddingBottom:
                                    insets.bottom + TAB_BAR_ICON_HEIGHT + 16,
                            },
                        ]}
                        showsVerticalScrollIndicator={false}
                    >
                        <Text
                            style={[
                                styles.message,
                                { color: theme.textPrimary },
                            ]}
                        >
                            {assistantText}
                        </Text>
                    </ScrollView>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    safe: { flex: 1 },
    contentArea: { flex: 1 },
    header: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 2,
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
    settingsBtn: {
        paddingHorizontal: 24,
        paddingVertical: 10,
        borderRadius: 20,
    },
    settingsBtnText: { fontSize: 14, fontWeight: '500' },
    messageArea: {
        maxHeight: '42%',
        paddingHorizontal: 24,
    },
    messageScroll: {
        flexGrow: 1,
        justifyContent: 'center',
        paddingTop: 8,
    },
    message: {
        fontSize: 18,
        lineHeight: 26,
        fontWeight: '500',
        textAlign: 'center',
    },
});
