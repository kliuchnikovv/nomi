import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Linking, Platform } from 'react-native';
import { useTheme } from '../../../context/ThemeContext';
import { Ionicons } from '@expo/vector-icons';
import { weatherApi } from '../../../apiClient';
import { getStoredLocation } from '../../../services/location/locationService';

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

    const getWeatherIconAndColor = (code: number) => {
        // WMO Weather interpretation codes with distinct colors
        if (code === 0) return { icon: 'sunny', color: '#FFB800' };           // Clear sky - warm yellow
        if (code <= 3) return { icon: 'partly-sunny', color: '#F59E0B' };     // Partly cloudy - orange
        if (code <= 48) return { icon: 'cloudy', color: '#94A3B8' };          // Foggy/cloudy - grey
        if (code <= 67) return { icon: 'rainy', color: '#3B82F6' };           // Rain - blue
        if (code <= 77) return { icon: 'snow', color: '#67E8F9' };            // Snow - light cyan
        if (code <= 99) return { icon: 'thunderstorm', color: '#A855F7' };    // Thunderstorm - purple
        return { icon: 'cloudy', color: '#94A3B8' };
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

    const weatherInfo = weather ? getWeatherIconAndColor(weather.weathercode) : null;

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
                ) : weather && weatherInfo ? (
                    <TouchableOpacity onPress={handleWeatherPress} style={styles.weatherContainer}>
                        <Ionicons
                            name={weatherInfo.icon as any}
                            size={32}
                            color={weatherInfo.color}
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
