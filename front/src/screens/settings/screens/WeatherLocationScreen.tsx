import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { NavArrowLeft } from 'iconoir-react-native';
import { useTheme } from '../../../context/ThemeContext';
import { themes } from '../../../themes';
import { SettingsStackParamList } from '../../../navigation/types';

type Nav = NativeStackNavigationProp<SettingsStackParamList, 'WeatherLocationScreen'>;

export function WeatherLocationScreen() {
    const navigation = useNavigation<Nav>();
    const { theme, themeName } = useTheme();
    const palette = themes[themeName].palette;
    const insets = useSafeAreaInsets();

    const [lat, setLat] = useState('55.75');
    const [lon, setLon] = useState('37.62');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        AsyncStorage.getItem('weather_location').then(raw => {
            if (raw) {
                const loc = JSON.parse(raw);
                setLat(String(loc.lat));
                setLon(String(loc.lon));
            }
        });
    }, []);

    const handleUseCurrentLocation = async () => {
        setLoading(true);
        try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Permission denied', 'Location permission is required.');
                return;
            }
            const loc = await Location.getCurrentPositionAsync({});
            const newLat = String(loc.coords.latitude);
            const newLon = String(loc.coords.longitude);
            setLat(newLat);
            setLon(newLon);
            await AsyncStorage.setItem('weather_location', JSON.stringify({ lat: loc.coords.latitude, lon: loc.coords.longitude }));
            Alert.alert('Success', 'Location updated.');
        } catch {
            Alert.alert('Error', 'Failed to get current location.');
        } finally {
            setLoading(false);
        }
    };

    const styles = useMemo(() => StyleSheet.create({
        root: { flex: 1, backgroundColor: theme.background },
        header: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingBottom: 12,
            gap: 8,
        },
        backBtn: { padding: 4 },
        title: { fontSize: 24, fontWeight: '700', color: theme.textPrimary },
        body: { paddingHorizontal: 16, paddingTop: 24 },
        coordCard: {
            backgroundColor: theme.surface,
            borderRadius: 12,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.border,
            padding: 16,
            marginBottom: 24,
        },
        coordLabel: { fontSize: 13, color: theme.fadedText, marginBottom: 4 },
        coordValue: { fontSize: 22, fontWeight: '600', color: theme.textPrimary, fontVariant: ['tabular-nums'] },
        hint: { fontSize: 14, color: theme.fadedText, marginBottom: 20, lineHeight: 20 },
        locationBtn: {
            backgroundColor: theme.surface,
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: 12,
            paddingVertical: 14,
            alignItems: 'center',
            flexDirection: 'row',
            justifyContent: 'center',
            gap: 8,
        },
        locationBtnText: { color: theme.textPrimary, fontWeight: '500', fontSize: 16 },
    }), [theme, palette]);

    return (
        <View style={[styles.root, { paddingTop: insets.top }]}>
            <View style={styles.header}>
                <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <NavArrowLeft width={24} height={24} color={theme.textPrimary} />
                </Pressable>
                <Text style={styles.title}>Weather Location</Text>
            </View>
            <View style={styles.body}>
                <View style={styles.coordCard}>
                    <Text style={styles.coordLabel}>Latitude</Text>
                    <Text style={styles.coordValue}>{lat}</Text>
                    <View style={{ height: 12 }} />
                    <Text style={styles.coordLabel}>Longitude</Text>
                    <Text style={styles.coordValue}>{lon}</Text>
                </View>
                <Text style={styles.hint}>
                    Weather is fetched based on these coordinates. Tap below to update them using your current GPS position.
                </Text>
                <Pressable onPress={handleUseCurrentLocation} disabled={loading} style={styles.locationBtn}>
                    {loading
                        ? <ActivityIndicator size="small" color={theme.textPrimary} />
                        : <Text style={styles.locationBtnText}>Use Current Location</Text>
                    }
                </Pressable>
            </View>
        </View>
    );
}
