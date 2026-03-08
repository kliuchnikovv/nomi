import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, Switch, Text, View, ActivityIndicator } from 'react-native';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth/context.tsx';
import { createStyles } from './styles.tsx';

import ConnectorScreenDialog from './connectors/screen.tsx';
import { useTheme } from '../../context/ThemeContext.tsx';
import { ThemeName, themes } from '../../themes';
import { initApiUrl } from '../../config';

// Shared with plugins/gmail/client/emailAnalyzer.ts
const EMAIL_ANALYSIS_MODE_KEY = '@genie_email_analysis_mode';
type EmailAnalysisMode = 'device' | 'server';

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
    const [weatherExpanded, setWeatherExpanded] = useState(false);
    const [weatherLat, setWeatherLat] = useState('55.75');
    const [weatherLon, setWeatherLon] = useState('37.62');
    const [locationLoading, setLocationLoading] = useState(false);
    const [emailAnalysisMode, setEmailAnalysisMode] = useState<EmailAnalysisMode>('device');

    // Load current API URL and Briefing Time on mount
    useEffect(() => {
        initApiUrl();
        AsyncStorage.getItem('weather_location').then(loc => {
            if (loc) {
                const { lat, lon } = JSON.parse(loc);
                setWeatherLat(String(lat));
                setWeatherLon(String(lon));
            }
        });
        AsyncStorage.getItem(EMAIL_ANALYSIS_MODE_KEY).then(mode => {
            if (mode === 'server' || mode === 'device') {
                setEmailAnalysisMode(mode);
            }
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

    const handleUseMyLocation = async () => {
        setLocationLoading(true);
        try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Permission to access location was denied');
                return;
            }

            const location = await Location.getCurrentPositionAsync({});
            setWeatherLat(String(location.coords.latitude));
            setWeatherLon(String(location.coords.longitude));
            Alert.alert('Success', 'Location updated');
        } catch (error) {
            Alert.alert('Error', 'Failed to get current location');
        } finally {
            setLocationLoading(false);
        }
    };

    const themesList: { label: string; value: ThemeName }[] = Object.entries(themes).map(
        ([key, descriptor]) => ({ label: descriptor.name, value: key as ThemeName })
    );

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

                        {/* Weather Location Section */}
                        <View style={{ marginBottom: 16 }}>
                            <Pressable
                                onPress={() => setWeatherExpanded(!weatherExpanded)}
                                style={styles.themeHeader}
                            >
                                <View>
                                    <Text style={styles.label}>Weather Location</Text>
                                    <Text style={styles.themeCurrentValue}>
                                        {weatherLat}, {weatherLon}
                                    </Text>
                                </View>
                                <Text style={styles.chevron}>
                                    {weatherExpanded ? '▼' : '▶'}
                                </Text>
                            </Pressable>
                            {weatherExpanded && (
                                <View style={{ marginTop: 12, gap: 8 }}>
                                    <Text style={{ fontSize: 13, color: theme.textSecondary }}>
                                        Weather is updated automatically based on your current location.
                                    </Text>
                                    <View style={{ flexDirection: 'row', gap: 8 }}>
                                        {/* Inputs removed as requested */}
                                    </View>
                                    <Pressable
                                        onPress={handleUseMyLocation}
                                        disabled={locationLoading}
                                        style={{
                                            marginTop: 4,
                                            backgroundColor: theme.surface,
                                            borderWidth: 1,
                                            borderColor: theme.border,
                                            borderRadius: 8,
                                            paddingVertical: 10,
                                            paddingHorizontal: 16,
                                            alignItems: 'center',
                                            flexDirection: 'row',
                                            justifyContent: 'center',
                                            gap: 8
                                        }}
                                    >
                                        {locationLoading ? (
                                            <ActivityIndicator size="small" color={theme.text} />
                                        ) : (
                                            <Text style={{ color: theme.text, fontWeight: '500' }}>Use Current Location</Text>
                                        )}
                                    </Pressable>


                                </View>
                            )}
                        </View>

                        {/* Email Analysis Mode */}
                        <View style={[styles.row, { marginBottom: 16 }]}>
                            <View style={{ flex: 1 }}>
                                <Text style={styles.label}>Email Analysis</Text>
                                <Text style={{ fontSize: 12, color: theme.textSecondary, marginTop: 2 }}>
                                    {emailAnalysisMode === 'server' ? 'Server (gpt-5-nano)' : 'Device'}
                                </Text>
                            </View>
                            <Switch
                                value={emailAnalysisMode === 'server'}
                                onValueChange={async (value: boolean) => {
                                    const mode: EmailAnalysisMode = value ? 'server' : 'device';
                                    setEmailAnalysisMode(mode);
                                    await AsyncStorage.setItem(EMAIL_ANALYSIS_MODE_KEY, mode);
                                }}
                            />
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
                                    Integrations
                                </Text>
                            </Pressable>
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
                        <ConnectorScreenDialog
                            visible={true}
                            onClose={() => setConnectorsOpen(false)}
                        />
                    )}
                </View>
            </Modal>
        </>
    );
}
