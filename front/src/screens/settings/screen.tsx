import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../auth/context.tsx';
import { createStyles } from './styles.tsx';
import { useTheme } from '../../context/ThemeContext.tsx';
import { themes } from '../../themes';
import { initApiUrl } from '../../config';
import { authApi, botIdentityApi } from '../../apiClient';

import { getStoredLocation } from '../../services/location/locationService';
import { SettingsSection } from './components/SettingsSection';
import { SettingsRow } from './components/SettingsRow';
import { SettingsToggleRow } from './components/SettingsToggleRow';
import { SettingsStackParamList } from '../../navigation/types';
import { TAB_BAR_ICON_HEIGHT } from '../../navigation/MainTabs';

// Shared with plugins/gmail/client/emailAnalyzer.ts
const EMAIL_ANALYSIS_MODE_KEY = '@genie_email_analysis_mode';
type EmailAnalysisMode = 'device' | 'server';

export const PLANNER_MODEL_KEY = '@genie_planner_model';
export const PLANNER_PROVIDER_KEY = '@genie_planner_provider';

type Nav = NativeStackNavigationProp<SettingsStackParamList, 'SettingsHome'>;

export default function SettingsHomeScreen() {
    const { logout, user, updateUser } = useAuth();
    const { themeName, theme } = useTheme();
    const insets = useSafeAreaInsets();
    const navigation = useNavigation<Nav>();

    const palette = themes[themeName].palette;
    const styles = useMemo(
        () => createStyles(theme, palette),
        [theme, palette],
    );

    const [emailAnalysisMode, setEmailAnalysisMode] =
        useState<EmailAnalysisMode>('device');
    const [botName, setBotName] = useState('Souper');
    const [locationDisplay, setLocationDisplay] = useState('');
    const [currentThemeName, setCurrentThemeName] = useState(
        () => themes[themeName].name,
    );
    const [singleChatMode, setSingleChatMode] = useState(
        user?.single_chat_mode ?? false,
    );
    const [agnoSessions, setAgnoSessions] = useState(
        user?.agent_storage_mode === 'agno',
    );
    const [serverVoice, setServerVoice] = useState(
        user?.voice_source === 'server_gemini',
    );
    const [proactiveEnabled, setProactiveEnabled] = useState(
        user?.proactive_enabled ?? false,
    );
    const [dailyBriefTime, setDailyBriefTime] = useState<string | null>(
        user?.daily_brief_time ?? null,
    );
    const [showTimePicker, setShowTimePicker] = useState(false);
    const [pickerHour, setPickerHour] = useState(8);
    const [pickerMinute, setPickerMinute] = useState(0);

    const handleSingleChatModeToggle = useCallback(
        async (value: boolean) => {
            try {
                await authApi.updateMe({ single_chat_mode: value });
                setSingleChatMode(value);
                if (user) updateUser({ ...user, single_chat_mode: value });
            } catch (e) {
                console.error('Failed to update single chat mode', e);
            }
        },
        [user, updateUser],
    );

    const handleAgnoSessionsToggle = useCallback(
        async (value: boolean) => {
            try {
                const mode = value ? 'agno' : 'payload';
                await authApi.updateMe({ agent_storage_mode: mode });
                setAgnoSessions(value);
                if (user) updateUser({ ...user, agent_storage_mode: mode });
            } catch (e) {
                console.error('Failed to update agent storage mode', e);
            }
        },
        [user, updateUser],
    );

    const handleServerVoiceToggle = useCallback(
        async (value: boolean) => {
            try {
                const source = value ? 'server_gemini' : 'on_device';
                await authApi.updateMe({ voice_source: source });
                setServerVoice(value);
                if (user) updateUser({ ...user, voice_source: source });
            } catch (e) {
                console.error('Failed to update voice source', e);
            }
        },
        [user, updateUser],
    );

    const handleProactiveToggle = useCallback(
        async (value: boolean) => {
            try {
                await authApi.updateMe({ proactive_enabled: value });
                setProactiveEnabled(value);
                if (user) updateUser({ ...user, proactive_enabled: value });
            } catch (e) {
                console.error('Failed to update proactive_enabled', e);
            }
        },
        [user, updateUser],
    );

    const openTimePicker = useCallback(() => {
        if (dailyBriefTime) {
            const [h, m] = dailyBriefTime.split(':').map(Number);
            setPickerHour(h);
            setPickerMinute(m);
        } else {
            setPickerHour(8);
            setPickerMinute(0);
        }
        setShowTimePicker(true);
    }, [dailyBriefTime]);

    const saveDailyBriefTime = useCallback(
        async (time: string | null) => {
            const timezone =
                Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
            try {
                await authApi.updateMe({
                    daily_brief_time: time ?? '',
                    timezone,
                });
                setDailyBriefTime(time);
                if (user)
                    updateUser({ ...user, daily_brief_time: time, timezone });
            } catch (e) {
                console.error('Failed to update daily_brief_time', e);
            }
        },
        [user, updateUser],
    );

    // Refresh preview values each time this screen comes into focus
    useFocusEffect(
        useCallback(() => {
            initApiUrl();
            setCurrentThemeName(themes[themeName].name);
            setSingleChatMode(user?.single_chat_mode ?? false);
            setAgnoSessions(user?.agent_storage_mode === 'agno');
            setServerVoice(user?.voice_source === 'server_gemini');
            setProactiveEnabled(user?.proactive_enabled ?? false);
            setDailyBriefTime(user?.daily_brief_time ?? null);

            AsyncStorage.getItem(EMAIL_ANALYSIS_MODE_KEY).then(mode => {
                if (mode === 'server' || mode === 'device')
                    setEmailAnalysisMode(mode);
            });
            botIdentityApi
                .get()
                .then(identity => {
                    if (identity?.name) setBotName(identity.name);
                })
                .catch(() => {});
            getStoredLocation().then(loc =>
                setLocationDisplay(loc.displayName),
            );
        }, [themeName, user]),
    );

    return (
        <View style={[styles.root, { paddingTop: insets.top }]}>
            <View style={[styles.header, { paddingTop: 8 }]}>
                <Text style={styles.title}>Settings</Text>
            </View>
            <ScrollView
                style={styles.body}
                contentContainerStyle={{
                    paddingBottom: insets.bottom + TAB_BAR_ICON_HEIGHT + 32,
                }}
            >
                <SettingsSection header="Appearance">
                    <SettingsRow
                        label="Theme"
                        value={currentThemeName}
                        onPress={() => navigation.navigate('ThemeScreen')}
                        isFirst
                        isLast
                    />
                </SettingsSection>

                <SettingsSection header="Assistant">
                    <SettingsRow
                        label="Bot Identity"
                        value={botName}
                        onPress={() => navigation.navigate('BotIdentityScreen')}
                        isFirst
                    />
                    <SettingsRow
                        label="Memory"
                        onPress={() => navigation.navigate('MemoryScreen')}
                        isFirst={false}
                        isLast
                    />
                </SettingsSection>

                <SettingsSection header="Data">
                    <SettingsRow
                        label="Location"
                        value={locationDisplay}
                        onPress={() => navigation.navigate('LocationScreen')}
                        isFirst
                        isLast
                    />
                </SettingsSection>

                <SettingsSection header="Integrations">
                    <SettingsRow
                        label="Integrations"
                        onPress={() =>
                            navigation.navigate('IntegrationsScreen')
                        }
                        isFirst
                    />
                    <SettingsRow
                        label="AI Keys (BYOK)"
                        onPress={() => navigation.navigate('BYOKScreen')}
                        isFirst={false}
                        isLast
                    />
                </SettingsSection>

                <SettingsSection header="Experimental">
                    <SettingsToggleRow
                        label="Email Analysis"
                        subtitle={
                            emailAnalysisMode === 'server'
                                ? 'Server (gpt-5-nano)'
                                : 'Device'
                        }
                        value={emailAnalysisMode === 'server'}
                        onToggle={async value => {
                            const mode: EmailAnalysisMode = value
                                ? 'server'
                                : 'device';
                            setEmailAnalysisMode(mode);
                            await AsyncStorage.setItem(
                                EMAIL_ANALYSIS_MODE_KEY,
                                mode,
                            );
                        }}
                        isFirst
                    />
                    <SettingsToggleRow
                        label="Single Chat Mode"
                        subtitle="Use one persistent endless chat"
                        value={singleChatMode}
                        onToggle={handleSingleChatModeToggle}
                        isFirst={false}
                    />
                    <SettingsToggleRow
                        label="Agno Sessions"
                        subtitle="Store session history in Agno instead of payload"
                        value={agnoSessions}
                        onToggle={handleAgnoSessionsToggle}
                        isFirst={false}
                    />
                    <SettingsToggleRow
                        label="Server Voice (Gemini)"
                        subtitle="Experimental: speak replies with a Gemini voice from the server"
                        value={serverVoice}
                        onToggle={handleServerVoiceToggle}
                        isFirst={false}
                    />
                    <SettingsToggleRow
                        label="Proactive Agent"
                        subtitle="Let Nomi surface calendar and email updates"
                        value={proactiveEnabled}
                        onToggle={handleProactiveToggle}
                        isFirst={false}
                    />
                    <SettingsRow
                        label="Daily Brief"
                        value={dailyBriefTime ?? 'Off'}
                        onPress={openTimePicker}
                        isFirst={false}
                        isLast
                    />
                </SettingsSection>

                <SettingsSection header="Account">
                    <SettingsRow
                        label={user?.email || user?.name || '—'}
                        isFirst
                        isLast={false}
                    />
                    <SettingsRow
                        label="Logout"
                        destructive
                        onPress={async () => {
                            try {
                                await logout();
                            } catch {}
                        }}
                        isFirst={false}
                        isLast
                    />
                </SettingsSection>
            </ScrollView>

            <TimePickerModal
                visible={showTimePicker}
                hour={pickerHour}
                minute={pickerMinute}
                enabled={dailyBriefTime !== null}
                theme={theme}
                onChangeHour={setPickerHour}
                onChangeMinute={setPickerMinute}
                onToggleEnabled={async enabled => {
                    if (!enabled) {
                        setShowTimePicker(false);
                        await saveDailyBriefTime(null);
                    }
                }}
                onCancel={() => setShowTimePicker(false)}
                onConfirm={async () => {
                    const hh = String(pickerHour).padStart(2, '0');
                    const mm = String(pickerMinute).padStart(2, '0');
                    setShowTimePicker(false);
                    await saveDailyBriefTime(`${hh}:${mm}`);
                }}
            />
        </View>
    );
}

