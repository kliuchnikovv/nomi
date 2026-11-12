// front/src/screens/dashboard/components/WeatherWidget.tsx
import React, { useState, useEffect } from 'react';
import {
    View,
    StyleSheet,
    TouchableOpacity,
    Linking,
    Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card, Spinner, Text } from '@nomi/ds';
import { useTheme } from '../../../context/ThemeContext';
import { weatherApi } from '../../../apiClient';
import { getStoredLocation } from '../../../services/location/locationService';

interface WeatherData {
    temperature: number;
    weathercode: number;
}

// Weather code → semantic icon+color mapping. Not DS tokens — these encode
// meteorological semantics (sunny/cloudy/rainy/…) that don't map to app themes.
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
    const { theme, descriptor } = useTheme();
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

    const weatherInfo = weather
        ? getWeatherIconAndColor(weather.weathercode)
        : null;

    return (
        <TouchableOpacity
            onPress={handlePress}
            activeOpacity={0.8}
            style={{ flex: 1, borderRadius: descriptor.radius.lg }}
        >
            <Card
                theme={descriptor}
                padding="lg"
                radius="lg"
                bordered
                style={styles.card}
            >
                {loading ? (
                    <Spinner theme={descriptor} size="sm" tone="accent" />
                ) : weather && weatherInfo ? (
                    <View style={styles.tempRow}>
                        <Ionicons
                            name={weatherInfo.icon as any}
                            size={36}
                            color={weatherInfo.color}
                        />
                        <Text
                            theme={descriptor}
                            variant="display"
                            tone="primary"
                            weight="700"
                        >
                            {Math.round(weather.temperature)}°
                        </Text>
                    </View>
                ) : (
                    <Ionicons
                        name="cloud-outline"
                        size={32}
                        color={theme.textSecondary}
                    />
                )}
            </Card>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    card: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    tempRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
