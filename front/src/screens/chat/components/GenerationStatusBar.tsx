import React, { useEffect, useRef } from 'react';
import { View, Text, ActivityIndicator, Animated, StyleSheet } from 'react-native';

type Props = {
    status: string | null;
    theme: {
        background: string;
        text: string;
        secondaryText?: string;
        primary?: string;
    };
};

export function GenerationStatusBar({ status, theme }: Props) {
    const opacity = useRef(new Animated.Value(0)).current;
    const translateY = useRef(new Animated.Value(8)).current;
    const prevStatusRef = useRef<string | null>(null);

    useEffect(() => {
        if (status !== null) {
            // Appear: slide up + fade in
            Animated.parallel([
                Animated.timing(opacity, {
                    toValue: 1,
                    duration: 180,
                    useNativeDriver: true,
                }),
                Animated.timing(translateY, {
                    toValue: 0,
                    duration: 180,
                    useNativeDriver: true,
                }),
            ]).start();
        } else {
            // Disappear: fade out only
            Animated.timing(opacity, {
                toValue: 0,
                duration: 150,
                useNativeDriver: true,
            }).start();
        }
        prevStatusRef.current = status;
    }, [status]);

    // Keep rendering during fade-out so animation completes
    const textColor = theme.secondaryText ?? theme.text;
    const spinnerColor = theme.primary ?? '#999';

    return (
        <Animated.View
            style={[
                styles.container,
                { backgroundColor: theme.background, opacity, transform: [{ translateY }] },
            ]}
            pointerEvents="none"
        >
            {status !== null && (
                <View style={styles.row}>
                    <ActivityIndicator size="small" color={spinnerColor} style={styles.spinner} />
                    <Text style={[styles.text, { color: textColor }]} numberOfLines={1}>
                        {status}
                    </Text>
                </View>
            )}
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingHorizontal: 16,
        paddingVertical: 6,
        minHeight: 32,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    spinner: {
        marginRight: 8,
    },
    text: {
        fontSize: 13,
        opacity: 0.7,
    },
});
