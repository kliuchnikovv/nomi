import React, { useEffect, useState, useRef } from 'react';
import {
    View,
    StyleSheet,
    TouchableOpacity,
    Modal,
    Dimensions,
} from 'react-native';
import { Text } from '@nomi/ds';
import { useTheme } from '../../../context/ThemeContext';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withSpring,
    withSequence,
    withTiming,
    runOnJS,
    Easing,
    withRepeat,
} from 'react-native-reanimated';
import Svg, { Polygon, Text as SvgText } from 'react-native-svg';

const { width, height } = Dimensions.get('window');

interface DiceRollOverlayProps {
    visible: boolean;
    expression: string | null;
    dc?: number | null;
    onComplete: (resultMessage: string) => void;
    onClose: () => void;
}

interface RollResult {
    total: number;
    rolls: number[];
    modifier: number;
    success?: boolean;
}

export const DiceRollOverlay: React.FC<DiceRollOverlayProps> = ({
    visible,
    expression,
    dc,
    onComplete,
    onClose,
}) => {
    const { descriptor } = useTheme();
    const [step, setStep] = useState<'prompt' | 'rolling' | 'result'>('prompt');
    const [displayNumber, setDisplayNumber] = useState<number | string>('?');
    const [result, setResult] = useState<RollResult | null>(null);

    // Animations
    const scale = useSharedValue(0.8);
    const rotation = useSharedValue(0);
    const translateY = useSharedValue(0);
    const opacity = useSharedValue(0);

    useEffect(() => {
        if (visible && expression) {
            // Reset state on open
            setStep('prompt');
            setDisplayNumber('?');
            setResult(null);
            scale.value = withSpring(1);
            opacity.value = withTiming(1);
            rotation.value = 0;
        } else {
            opacity.value = 0;
        }
    }, [visible, expression]);

    const parseAndRoll = (expr: string): RollResult => {
        // Simple parser for XdY+Z
        const match = expr.match(/(\d+)d(\d+)([\+\-]\d+)?/);

        let count = 1;
        let sides = 20;
        let modifier = 0;

        if (match) {
            count = parseInt(match[1], 10);
            sides = parseInt(match[2], 10);
            modifier = match[3] ? parseInt(match[3], 10) : 0;
        } else {
            console.warn('Invalid dice expression, defaulting to 1d20');
        }

        const rolls = [];
        for (let i = 0; i < count; i++) {
            rolls.push(Math.floor(Math.random() * sides) + 1);
        }

        const total = rolls.reduce((a, b) => a + b, 0) + modifier;
        const isSuccess = dc ? total >= dc : undefined;

        return { total, rolls, modifier, success: isSuccess };
    };

    const handleRoll = () => {
        if (!expression) return;
        setStep('rolling');

        // Animation: Shake and rotate
        rotation.value = withRepeat(
            withTiming(360, { duration: 500, easing: Easing.linear }),
            -1,
        );
        scale.value = withSequence(
            withTiming(1.2, { duration: 200 }),
            withTiming(0.9, { duration: 200 }),
            withTiming(1.1, { duration: 200 }),
        );

        // Pre-calculate result
        const rollResult = parseAndRoll(expression);
        setResult(rollResult);

        // Simulate cycling numbers
        let interval: any;
        const cycles = 15;
        let count = 0;

        interval = setInterval(() => {
            setDisplayNumber(Math.floor(Math.random() * 20) + 1);
            count++;
            if (count > cycles) {
                clearInterval(interval);
                finishRoll(rollResult);
            }
        }, 100);
    };

    const finishRoll = (finalResult: RollResult) => {
        // Stop rotation and settle
        rotation.value = 0;
        scale.value = withSpring(1.5, { stiffness: 200, damping: 10 });

        setStep('result');
        setDisplayNumber(finalResult.total);
    };

    const handleContinue = () => {
        if (!result || !expression) return;

        // Construct result message
        // "🎲 Result: 18 (Rolls: [15] + Mod: 3)"
        const rollsStr = `[${result.rolls.join(', ')}]`;
        const modStr =
            result.modifier >= 0 ? `+${result.modifier}` : `${result.modifier}`;
        const msg = `🎲 Result: ${result.total} (Rolls: ${rollsStr} ${modStr}${
            dc ? `, DC: ${dc}` : ''
        })`;

        opacity.value = withTiming(0, { duration: 300 }, finished => {
            if (finished) {
                runOnJS(onComplete)(msg);
            }
        });
    };

    // D20 SVG Path (Simplified Hexagon with internal lines)
    const D20Icon = () => (
        <Svg height="200" width="200" viewBox="0 0 100 100">
            {/* Outer Hexagon */}
            <Polygon
                points="50,5 95,27 95,73 50,95 5,73 5,27"
                fill="#2c3e50"
                stroke="#ecf0f1"
                strokeWidth="2"
            />
            {/* Inner Triangles - suggestive of D20 faces */}
            <Polygon
                points="50,95 50,50 95,73"
                fill="#34495e"
                stroke="#ecf0f1"
                strokeWidth="1"
            />
            <Polygon
                points="50,95 50,50 5,73"
                fill="#34495e"
                stroke="#ecf0f1"
                strokeWidth="1"
            />
            <Polygon
                points="50,5 50,50 95,27"
                fill="#34495e"
                stroke="#ecf0f1"
                strokeWidth="1"
            />
            <Polygon
                points="50,5 50,50 5,27"
                fill="#34495e"
                stroke="#ecf0f1"
                strokeWidth="1"
            />
            <Polygon
                points="5,27 50,50 5,73"
                fill="#34495e"
                stroke="#ecf0f1"
                strokeWidth="1"
            />
            <Polygon
                points="95,27 50,50 95,73"
                fill="#34495e"
                stroke="#ecf0f1"
                strokeWidth="1"
            />
        </Svg>
    );

    const animatedStyle = useAnimatedStyle(() => {
        return {
            transform: [
                { scale: scale.value },
                { rotate: `${rotation.value}deg` },
            ],
            opacity: opacity.value,
        };
    });

    if (!visible) return null;

    return (
        <Modal transparent visible={visible} animationType="fade">
            <View style={styles.container}>
                {/* Backdrop with Blur or Darken */}
                <View style={styles.backdrop} />

                <View style={styles.content}>
                    {/* Header Text */}
                    {step === 'prompt' && (
                        <Text theme={descriptor} style={styles.title}>
                            Dice Check Required
                        </Text>
                    )}
                    {step === 'rolling' && (
                        <Text theme={descriptor} style={styles.title}>
                            Rolling...
                        </Text>
                    )}
                    {step === 'result' && result && (
                        <Text
                            theme={descriptor}
                            style={[
                                styles.title,
                                result.success === true
                                    ? styles.success
                                    : result.success === false
                                    ? styles.failure
                                    : {},
                            ]}
                        >
                            {result.success === true
                                ? 'SUCCESS!'
                                : result.success === false
                                ? 'FAILURE!'
                                : 'RESULT'}
                        </Text>
                    )}

                    {/* DC info */}
                    {dc && step !== 'result' && (
                        <Text theme={descriptor} style={styles.subtitle}>
                            Difficulty Class: {dc}
                        </Text>
                    )}

                    {/* The Dice */}
                    <TouchableOpacity
                        activeOpacity={0.9}
                        onPress={step === 'prompt' ? handleRoll : undefined}
                        disabled={step !== 'prompt'}
                    >
                        <Animated.View
                            style={[styles.diceContainer, animatedStyle]}
                        >
                            <D20Icon />
                            <View style={styles.numberContainer}>
                                <Text
                                    theme={descriptor}
                                    style={styles.numberText}
                                >
                                    {displayNumber}
                                </Text>
                            </View>
                        </Animated.View>
                    </TouchableOpacity>

                    {/* Interaction Hint / Button */}
                    {step === 'prompt' && (
                        <TouchableOpacity
                            style={styles.button}
                            onPress={handleRoll}
                        >
                            <Text theme={descriptor} style={styles.buttonText}>
                                TAP TO ROLL
                            </Text>
                        </TouchableOpacity>
                    )}

                    {step === 'result' && (
                        <TouchableOpacity
                            style={styles.button}
                            onPress={handleContinue}
                        >
                            <Text theme={descriptor} style={styles.buttonText}>
                                CONTINUE
                            </Text>
                        </TouchableOpacity>
                    )}
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 1000,
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.85)',
    },
    content: {
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
    },
    title: {
        fontSize: 32,
        fontWeight: '800',
        color: '#fff',
        marginBottom: 8,
        letterSpacing: 1,
        fontVariant: ['small-caps'],
        textShadowColor: 'rgba(0,0,0,0.5)',
        textShadowOffset: { width: 0, height: 2 },
        textShadowRadius: 4,
    },
    subtitle: {
        fontSize: 18,
        color: '#ccc',
        marginBottom: 32,
        fontWeight: '500',
    },
    success: {
        color: '#4cd137',
    },
    failure: {
        color: '#e74c3c',
    },
    diceContainer: {
        width: 200,
        height: 200,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 40,
    },
    numberContainer: {
        position: 'absolute',
        width: 200,
        height: 200,
        justifyContent: 'center',
        alignItems: 'center',
    },
    numberText: {
        fontSize: 48,
        fontWeight: 'bold',
        color: '#fff',
        textShadowColor: '#000',
        textShadowOffset: { width: 1, height: 1 },
        textShadowRadius: 2,
    },
    button: {
        backgroundColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        borderColor: '#fff',
        paddingVertical: 16,
        paddingHorizontal: 32,
        borderRadius: 8,
    },
    buttonText: {
        color: '#fff',
        fontSize: 18,
        fontWeight: '600',
        letterSpacing: 2,
    },
});
