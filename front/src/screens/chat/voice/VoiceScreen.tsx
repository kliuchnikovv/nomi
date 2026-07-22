import React, { useCallback, useMemo, useRef } from 'react';
import {
    View,
    TouchableOpacity,
    TouchableWithoutFeedback,
    StyleSheet,
    Pressable,
    ScrollView,
    Linking,
} from 'react-native';
import { Text } from '@genie/ds';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
    useNavigation,
    useRoute,
    useFocusEffect,
    RouteProp,
} from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { Xmark } from 'iconoir-react-native';
import Markdown from 'react-native-markdown-display';
import Clipboard from '@react-native-clipboard/clipboard';
import { useTheme } from '../../../context/ThemeContext';
import { useVoiceConversation } from './useVoiceConversation';
import { VoiceOrb } from './VoiceOrb';
import { useAskUser } from '../AskUserContext';
import { AskUserDialog } from '../components/AskUserDialog';
import { createMarkdownStyles } from '../message/dynamicStyles';
import { createMarkdownRules } from '../message/markdownRules';
import { showToast } from '../../../utils/toast';
import { TAB_BAR_ICON_HEIGHT } from '../../../navigation/MainTabs';
import type { ChatStackParamList } from '../../../navigation/types';
import type { VoiceState } from './useVoiceConversation';

type VoiceScreenRoute = RouteProp<ChatStackParamList, 'VoiceScreen'>;

// Shared chat markdown rules — copy code / open + copy links.
const markdownRules = createMarkdownRules({
    onCodeCopy: code => {
        Clipboard.setString(code);
        showToast('Code copied');
    },
    onLinkPress: url => Linking.openURL(url).catch(() => {}),
    onLinkCopy: url => {
        Clipboard.setString(url);
        showToast('Link copied');
    },
});

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
    const { theme, palette, descriptor } = useTheme();
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

    // ask_user runs as a client tool while the model is working. The dialog is
    // rendered per-screen, so the voice screen needs its own instance — the
    // shared AskUserProvider (ChatStack) holds the state for all chat screens.
    const { dialogState, submitResponse, cancelDialog } = useAskUser();

    const showAssistantText =
        (state === 'speaking' || state === 'processing') &&
        assistantText !== '';

    // Reuse the chat markdown styles, bumped slightly for the voice caption.
    const markdownStyles = useMemo(() => {
        const base = createMarkdownStyles(theme) as Record<string, any>;
        return {
            ...base,
            body: { ...base.body, fontSize: 17, lineHeight: 25 },
        };
    }, [theme]);

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

    // Leaving the screen (tab switch, push-on-top, or back) must stop playback.
    // useFocusEffect's cleanup runs on blur and unmount, covering every exit path.
    useFocusEffect(
        useCallback(() => {
            return () => {
                stop();
            };
        }, [stop]),
    );

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
                        theme={descriptor}
                        style={[
                            styles.headerTitle,
                            { color: theme.textPrimary },
                        ]}
                    >
                        Voice
                    </Text>
                    <Text
                        theme={descriptor}
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
                                    theme={descriptor}
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
                                    theme={descriptor}
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
                        <Markdown
                            style={markdownStyles as any}
                            rules={markdownRules}
                        >
                            {assistantText}
                        </Markdown>
                    </ScrollView>
                )}
            </View>

            <AskUserDialog
                visible={dialogState.visible}
                question={dialogState.question}
                options={dialogState.options}
                onSubmit={submitResponse}
                onCancel={cancelDialog}
                theme={theme}
            />
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
});
