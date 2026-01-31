import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useTheme } from '../../../context/ThemeContext';

const DOT_COUNT = 3;
const ANIMATION_DURATION = 400;
const DELAY_BETWEEN_DOTS = 150;

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 6,
    },
    dot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        marginRight: 4,
    },
});

export function TypingIndicator() {
    const { theme } = useTheme();
    const opacityValues = useRef(
        Array.from({ length: DOT_COUNT }, () => new Animated.Value(0.3)),
    ).current;

    useEffect(() => {
        const animations = opacityValues.map((opacity, index) => {
            const delay = index * DELAY_BETWEEN_DOTS;
            return Animated.loop(
                Animated.sequence([
                    Animated.delay(delay),
                    Animated.timing(opacity, {
                        toValue: 1,
                        duration: ANIMATION_DURATION,
                        useNativeDriver: true,
                    }),
                    Animated.timing(opacity, {
                        toValue: 0.3,
                        duration: ANIMATION_DURATION,
                        useNativeDriver: true,
                    }),
                ]),
            );
        });

        const composite = Animated.parallel(animations);
        composite.start();
        return () => composite.stop();
    }, [opacityValues]);

    return (
        <View style={styles.container}>
            {opacityValues.map((opacity, index) => (
                <Animated.View
                    key={index}
                    style={[
                        styles.dot,
                        {
                            backgroundColor: theme.accent,
                            marginRight: index < DOT_COUNT - 1 ? 4 : 0,
                            opacity,
                        },
                    ]}
                />
            ))}
        </View>
    );
}
