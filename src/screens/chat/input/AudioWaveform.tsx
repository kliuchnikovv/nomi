import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { Svg, Rect } from 'react-native-svg';
import { useTheme } from '../../../context/ThemeContext';

type Props = {
    audioLevels: number[];
    duration: number; // in seconds
    maxDuration: number; // in seconds (60 for 1 minute)
};

const NUM_BARS = 40;

export default function AudioWaveform({ audioLevels, duration, maxDuration }: Props) {
    const { theme } = useTheme();
    const animatedValues = useRef(
        Array.from({ length: NUM_BARS }, () => new Animated.Value(0.1))
    ).current;

    useEffect(() => {
        // Animate bars based on audio levels
        const latestLevels = audioLevels.slice(-NUM_BARS);

        animatedValues.forEach((animValue, index) => {
            const level = latestLevels[index] || 0.1;
            Animated.spring(animValue, {
                toValue: Math.max(0.1, Math.min(1, level)),
                useNativeDriver: false,
                friction: 8,
                tension: 100,
            }).start();
        });
    }, [audioLevels, animatedValues]);

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const progress = duration / maxDuration;
    const isNearLimit = progress > 0.8;

    return (
        <View style={styles.container}>
            <View style={styles.waveformContainer}>
                <Svg height="40" width="100%" viewBox="0 0 400 40">
                    {animatedValues.map((animValue, index) => {
                        const x = (index * 400) / NUM_BARS;
                        const width = 400 / NUM_BARS - 2;

                        return (
                            <AnimatedRect
                                key={index}
                                x={x}
                                y={20}
                                width={width}
                                height={animValue}
                                fill={isNearLimit ? theme.attention : theme.accent}
                                opacity={0.8}
                                rx={2}
                            />
                        );
                    })}
                </Svg>
            </View>
            <Text
                style={[
                    styles.timer,
                    { color: isNearLimit ? theme.attention : theme.text },
                ]}
            >
                {formatTime(duration)} / {formatTime(maxDuration)}
            </Text>
        </View>
    );
}

// Create animated Rect component
const AnimatedRect = Animated.createAnimatedComponent(Rect);

const styles = StyleSheet.create({
    container: {
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 16,
        minHeight: 40,
    },
    waveformContainer: {
        width: '100%',
        height: 40,
        justifyContent: 'center',
        alignItems: 'center',
    },
    timer: {
        marginTop: 8,
        fontSize: 14,
        fontWeight: '600',
    },
});
