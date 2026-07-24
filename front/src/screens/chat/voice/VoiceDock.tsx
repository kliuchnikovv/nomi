import React, { useEffect } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withRepeat,
    withTiming,
    withSequence,
    withDelay,
    cancelAnimation,
    Easing,
} from 'react-native-reanimated';
import { Text } from '@genie/ds';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../context/ThemeContext';
import type { VoiceState } from './useVoiceConversation';

type Props = {
    state: VoiceState;
    onExit: () => void;
    onMicPress: () => void;
};

const BAR_COUNT = 5;
const BAR_DELAYS_MS = [0, 90, 180, 270, 120];

function statusLabel(state: VoiceState): string {
    switch (state) {
        case 'loading':
            return 'preparing…';
        case 'listening':
            return 'listening…';
        case 'processing':
            return 'thinking…';
        case 'speaking':
            return 'speaking · tap to interrupt';
        case 'error':
            return 'unavailable';
        case 'idle':
        default:
            return 'ready';
    }
}

function WaveformBar({
    delay,
    color,
    active,
}: {
    delay: number;
    color: string;
    active: boolean;
}) {
    const scale = useSharedValue(0.28);

    useEffect(() => {
        if (!active) {
            cancelAnimation(scale);
            scale.value = withTiming(0.28, { duration: 200 });
            return;
        }
        scale.value = withDelay(
            delay,
            withRepeat(
                withSequence(
                    withTiming(1, {
                        duration: 380,
                        easing: Easing.inOut(Easing.sin),
                    }),
                    withTiming(0.28, {
                        duration: 380,
                        easing: Easing.inOut(Easing.sin),
                    }),
                ),
                -1,
                false,
            ),
        );
        return () => {
            cancelAnimation(scale);
        };
    }, [active, delay, scale]);

    const style = useAnimatedStyle(() => ({
        transform: [{ scaleY: scale.value }],
    }));

    return (
        <Animated.View
            style={[styles.bar, { backgroundColor: color }, style]}
        />
    );
}

export function VoiceDock({ state, onExit, onMicPress }: Props) {
    const { theme, descriptor } = useTheme();
    const active = state === 'listening' || state === 'speaking';
    const label = statusLabel(state);

    // Alternate accent / accentAlt across bars for the same waveform gradient
    // vibe used elsewhere in the voice affordance.
    const barColor = (i: number): string =>
        i % 2 === 0 ? theme.accentAlt : theme.accent;

    return (
        <View style={styles.wrap}>
            <View
                style={[
                    styles.dock,
                    {
                        backgroundColor: theme.surface,
                        borderColor: theme.border,
                        shadowColor: theme.accent,
                    },
                ]}
            >
                <Pressable
                    onPress={onExit}
                    hitSlop={8}
                    style={({ pressed }) => [
                        styles.sideBtn,
                        {
                            backgroundColor: theme.surfaceHighlight,
                            opacity: pressed ? 0.7 : 1,
                        },
                    ]}
                    accessibilityLabel="Switch to keyboard"
                    accessibilityRole="button"
                >
                    <Ionicons
                        name="chatbubble-ellipses-outline"
                        size={18}
                        color={theme.text}
                    />
                </Pressable>

                <View style={styles.waveform}>
                    {Array.from({ length: BAR_COUNT }).map((_, i) => (
                        <WaveformBar
                            key={i}
                            delay={BAR_DELAYS_MS[i]}
                            color={barColor(i)}
                            active={active}
                        />
                    ))}
                </View>

                <Text
                    theme={descriptor}
                    style={[styles.label, { color: theme.textSecondary }]}
                    numberOfLines={1}
                >
                    {label}
                </Text>

                <Pressable
                    onPress={onMicPress}
                    hitSlop={8}
                    style={({ pressed }) => [
                        styles.sideBtn,
                        {
                            backgroundColor: theme.accent,
                            opacity: pressed ? 0.8 : 1,
                        },
                    ]}
                    accessibilityLabel={
                        state === 'speaking' ? 'Interrupt' : 'Voice active'
                    }
                    accessibilityRole="button"
                >
                    <Ionicons name="mic" size={18} color="#fff" />
                </Pressable>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        paddingHorizontal: 12,
        paddingTop: 8,
        paddingBottom: 8,
    },
    dock: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 52,
        borderRadius: 26,
        borderWidth: 1,
        paddingHorizontal: 7,
        gap: 10,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.35,
        shadowRadius: 6,
        elevation: 3,
    },
    sideBtn: {
        width: 38,
        height: 38,
        borderRadius: 19,
        alignItems: 'center',
        justifyContent: 'center',
    },
    waveform: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        width: 44,
        height: 22,
        justifyContent: 'center',
    },
    bar: {
        width: 3,
        height: 22,
        borderRadius: 2,
    },
    label: {
        flex: 1,
        fontSize: 14,
        fontWeight: '500',
    },
});
