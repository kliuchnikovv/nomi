import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Linking, Platform } from 'react-native';
import * as Location from 'expo-location';
import { useTheme } from '../../../context/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { weatherApi } from '../../../apiClient';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface WeatherData {
    temperature: number;
    weathercode: number;
}

export const GreetingCard = ({ userName }: { userName?: string }) => {
    const { theme } = useTheme();
    const [weather, setWeather] = useState<WeatherData | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        loadWeather();
    }, []);

    const loadWeather = async () => {
        setLoading(true);
        try {
            // Try to get current location
            const { status } = await Location.requestForegroundPermissionsAsync();

            let lat: number | null = null;
            let lon: number | null = null;

            if (status === 'granted') {
                const location = await Location.getCurrentPositionAsync({});
                lat = location.coords.latitude;
                lon = location.coords.longitude;
                // Update storage for consistency
                await AsyncStorage.setItem('weather_location', JSON.stringify({ lat, lon }));
            } else {
                // Try fallback to stored location if permission denied (or just don't show)
                // User requested: "if location not allowed - do not show weather"
                // So we just return if no permission/location.
                // However, we can check if we have previously stored location? 
                // The requirement says: "if not allowed location - do not show weather".
                // So strictly speaking, we should stop here.
                setLoading(false);
                return;
            }

            if (lat !== null && lon !== null) {
                const data = await weatherApi.getCurrentWeather(lat, lon);
                if (data?.current_weather) {
                    setWeather({
                        temperature: data.current_weather.temperature,
                        weathercode: data.current_weather.weathercode,
                    });
                }
            }
        } catch (e) {
            console.error('Failed to load weather:', e);
        } finally {
            setLoading(false);
        }
    };

    const handleWeatherPress = () => {
        const scheme = Platform.select({
            ios: 'weather://',
            android: 'https://www.google.com/search?q=weather'
        });

        if (scheme) {
            Linking.openURL(scheme).catch(() => {
                Linking.openURL('https://www.google.com/search?q=weather');
            });
        }
    };

    const getGreeting = () => {
        const hour = new Date().getHours();
        if (hour < 12) return 'Good morning';
        if (hour < 18) return 'Good afternoon';
        return 'Good evening';
    };

    const getWeatherIcon = (code: number) => {
        // WMO Weather interpretation codes
        if (code === 0) return 'sunny';
        if (code <= 3) return 'partly-sunny';
        if (code <= 67) return 'rainy';
        if (code <= 77) return 'snow';
        if (code <= 99) return 'thunderstorm';
        return 'cloudy';
    };

    const formatDate = () => {
        const now = new Date();
        const options: Intl.DateTimeFormatOptions = {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        };
        return now.toLocaleDateString('en-US', options);
    };

    return (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={styles.greetingRow}>
                <View style={styles.greetingContent}>
                    <Text style={[styles.greeting, { color: theme.text }]}>
                        {getGreeting()}{userName ? `, ${userName}` : ''}!
                    </Text>
                    <Text style={[styles.date, { color: theme.textSecondary }]}>
                        {formatDate()}
                    </Text>
                </View>
                {loading ? (
                    <ActivityIndicator size="small" color={theme.primary} />
                ) : weather ? (
                    <TouchableOpacity onPress={handleWeatherPress} style={styles.weatherContainer}>
                        <Ionicons
                            name={getWeatherIcon(weather.weathercode) as any}
                            size={32}
                            color={theme.primary}
                        />
                        <Text style={[styles.temperature, { color: theme.text }]}>
                            {Math.round(weather.temperature)}°
                        </Text>
                    </TouchableOpacity>
                ) : null}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    card: {
        marginHorizontal: 16,
        marginBottom: 8,
        padding: 20,
        borderRadius: 16,
        borderWidth: 1,
    },
    greetingRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    greetingContent: {
        flex: 1,
    },
    greeting: {
        fontSize: 24,
        fontWeight: '700',
        marginBottom: 4,
    },
    date: {
        fontSize: 14,
    },
    weatherContainer: {
        alignItems: 'center',
        gap: 4,
    },
    temperature: {
        fontSize: 18,
        fontWeight: '600',
    },
});
