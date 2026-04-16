// front/src/screens/dashboard/components/WeatherWidget.tsx
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Linking, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../context/ThemeContext';
import { weatherApi } from '../../../apiClient';
import { getStoredLocation } from '../../../services/location/locationService';

interface WeatherData {
    temperature: number;
    weathercode: number;
}

function getWeatherIconAndColor(code: number) {
    if (code === 0) return { icon: 'sunny', color: '#FFB800' };
    if (code <= 3) return { icon: 'partly-sunny', color: '#F59E0B' };
    if (code <= 48) return { icon: 'cloudy', color: '#94A3B8' };
    if (code <= 67) return { icon: 'rainy', color: '#3B82F6' };
    if (code <= 77) return { icon: 'snow', color: '#67E8F9' };
    if (code <= 99) return { icon: 'thunderstorm', color: '#A855F7' };
    return { icon: 'cloudy', color: '#94A3B8' };
}

export function WeatherWidget() {
    const { theme } = useTheme();
    const [weather, setWeather] = useState<WeatherData | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        loadWeather();
    }, []);

    const loadWeather = async () => {
        setLoading(true);
        try {
            const loc = await getStoredLocation();
            const data = await weatherApi.getCurrentWeather(loc.lat, loc.lon);
            if (data?.current_weather) {
                setWeather({
                    temperature: data.current_weather.temperature,
                    weathercode: data.current_weather.weathercode,
                });
            }
        } catch (e) {
            console.error('Failed to load weather:', e);
        } finally {
            setLoading(false);
        }
    };

    const handlePress = () => {
        const scheme = Platform.select({
            ios: 'weather://',
            android: 'https://www.google.com/search?q=weather',
        });
        if (scheme) {
            Linking.openURL(scheme).catch(() => {
                Linking.openURL('https://www.google.com/search?q=weather');
            });
        }
    };

    const weatherInfo = weather ? getWeatherIconAndColor(weather.weathercode) : null;

    return (
        <TouchableOpacity
            style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
            onPress={handlePress}
            activeOpacity={0.8}
        >
            {loading ? (
                <ActivityIndicator size="small" color={theme.accent} />
            ) : weather && weatherInfo ? (
                <View style={styles.tempRow}>
                    <Ionicons name={weatherInfo.icon as any} size={36} color={weatherInfo.color} />
                    <Text style={[styles.temp, { color: theme.textPrimary }]}>
                        {Math.round(weather.temperature)}°
                    </Text>
                </View>
            ) : (
                <Ionicons name="cloud-outline" size={32} color={theme.textSecondary} />
            )}
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    card: {
        flex: 1,
        padding: 16,
        borderRadius: 16,
        borderWidth: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    tempRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    temp: {
        fontSize: 32,
        fontWeight: '700',
    },
});
