import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
    Easing,
    SharedValue,
    cancelAnimation,
    interpolate,
    useAnimatedStyle,
    useSharedValue,
    withDelay,
    withRepeat,
    withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../../context/ThemeContext';
import type { VoiceState } from './useVoiceConversation';

interface Props {
    state: VoiceState;
}

// Sizing — the region must fit the fully-expanded ripple (CORE * RIPPLE_MAX_SCALE).
const CORE = 140;
const RIPPLE_MAX_SCALE = 1.9;
const REGION = Math.ceil(CORE * RIPPLE_MAX_SCALE) + 8; // ~274
const RIPPLE_COUNT = 3;

// Per-state animation tuning. A duration of 0 disables that channel.
type Tuning = {
    breathTo: number;
    breathDur: number;
    rotDur: number;
    rippleDur: number;
    rippleOpacity: number;
};

const TUNING: Record<VoiceState, Tuning> = {
    // Engine warming up — gentle, unhurried.
    loading: {
        breathTo: 1.04,
        breathDur: 2200,
        rotDur: 16000,
        rippleDur: 0,
        rippleOpacity: 0,
    },
    // Calm resting breath.
    idle: {
        breathTo: 1.06,
        breathDur: 2600,
        rotDur: 14000,
        rippleDur: 3200,
        rippleOpacity: 0.16,
    },
    // The orb "hears" — brighter, quicker, waves emanate outward.
    listening: {
        breathTo: 1.1,
        breathDur: 1500,
        rotDur: 9000,
        rippleDur: 1900,
        rippleOpacity: 0.36,
    },
    // Thinking — tight quick pulse, fast swirl, ripples muted.
    processing: {
        breathTo: 1.05,
        breathDur: 900,
        rotDur: 4200,
        rippleDur: 0,
        rippleOpacity: 0,
    },
    // The orb "talks" — rhythmic, rapid wave emission.
    speaking: {
        breathTo: 1.12,
        breathDur: 720,
        rotDur: 7000,
        rippleDur: 640,
        rippleOpacity: 0.42,
    },
    // Static, no motion.
    error: {
        breathTo: 1,
        breathDur: 0,
        rotDur: 0,
        rippleDur: 0,
        rippleOpacity: 0,
    },
};

