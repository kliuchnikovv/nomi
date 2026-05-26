import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
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
    const [proactiveEnabled, setProactiveEnabled] = useState(
        user?.proactive_enabled ?? false,
    );

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

    // Refresh preview values each time this screen comes into focus
    useFocusEffect(
        useCallback(() => {
            initApiUrl();
            setCurrentThemeName(themes[themeName].name);
            setSingleChatMode(user?.single_chat_mode ?? false);
            setAgnoSessions(user?.agent_storage_mode === 'agno');
            setProactiveEnabled(user?.proactive_enabled ?? false);

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
                        label="Proactive Agent"
                        subtitle="Let Nomi surface calendar and email updates"
                        value={proactiveEnabled}
                        onToggle={handleProactiveToggle}
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
        </View>
    );
}