// ─── Time Picker Modal ────────────────────────────────────────────────────────

const ITEM_HEIGHT = 44;
const VISIBLE_ITEMS = 5;
const PICKER_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS;

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

interface TimePickerModalProps {
    visible: boolean;
    hour: number;
    minute: number;
    enabled: boolean;
    theme: any;
    onChangeHour: (h: number) => void;
    onChangeMinute: (m: number) => void;
    onToggleEnabled: (enabled: boolean) => void;
    onCancel: () => void;
    onConfirm: () => void;
}

function TimePickerModal({
    visible,
    hour,
    minute,
    enabled,
    theme,
    onChangeHour,
    onChangeMinute,
    onToggleEnabled,
    onCancel,
    onConfirm,
}: TimePickerModalProps) {
    const hourRef = useRef<ScrollView>(null);
    const minuteRef = useRef<ScrollView>(null);

    const scrollTo = useCallback(
        (ref: React.RefObject<ScrollView | null>, index: number) => {
            ref.current?.scrollTo({ y: index * ITEM_HEIGHT, animated: true });
        },
        [],
    );

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onCancel}
        >
            <Pressable style={pickerStyles.backdrop} onPress={onCancel}>
                <Pressable
                    style={[
                        pickerStyles.card,
                        { backgroundColor: theme.surface },
                    ]}
                >
                    <Text style={[pickerStyles.title, { color: theme.text }]}>
                        Daily Brief
                    </Text>

                    {/* On / Off toggle */}
                    <View style={pickerStyles.toggleRow}>
                        <Text
                            style={[
                                pickerStyles.toggleLabel,
                                { color: theme.textSecondary },
                            ]}
                        >
                            {enabled ? 'Enabled' : 'Disabled'}
                        </Text>
                        <TouchableOpacity
                            onPress={() => onToggleEnabled(!enabled)}
                            style={[
                                pickerStyles.pill,
                                {
                                    backgroundColor: enabled
                                        ? theme.accent
                                        : theme.border,
                                },
                            ]}
                        >
                            <View
                                style={[
                                    pickerStyles.pillKnob,
                                    {
                                        transform: [
                                            { translateX: enabled ? 20 : 0 },
                                        ],
                                    },
                                ]}
                            />
                        </TouchableOpacity>
                    </View>

                    {/* Wheel columns */}
                    {enabled && (
                        <View style={pickerStyles.wheelsRow}>
                            {/* Hours */}
                            <WheelColumn
                                scrollRef={hourRef}
                                items={HOURS}
                                selected={hour}
                                onSelect={h => {
                                    onChangeHour(h);
                                    scrollTo(hourRef, h);
                                }}
                                format={v => String(v).padStart(2, '0')}
                                theme={theme}
                            />

                            <Text
                                style={[
                                    pickerStyles.colon,
                                    { color: theme.text },
                                ]}
                            >
                                :
                            </Text>

                            {/* Minutes */}
                            <WheelColumn
                                scrollRef={minuteRef}
                                items={MINUTES}
                                selected={minute}
                                onSelect={m => {
                                    onChangeMinute(m);
                                    scrollTo(minuteRef, MINUTES.indexOf(m));
                                }}
                                format={v => String(v).padStart(2, '0')}
                                theme={theme}
                            />
                        </View>
                    )}

                    {/* Actions */}
                    <View style={pickerStyles.actions}>
                        <TouchableOpacity
                            onPress={onCancel}
                            style={pickerStyles.btn}
                        >
                            <Text
                                style={[
                                    pickerStyles.btnText,
                                    { color: theme.textSecondary },
                                ]}
                            >
                                Cancel
                            </Text>
                        </TouchableOpacity>
                        {enabled && (
                            <TouchableOpacity
                                onPress={onConfirm}
                                style={[
                                    pickerStyles.btn,
                                    pickerStyles.btnPrimary,
                                    { backgroundColor: theme.accent },
                                ]}
                            >
                                <Text
                                    style={[
                                        pickerStyles.btnText,
                                        { color: '#fff' },
                                    ]}
                                >
                                    Save
                                </Text>
                            </TouchableOpacity>
                        )}
                    </View>
                </Pressable>
            </Pressable>
        </Modal>
    );
}

