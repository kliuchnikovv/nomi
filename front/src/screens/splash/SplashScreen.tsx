import React, { useEffect, useRef } from 'react';
import {
    Animated,
    ActivityIndicator,
    SafeAreaView,
    StyleSheet,
    Text,
    View,
} from 'react-native';

// Hardcoded retroSunset palette — ThemeProvider is not mounted yet at splash time
const COLORS = {
    background: '#163D53',  // retroSunset.background
    text:       '#F5F0E6',  // retroSunset.textPrimary
    textFaded:  'rgba(245, 240, 230, 0.6)',
    textSubtle: 'rgba(245, 240, 230, 0.5)',
    textGhost:  'rgba(245, 240, 230, 0.3)',
    accent:     '#399CA7',  // retroSunset.accent
} as const;

interface SplashScreenProps {
    initStatus: string;
}

export function SplashScreen({ initStatus }: SplashScreenProps) {
    const fadeAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 400,
            useNativeDriver: true,
        }).start();
    }, [fadeAnim]);

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.spacer} />

            <Animated.View style={[styles.center, { opacity: fadeAnim }]}>
                <Text style={styles.appName}>Genie</Text>
                <Text style={styles.tagline}>Your AI Assistant</Text>

                <View style={styles.divider} />

                <ActivityIndicator size="small" color={COLORS.accent} />
                <Text style={styles.statusText}>{initStatus}</Text>
            </Animated.View>

            <View style={styles.spacer} />

            <Animated.View style={[styles.footer, { opacity: fadeAnim }]}>
                <Text style={styles.versionText}>v0.0.1</Text>
                <Text style={styles.poweredBy}>Powered by Anthropic</Text>
            </Animated.View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: COLORS.background,
    },
    spacer: {
        flex: 1,
    },
    center: {
        alignItems: 'center',
        paddingHorizontal: 32,
    },
    appName: {
        fontSize: 42,
        fontWeight: 'bold',
        color: COLORS.text,
        letterSpacing: 1,
    },
    tagline: {
        fontSize: 16,
        color: COLORS.textFaded,
        marginTop: 6,
    },
    divider: {
        width: 40,
        height: 1,
        backgroundColor: COLORS.accent,
        marginVertical: 28,
    },
    statusText: {
        fontSize: 13,
        color: COLORS.textSubtle,
        marginTop: 12,
        textAlign: 'center',
    },
    footer: {
        alignItems: 'center',
        paddingBottom: 24,
    },
    versionText: {
        fontSize: 11,
        color: COLORS.textGhost,
    },
    poweredBy: {
        fontSize: 11,
        color: COLORS.textGhost,
        marginTop: 2,
    },
});
