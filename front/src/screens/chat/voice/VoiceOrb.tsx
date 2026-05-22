import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet } from 'react-native';
import { useTheme } from '../../../context/ThemeContext';
import type { VoiceState } from './useVoiceConversation';

interface Props {
    state: VoiceState;
}

const SIZE = 120;
const DOT = 7;
const HALF = DOT / 2;

// Outer ring: 8 dots, radius 48, clockwise from top
const OUTER_R = 48;
const outerPositions = Array.from({ length: 8 }, (_, i) => {
    const a = ((i * 45 - 90) * Math.PI) / 180;
    return {
        left: SIZE / 2 + OUTER_R * Math.cos(a) - HALF,
        top: SIZE / 2 + OUTER_R * Math.sin(a) - HALF,
    };
});

// Inner Braille: 2×3 grid, centered
const B_COL = 20;
const B_ROW = 18;
const braillePositions = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
    [0, 2],
    [1, 2],
].map(([c, r]) => ({
    left: SIZE / 2 - B_COL / 2 + c * B_COL - HALF,
    top: SIZE / 2 - B_ROW + r * B_ROW - HALF,
}));

const DIM = 0.12;

export function VoiceOrb({ state }: Props) {
    const { theme } = useTheme();

    const outerOps = useRef(
        outerPositions.map(() => new Animated.Value(DIM)),
    ).current;
    const innerOps = useRef(
        braillePositions.map(() => new Animated.Value(DIM)),
    ).current;
    const loopRef = useRef<Animated.CompositeAnimation | null>(null);

    useEffect(() => {
        loopRef.current?.stop();
        [...outerOps, ...innerOps].forEach(v => v.setValue(DIM));

        if (state === 'listening') {
            // Seamless clockwise sweep — each dot has identical period (1400ms)
            // with phase offset baked in via initial delay that repeats per iteration
            const PERIOD = 1400;
            const STAGGER = PERIOD / 8; // 175ms
            const FLASH = 70;
            loopRef.current = Animated.parallel(
                outerOps.map((opacity, i) => {
                    const phase = i * STAGGER;
                    const fade = PERIOD - phase - FLASH;
                    return Animated.loop(
                        Animated.sequence([
                            Animated.delay(phase),
                            Animated.timing(opacity, {
                                toValue: 1,
                                duration: FLASH,
                                useNativeDriver: true,
                            }),
                            Animated.timing(opacity, {
                                toValue: DIM,
                                duration: fade,
                                useNativeDriver: true,
                            }),
                        ]),
                    );
                }),
            );
            loopRef.current.start();
        } else if (state === 'processing') {
            // Braille dots light up one-by-one in sequence (like being "typed")
            loopRef.current = Animated.loop(
                Animated.sequence(
                    innerOps.map(opacity =>
                        Animated.sequence([
                            Animated.timing(opacity, {
                                toValue: 1,
                                duration: 100,
                                useNativeDriver: true,
                            }),
                            Animated.timing(opacity, {
                                toValue: DIM,
                                duration: 320,
                                useNativeDriver: true,
                            }),
                        ]),
                    ),
                ),
            );
            loopRef.current.start();
        } else if (state === 'speaking') {
            // Outer ring and inner Braille pulse alternately — outer/inner ripple
            loopRef.current = Animated.loop(
                Animated.sequence([
                    Animated.parallel([
                        ...outerOps.map(o =>
                            Animated.timing(o, {
                                toValue: 0.9,
                                duration: 350,
                                useNativeDriver: true,
                            }),
                        ),
                        ...innerOps.map(o =>
                            Animated.timing(o, {
                                toValue: DIM,
                                duration: 350,
                                useNativeDriver: true,
                            }),
                        ),
                    ]),
                    Animated.parallel([
                        ...outerOps.map(o =>
                            Animated.timing(o, {
                                toValue: DIM,
                                duration: 350,
                                useNativeDriver: true,
                            }),
                        ),
                        ...innerOps.map(o =>
                            Animated.timing(o, {
                                toValue: 0.9,
                                duration: 350,
                                useNativeDriver: true,
                            }),
                        ),
                    ]),
                ]),
            );
            loopRef.current.start();
        } else if (state === 'error') {
            [...outerOps, ...innerOps].forEach(v => v.setValue(0.85));
        }
        // idle: stays DIM (already reset above)
    }, [state]);

    const dotColor =
        state === 'error' ? theme.error ?? theme.attention : theme.accent;

    return (
        <View style={styles.container}>
            {outerPositions.map((pos, i) => (
                <Animated.View
                    key={`o${i}`}
                    style={[
                        styles.dot,
                        {
                            left: pos.left,
                            top: pos.top,
                            backgroundColor: dotColor,
                            opacity: outerOps[i],
                        },
                    ]}
                />
            ))}
            {braillePositions.map((pos, i) => (
                <Animated.View
                    key={`b${i}`}
                    style={[
                        styles.dot,
                        {
                            left: pos.left,
                            top: pos.top,
                            backgroundColor: dotColor,
                            opacity: innerOps[i],
                        },
                    ]}
                />
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        width: SIZE,
        height: SIZE,
    },
    dot: {
        position: 'absolute',
        width: DOT,
        height: DOT,
        borderRadius: HALF,
    },
});
