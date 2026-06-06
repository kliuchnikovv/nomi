import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';

type Props = {
    status: string | null;
    theme: {
        background: string;
        text: string;
        secondaryText?: string;
        primary?: string;
    };
};

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const INTERVAL_MS = 80;

function ElegantSpinner({ color }: { color: string }) {
    const [frame, setFrame] = useState(0);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        intervalRef.current = setInterval(() => {
            setFrame(f => (f + 1) % FRAMES.length);
        }, INTERVAL_MS);
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, []);

    return <Text style={[styles.spinner, { color }]}>{FRAMES[frame]}</Text>;
}

export function GenerationStatusBar({ status, theme }: Props) {
    const opacity = useRef(new Animated.Value(0)).current;
    const translateY = useRef(new Animated.Value(8)).current;

    useEffect(() => {
        if (status !== null) {
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
            Animated.timing(opacity, {
                toValue: 0,
                duration: 150,
                useNativeDriver: true,
            }).start();
        }
    }, [status]);

    const textColor = theme.secondaryText ?? theme.text;
    const spinnerColor = theme.primary ?? '#999';

    return (
        <Animated.View
            style={[
                styles.container,
                {
                    backgroundColor: 'transparent',
                    opacity,
                    transform: [{ translateY }],
                    paddingVertical: status !== null ? 6 : 0,
                },
            ]}
            pointerEvents="none"
        >
            {status !== null && (
                <View style={styles.row}>
                    <ElegantSpinner color={spinnerColor} />
                </View>
            )}
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingHorizontal: 16,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    spinner: {
        fontSize: 14,
        lineHeight: 18,
        fontWeight: '400',
    },
    text: {
        fontSize: 13,
        opacity: 0.7,
    },
});