interface WheelColumnProps {
    scrollRef: React.RefObject<ScrollView | null>;
    items: number[];
    selected: number;
    onSelect: (v: number) => void;
    format: (v: number) => string;
    theme: any;
}

function WheelColumn({
    scrollRef,
    items,
    selected,
    onSelect,
    format,
    theme,
}: WheelColumnProps) {
    const handleScroll = useCallback(
        (e: { nativeEvent: { contentOffset: { y: number } } }) => {
            const idx = Math.round(e.nativeEvent.contentOffset.y / ITEM_HEIGHT);
            const clamped = Math.max(0, Math.min(items.length - 1, idx));
            if (items[clamped] !== selected) onSelect(items[clamped]);
        },
        [items, selected, onSelect],
    );

    return (
        <View style={pickerStyles.wheelWrap}>
            {/* centre highlight */}
            <View
                style={[
                    pickerStyles.highlight,
                    { borderColor: theme.accent, top: ITEM_HEIGHT * 2 },
                ]}
                pointerEvents="none"
            />
            <ScrollView
                ref={scrollRef}
                style={{ height: PICKER_HEIGHT }}
                showsVerticalScrollIndicator={false}
                snapToInterval={ITEM_HEIGHT}
                decelerationRate="fast"
                onMomentumScrollEnd={handleScroll}
                contentContainerStyle={{ paddingVertical: ITEM_HEIGHT * 2 }}
                onLayout={() => {
                    const idx = items.indexOf(selected);
                    if (idx >= 0) {
                        scrollRef.current?.scrollTo({
                            y: idx * ITEM_HEIGHT,
                            animated: false,
                        });
                    }
                }}
            >
                {items.map(v => (
                    <TouchableOpacity
                        key={v}
                        style={pickerStyles.wheelItem}
                        onPress={() => onSelect(v)}
                    >
                        <Text
                            style={[
                                pickerStyles.wheelText,
                                {
                                    color:
                                        v === selected
                                            ? theme.text
                                            : theme.textSecondary,
                                },
                                v === selected &&
                                    pickerStyles.wheelTextSelected,
                            ]}
                        >
                            {format(v)}
                        </Text>
                    </TouchableOpacity>
                ))}
            </ScrollView>
        </View>
    );
}