export function VoiceOrb({ state }: Props) {
    const { theme } = useTheme();
    const isError = state === 'error';
    const errorColor = theme.error ?? theme.attention;

    const breath = useSharedValue(1);
    const rot = useSharedValue(0);
    const rippleIntensity = useSharedValue(0);
    // Fixed set of ripple progress values (0 → 1, looping with stagger).
    const r0 = useSharedValue(0);
    const r1 = useSharedValue(0);
    const r2 = useSharedValue(0);

    useEffect(() => {
        const t = TUNING[state];
        const ripples = [r0, r1, r2];

        // ── Breathing ──────────────────────────────────────────────────────
        cancelAnimation(breath);
        if (t.breathDur > 0) {
            breath.value = withRepeat(
                withTiming(t.breathTo, {
                    duration: t.breathDur,
                    easing: Easing.inOut(Easing.sin),
                }),
                -1,
                true,
            );
        } else {
            breath.value = withTiming(1, { duration: 300 });
        }

        // ── Blob rotation (continuous swirl) ─────────────────────────────────
        cancelAnimation(rot);
        if (t.rotDur > 0) {
            rot.value = 0;
            rot.value = withRepeat(
                withTiming(360, { duration: t.rotDur, easing: Easing.linear }),
                -1,
                false,
            );
        }

        // ── Ripple waves ─────────────────────────────────────────────────────
        rippleIntensity.value = withTiming(t.rippleOpacity, { duration: 300 });
        ripples.forEach((rv, i) => {
            cancelAnimation(rv);
            rv.value = 0;
            if (t.rippleDur > 0) {
                rv.value = withDelay(
                    (t.rippleDur / RIPPLE_COUNT) * i,
                    withRepeat(
                        withTiming(1, {
                            duration: t.rippleDur,
                            easing: Easing.out(Easing.ease),
                        }),
                        -1,
                        false,
                    ),
                );
            }
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state]);

    const breathStyle = useAnimatedStyle(() => ({
        transform: [{ scale: breath.value }],
    }));
    const glowStyle = useAnimatedStyle(() => ({
        transform: [{ scale: breath.value * 1.08 }],
    }));
    const blobAStyle = useAnimatedStyle(() => ({
        transform: [{ rotate: `${rot.value}deg` }],
    }));
    const blobBStyle = useAnimatedStyle(() => ({
        transform: [{ rotate: `${-rot.value}deg` }],
    }));

    const coreColors = isError
        ? ([errorColor, errorColor] as const)
        : ([theme.accent, theme.accentAlt] as const);
    const altColors = isError
        ? ([errorColor, errorColor] as const)
        : ([theme.accentAlt, theme.accent] as const);
    const rippleColor = isError ? errorColor : theme.accent;

    return (
        <View style={styles.region} pointerEvents="none">
            {/* Ripple waves */}
            <Ripple
                progress={r0}
                intensity={rippleIntensity}
                color={rippleColor}
            />
            <Ripple
                progress={r1}
                intensity={rippleIntensity}
                color={rippleColor}
            />
            <Ripple
                progress={r2}
                intensity={rippleIntensity}
                color={rippleColor}
            />

            {/* Soft outer glow */}
            <Animated.View style={[styles.glow, glowStyle]}>
                <LinearGradient
                    colors={coreColors}
                    start={{ x: 0.2, y: 0 }}
                    end={{ x: 0.8, y: 1 }}
                    style={styles.glowFill}
                />
            </Animated.View>

            {/* Breathing core — stacked, counter-rotating gradient lobes */}
            <Animated.View style={[styles.core, breathStyle]}>
                <Animated.View style={[styles.lobe, styles.lobeA, blobAStyle]}>
                    <LinearGradient
                        colors={coreColors}
                        start={{ x: 0.15, y: 0.1 }}
                        end={{ x: 0.85, y: 0.95 }}
                        style={styles.lobeFill}
                    />
                </Animated.View>
                <Animated.View style={[styles.lobe, styles.lobeB, blobBStyle]}>
                    <LinearGradient
                        colors={altColors}
                        start={{ x: 0.1, y: 0.2 }}
                        end={{ x: 0.9, y: 0.9 }}
                        style={styles.lobeFill}
                    />
                </Animated.View>
                {/* Top-left specular highlight for a glossy, "liquid" feel */}
                <View style={styles.highlight} />
            </Animated.View>
        </View>
    );
}

interface RippleProps {
    progress: SharedValue<number>;
    intensity: SharedValue<number>;
    color: string;
}

function Ripple({ progress, intensity, color }: RippleProps) {
    const style = useAnimatedStyle(() => ({
        opacity: intensity.value * (1 - progress.value),
        transform: [
            {
                scale: interpolate(
                    progress.value,
                    [0, 1],
                    [0.85, RIPPLE_MAX_SCALE],
                ),
            },
        ],
    }));
    return (
        <Animated.View style={[styles.ripple, { borderColor: color }, style]} />
    );
}

const styles = StyleSheet.create({
    region: {
        width: REGION,
        height: REGION,
        alignItems: 'center',
        justifyContent: 'center',
    },
    ripple: {
        position: 'absolute',
        width: CORE,
        height: CORE,
        borderRadius: CORE / 2,
        borderWidth: 2.5,
    },
    glow: {
        position: 'absolute',
        width: CORE,
        height: CORE,
        opacity: 0.28,
    },
    glowFill: {
        flex: 1,
        borderRadius: CORE / 2,
    },
    core: {
        width: CORE,
        height: CORE,
        alignItems: 'center',
        justifyContent: 'center',
    },
    lobe: {
        position: 'absolute',
        width: CORE,
        height: CORE,
    },
    lobeA: {
        borderRadius: CORE / 2,
        overflow: 'hidden',
    },
    lobeB: {
        // Slightly smaller and offset so the two lobes form a soft morphing blob.
        width: CORE * 0.92,
        height: CORE * 0.92,
        top: CORE * 0.06,
        left: CORE * 0.04,
        borderRadius: (CORE * 0.92) / 2,
        overflow: 'hidden',
        opacity: 0.65,
    },
    lobeFill: {
        flex: 1,
    },
    highlight: {
        position: 'absolute',
        top: CORE * 0.16,
        left: CORE * 0.18,
        width: CORE * 0.34,
        height: CORE * 0.24,
        borderRadius: CORE * 0.2,
        backgroundColor: 'rgba(255,255,255,0.35)',
    },
});
