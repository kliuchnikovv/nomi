import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth/context.tsx';
import { createStyles } from './styles.tsx';
import { ConnectorsProvider } from './connectors/context.tsx';
import ConnectorScreenDialog from './connectors/screen.tsx';
import { useTheme } from '../../context/ThemeContext.tsx';
import { ThemeName, themes } from '../../themes';
import { getApiUrl, setApiUrl, initApiUrl } from '../../config';

type Props = {
    visible: boolean;
    onClose: () => void;
};

export default function SettingsModal({ visible, onClose }: Props) {
    const { logout, user } = useAuth();
    const { themeName, setTheme, theme } = useTheme();
    const insets = useSafeAreaInsets();
    const paddingStyle = useMemo(
        () => ({ paddingTop: insets.top, paddingBottom: insets.bottom }),
        [insets.top, insets.bottom],
    );

    const [connectorsOpen, setConnectorsOpen] = useState(false);
    const [themeExpanded, setThemeExpanded] = useState(false);
    const [devExpanded, setDevExpanded] = useState(false);
    const [briefingExpanded, setBriefingExpanded] = useState(false);
    const [apiUrl, setApiUrlState] = useState('');
    const [briefingTime, setBriefingTime] = useState('09:00');

    // Load current API URL and Briefing Time on mount
    useEffect(() => {
        initApiUrl().then(url => setApiUrlState(url));
        AsyncStorage.getItem('briefing_time').then(t => {
            if (t) setBriefingTime(t);
        });
    }, [visible]);

    // Get current theme palette
    const palette = themes[themeName].palette;
    const styles = useMemo(() => createStyles(theme, palette), [theme, palette]);

    React.useEffect(() => {
        console.log('SettingsModal mounted');
        return () => console.log('SettingsModal unmounted');
    }, []);

    const handleClose = () => {
        console.log('SettingsModal onClose called');
        onClose();
    };

    const handleSaveApiUrl = async () => {
        try {
            await setApiUrl(apiUrl);
            Alert.alert('Saved', 'API URL updated. Restart the app for full effect.');
        } catch (e) {
            Alert.alert('Error', 'Failed to save API URL');
        }
    };

    const handleSaveBriefingTime = async () => {
        try {
            // Simple validation
            const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
            if (!timeRegex.test(briefingTime)) {
                Alert.alert('Invalid Time', 'Please use HH:MM format (e.g., 09:00)');
                return;
            }
            await AsyncStorage.setItem('briefing_time', briefingTime);
            Alert.alert('Saved', `Morning Briefing set to ${briefingTime}`);
        } catch (e) {
            Alert.alert('Error', 'Failed to save Briefing Time');
        }
    };

    const presetUrls = [
        { label: 'Production', url: 'https://genie-api-production-7074.up.railway.app/api' },
        { label: 'Local', url: 'http://localhost:8080/api' },
    ];

    const themesList: { label: string; value: ThemeName }[] = [
        { label: 'Tokyo Night', value: 'tokyoNight' },
        { label: 'One Dark', value: 'oneDark' },
        { label: 'Serika Dark', value: 'serikaDark' },
        { label: 'Light (Visual Studio)', value: 'visualStudioLight' },
    ];

    return (
        <>
            <Modal
                visible={visible}
                animationType="slide"
                transparent={false}
                onRequestClose={handleClose}
            >
                <View style={[styles.root, paddingStyle]}>
                    <View style={styles.header}>
                        <Text style={styles.title}>Settings</Text>
                        <Pressable onPress={handleClose} style={styles.closeBtn}>
                            <Text style={styles.closeText}>Close</Text>
                        </Pressable>
                    </View>
                    <View style={styles.body}>
                        {user && (
                            <View style={[styles.row, { marginBottom: 16 }]}>
                                <Text style={styles.label}>User</Text>
                                <Text style={styles.value}>
                                    {user?.email || user?.name || '—'}
                                </Text>
                            </View>
                        )}

                        <View style={{ marginBottom: 16 }}>
                            <Pressable
                                onPress={() => setThemeExpanded(!themeExpanded)}
                                style={styles.themeHeader}
                            >
                                <View>
                                    <Text style={styles.label}>Theme</Text>
                                    <Text style={styles.themeCurrentValue}>
                                        {themesList.find(t => t.value === themeName)?.label}
                                    </Text>
                                </View>
                                <Text style={styles.chevron}>
                                    {themeExpanded ? '▼' : '▶'}
                                </Text>
                            </Pressable>
                            {themeExpanded && (
                                <View style={{ marginTop: 12 }}>
                                    {themesList.map((t) => (
                                        <Pressable
                                            key={t.value}
                                            onPress={() => {
                                                setTheme(t.value);
                                                setThemeExpanded(false);
                                            }}
                                            style={[
                                                styles.themeOption,
                                                themeName === t.value
                                                    ? styles.themeOptionSelected
                                                    : styles.themeOptionUnselected,
                                            ]}
                                        >
                                            <Text style={styles.themeOptionText}>
                                                {t.label}
                                            </Text>
                                            {themeName === t.value && (
                                                <Text style={styles.themeCheckmark}>✓</Text>
                                            )}
                                        </Pressable>
                                    ))}
                                </View>
                            )}
                        </View>

                        {/* Morning Briefing Section */}
                        <View style={{ marginBottom: 16 }}>
                            <Pressable
                                onPress={() => setBriefingExpanded(!briefingExpanded)}
                                style={styles.themeHeader}
                            >
                                <View>
                                    <Text style={styles.label}>Daily Morning Briefing</Text>
                                    <Text style={styles.themeCurrentValue}>
                                        {briefingTime}
                                    </Text>
                                </View>
                                <Text style={styles.chevron}>
                                    {briefingExpanded ? '▼' : '▶'}
                                </Text>
                            </Pressable>
                            {briefingExpanded && (
                                <View style={{ marginTop: 12, gap: 8 }}>
                                    <Text style={[styles.label, { marginBottom: 4 }]}>Briefing Time</Text>
                                    <View style={{ flexDirection: 'row', gap: 8 }}>
                                        <TextInput
                                            value={briefingTime}
                                            onChangeText={setBriefingTime}
                                            style={{
                                                flex: 1,
                                                borderWidth: 1,
                                                borderColor: theme.border,
                                                borderRadius: 8,
                                                padding: 12,
                                                color: theme.text,
                                                backgroundColor: theme.background,
                                                fontSize: 16,
                                            }}
                                            placeholder="HH:MM"
                                            placeholderTextColor={theme.textSecondary}
                                            keyboardType="numbers-and-punctuation"
                                            maxLength={5}
                                        />
                                        <Pressable
                                            onPress={handleSaveBriefingTime}
                                            style={{
                                                backgroundColor: theme.primary,
                                                borderRadius: 8,
                                                paddingHorizontal: 20,
                                                justifyContent: 'center',
                                                alignItems: 'center',
                                            }}
                                        >
                                            <Text style={{ color: '#fff', fontWeight: '600' }}>Save</Text>
                                        </Pressable>
                                    </View>
                                    <Text style={{ fontSize: 12, color: theme.textSecondary, marginTop: 4 }}>
                                        Receive your daily digest at this time.
                                    </Text>
                                </View>
                            )}
                        </View>

                        <View>
                            <Pressable
                                onPress={() => {
                                    console.log('onPress');
                                    setConnectorsOpen(true);
                                    console.log(
                                        `onPress finished - ${connectorsOpen}`,
                                    );
                                }}
                                style={({ pressed }) => [
                                    styles.connectorsBtn,
                                    pressed && { opacity: 0.8 },
                                ]}
                            >
                                <Text style={styles.logoutText}>
                                    Connectors
                                </Text>
                            </Pressable>
                        </View>

                        {/* Developer Section */}
                        <View style={{ marginTop: 24 }}>
                            <Pressable
                                onPress={() => setDevExpanded(!devExpanded)}
                                style={styles.themeHeader}
                            >
                                <View>
                                    <Text style={styles.label}>Developer</Text>
                                    <Text style={[styles.themeCurrentValue, { fontSize: 11 }]}>
                                        {apiUrl.substring(0, 40)}...
                                    </Text>
                                </View>
                                <Text style={styles.chevron}>
                                    {devExpanded ? '▼' : '▶'}
                                </Text>
                            </Pressable>
                            {devExpanded && (
                                <View style={{ marginTop: 12, gap: 8 }}>
                                    <Text style={[styles.label, { marginBottom: 4 }]}>API URL</Text>
                                    <TextInput
                                        value={apiUrl}
                                        onChangeText={setApiUrlState}
                                        style={{
                                            borderWidth: 1,
                                            borderColor: theme.border,
                                            borderRadius: 8,
                                            padding: 12,
                                            color: theme.text,
                                            backgroundColor: theme.background,
                                            fontFamily: 'monospace',
                                            fontSize: 12,
                                        }}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        selectTextOnFocus
                                    />
                                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                                        {presetUrls.map(p => (
                                            <Pressable
                                                key={p.label}
                                                onPress={() => setApiUrlState(p.url)}
                                                style={{
                                                    paddingVertical: 6,
                                                    paddingHorizontal: 12,
                                                    backgroundColor: apiUrl === p.url ? theme.accent : theme.surface,
                                                    borderRadius: 6,
                                                }}
                                            >
                                                <Text style={{ color: theme.text, fontSize: 12 }}>{p.label}</Text>
                                            </Pressable>
                                        ))}
                                    </View>
                                    <Pressable
                                        onPress={handleSaveApiUrl}
                                        style={{
                                            marginTop: 8,
                                            paddingVertical: 10,
                                            paddingHorizontal: 16,
                                            backgroundColor: theme.accent,
                                            borderRadius: 8,
                                            alignItems: 'center',
                                        }}
                                    >
                                        <Text style={{ color: '#fff', fontWeight: '600' }}>Save & Restart</Text>
                                    </Pressable>
                                </View>
                            )}
                        </View>

                        <View style={{ height: 24 }} />
                        <Pressable
                            onPress={async () => {
                                try {
                                    await logout();
                                } catch { }
                                onClose();
                            }}
                            style={({ pressed }) => [
                                styles.logoutBtn,
                                pressed && { opacity: 0.8 },
                            ]}
                        >
                            <Text style={styles.logoutText}>Logout</Text>
                        </Pressable>
                    </View>
                    {connectorsOpen && (
                        <ConnectorsProvider>
                            <ConnectorScreenDialog
                                visible={true}
                                onClose={() => setConnectorsOpen(false)}
                            />
                        </ConnectorsProvider>
                        // <ConnectorsDialog
                        //     visible={connectorsOpen}
                        //     onClose={() => setConnectorsOpen(false)}
                        // />
                    )}
                </View>
            </Modal>
        </>
    );
}