const pickerStyles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    card: {
        width: 300,
        borderRadius: 16,
        padding: 20,
        gap: 16,
    },
    title: {
        fontSize: 17,
        fontWeight: '600',
        textAlign: 'center',
    },
    toggleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    toggleLabel: {
        fontSize: 15,
    },
    pill: {
        width: 48,
        height: 28,
        borderRadius: 14,
        justifyContent: 'center',
        paddingHorizontal: 3,
    },
    pillKnob: {
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: '#fff',
    },
    wheelsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
    },
    colon: {
        fontSize: 24,
        fontWeight: '600',
        paddingBottom: 4,
    },
    wheelWrap: {
        width: 72,
        overflow: 'hidden',
    },
    highlight: {
        position: 'absolute',
        left: 0,
        right: 0,
        height: ITEM_HEIGHT,
        borderTopWidth: 1,
        borderBottomWidth: 1,
        zIndex: 1,
    },
    wheelItem: {
        height: ITEM_HEIGHT,
        justifyContent: 'center',
        alignItems: 'center',
    },
    wheelText: {
        fontSize: 20,
    },
    wheelTextSelected: {
        fontWeight: '600',
    },
    actions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: 8,
    },
    btn: {
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 8,
    },
    btnPrimary: {},
    btnText: {
        fontSize: 15,
        fontWeight: '500',
    },
});
