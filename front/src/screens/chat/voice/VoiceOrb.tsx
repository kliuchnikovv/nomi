import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet } from 'react-native';
import { useTheme } from '../../../context/ThemeContext';
import type { VoiceState } from './useVoiceConversation';

interface Props {
    state: VoiceState;
}

const ORB_SIZE = 120;

export function VoiceOrb({ state }: Props) {
    const { theme } = useTheme();
    const pulseScale = useRef(new Animated.Value(1)).current;
    const pulseOpacity = useRef(new Animated.Value(0)).current;
    const glowOpacity = useRef(new Animated.Value(0.3)).current;
    const loopRef = useRef<Animated.CompositeAnimation | null>(null);

    useEffect(() => {
        loopRef.current?.stop();

        if (state === 'listening') {
            pulseScale.setValue(1);
            pulseOpacity.setValue(0.5);
            loopRef.current = Animated.loop(
                Animated.parallel([
                    Animated.timing(pulseScale, { toValue: 1.6, duration: 1400, useNativeDriver: true }),
                    Animated.timing(pulseOpacity, { toValue: 0, duration: 1400, useNativeDriver: true }),
                ]),
            );
            loopRef.current.start();
        } else if (state === 'speaking') {
            glowOpacity.setValue(0.3);
            loopRef.current = Animated.loop(
                Animated.sequence([
                    Animated.timing(glowOpacity, { toValue: 0.7, duration: 700, useNativeDriver: true }),
                    Animated.timing(glowOpacity, { toValue: 0.3, duration: 700, useNativeDriver: true }),
                ]),
            );
            loopRef.current.start();
        } else {
            pulseScale.setValue(1);
            pulseOpacity.setValue(0);
            glowOpacity.setValue(0);
        }
    }, [state, pulseScale, pulseOpacity, glowOpacity]);

    const orbColor =
        state === 'error' ? '#ef4444' :
        state === 'processing' ? '#374151' :
        theme.accent;

    return (
        <View style={styles.container}>
            {state === 'listening' && (
                <Animated.View
                    style={[
                        styles.ring,
                        {
                            borderColor: theme.accent,
                            transform: [{ scale: pulseScale }],
                            opacity: pulseOpacity,
                        },
                    ]}
                />
            )}
            {state === 'speaking' && (
                <Animated.View
                    style={[styles.glow, { backgroundColor: theme.accent, opacity: glowOpacity }]}
                />
            )}
            <View style={[styles.orb, { backgroundColor: orbColor }]}>
                {state === 'processing' && (
                    <View style={styles.dots}>
                        {[1, 0.6, 0.3].map((opacity, i) => (
                            <View
                                key={i}
                                style={[styles.dot, { backgroundColor: theme.accent, opacity }]}
                            />
                        ))}
                    </View>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        width: ORB_SIZE,
        height: ORB_SIZE,
        alignItems: 'center',
        justifyContent: 'center',
    },
    ring: {
        position: 'absolute',
        width: ORB_SIZE,
        height: ORB_SIZE,
        borderRadius: ORB_SIZE / 2,
        borderWidth: 2,
    },
    glow: {
        position: 'absolute',
        width: ORB_SIZE + 24,
        height: ORB_SIZE + 24,
        borderRadius: (ORB_SIZE + 24) / 2,
    },
    orb: {
        width: ORB_SIZE,
        height: ORB_SIZE,
        borderRadius: ORB_SIZE / 2,
        alignItems: 'center',
        justifyContent: 'center',
    },
    dots: { flexDirection: 'row', gap: 6 },
    dot: { width: 8, height: 8, borderRadius: 4 },
});
