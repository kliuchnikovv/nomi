import React, { useEffect, useRef } from 'react';
import { Animated, Easing, View, StyleSheet } from 'react-native';
import Svg, { Path, Circle, G } from 'react-native-svg';
import { useTheme } from '../../../context/ThemeContext';

const AnimatedG = Animated.createAnimatedComponent(G);
const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface SoupAnimationProps {
    working: boolean;
    size?: number;
    color?: string;
}

export function SoupAnimation({ working, size = 20, color }: SoupAnimationProps) {
    const { theme } = useTheme();
    // Colors
    // Pot: Orange/Red for "hot" vibe
    const potColor = '#FF6B6B'; 
    const soupColor = '#FFD93D'; // Yellow soup
    const steamColor = theme.background; // White/Background steam
    
    // Animation values
    const steam1 = useRef(new Animated.Value(0)).current;
    const steam2 = useRef(new Animated.Value(0)).current;
    const steam3 = useRef(new Animated.Value(0)).current;
    
    // Shake animation
    const shake = useRef(new Animated.Value(0)).current;
    
    // Splashes
    const splash1 = useRef(new Animated.Value(0)).current;
    const splash2 = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (!working) {
            // Reset
            steam1.setValue(0);
            steam2.setValue(0);
            steam3.setValue(0);
            shake.setValue(0);
            splash1.setValue(0);
            splash2.setValue(0);
            return;
        }

        // Steam Animation Loop
        const createSteamAnimation = (anim: Animated.Value, delay: number) => {
            return Animated.loop(
                Animated.sequence([
                    Animated.delay(delay),
                    Animated.timing(anim, {
                        toValue: 1,
                        duration: 1500,
                        easing: Easing.out(Easing.ease),
                        useNativeDriver: true,
                    }),
                    Animated.timing(anim, {
                        toValue: 0,
                        duration: 0,
                        useNativeDriver: true,
                    })
                ])
            );
        };

        // Shake Animation Loop
        const shakeAnimation = Animated.loop(
            Animated.sequence([
                Animated.timing(shake, { toValue: 1, duration: 50, useNativeDriver: true }),
                Animated.timing(shake, { toValue: -1, duration: 50, useNativeDriver: true }),
                Animated.timing(shake, { toValue: 1, duration: 50, useNativeDriver: true }),
                Animated.timing(shake, { toValue: 0, duration: 50, useNativeDriver: true }),
                Animated.delay(100) // Pause briefly between shakes
            ])
        );

        // Splash Animation Loop
        const createSplashAnimation = (anim: Animated.Value, delay: number) => {
            return Animated.loop(
                Animated.sequence([
                    Animated.delay(delay),
                    Animated.timing(anim, {
                        toValue: 1,
                        duration: 600,
                        easing: Easing.out(Easing.cubic),
                        useNativeDriver: true,
                    }),
                    Animated.timing(anim, {
                        toValue: 0,
                        duration: 0,
                        useNativeDriver: true,
                    })
                ])
            );
        };

        const anims = [
            createSteamAnimation(steam1, 0),
            createSteamAnimation(steam2, 500),
            createSteamAnimation(steam3, 1000),
            shakeAnimation,
            createSplashAnimation(splash1, 200),
            createSplashAnimation(splash2, 700)
        ];

        Animated.parallel(anims).start();

        return () => {
            anims.forEach(anim => anim.stop());
        };
    }, [working, steam1, steam2, steam3, shake, splash1, splash2]);

    const getSteamProps = (anim: Animated.Value) => {
        const translateY = anim.interpolate({
            inputRange: [0, 1],
            outputRange: [0, -4],
        });
        const opacity = anim.interpolate({
            inputRange: [0, 0.2, 0.8, 1],
            outputRange: [0, 1, 1, 0],
        });
        return { translateY, opacity };
    };

    const getSplashProps = (anim: Animated.Value, xOffset: number) => {
        const translateY = anim.interpolate({
            inputRange: [0, 1],
            outputRange: [0, -6],
        });
        const translateX = anim.interpolate({
            inputRange: [0, 1],
            outputRange: [0, xOffset],
        });
        const opacity = anim.interpolate({
            inputRange: [0, 0.5, 1],
            outputRange: [1, 1, 0],
        });
        const scale = anim.interpolate({
            inputRange: [0, 1],
            outputRange: [0.5, 1.2],
        });
        return { translateY, translateX, opacity, scale };
    };

    const shakeTransform = shake.interpolate({
        inputRange: [-1, 1],
        outputRange: [-1, 1], // Shake x pixels
    });
    const rotateTransform = shake.interpolate({
        inputRange: [-1, 1],
        outputRange: ['-2deg', '2deg'], // Rotate slightly
    });

    return (
        <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
            <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
                
                {/* Steam Lines (Behind Pot mostly, but visuals work better if drawn first?) */}
                {/* @ts-ignore */}
                <AnimatedPath
                    d="M8 7c0-1.5 1-2 1-3"
                    stroke={steamColor}
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    style={{
                        opacity: working ? getSteamProps(steam1).opacity : 0,
                        transform: [{ translateY: getSteamProps(steam1).translateY }]
                    }}
                />
                 {/* @ts-ignore */}
                 <AnimatedPath
                    d="M12 7c0-1.5 1-2 1-3"
                    stroke={steamColor}
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    style={{
                        opacity: working ? getSteamProps(steam2).opacity : 0,
                        transform: [{ translateY: getSteamProps(steam2).translateY }]
                    }}
                />
                 {/* @ts-ignore */}
                 <AnimatedPath
                    d="M16 7c0-1.5 1-2 1-3"
                    stroke={steamColor}
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    style={{
                        opacity: working ? getSteamProps(steam3).opacity : 0,
                        transform: [{ translateY: getSteamProps(steam3).translateY }]
                    }}
                />

                {/* Splashes */}
                 {/* @ts-ignore */}
                <AnimatedCircle 
                    cx="9" cy="10" r="1.5" 
                    fill={soupColor}
                    style={{
                        opacity: working ? getSplashProps(splash1, -2).opacity : 0,
                        transform: [
                            { translateY: getSplashProps(splash1, -2).translateY },
                            { translateX: getSplashProps(splash1, -2).translateX },
                            { scale: getSplashProps(splash1, -2).scale }
                        ]
                    }}
                />
                 {/* @ts-ignore */}
                 <AnimatedCircle 
                    cx="15" cy="10" r="1" 
                    fill={soupColor}
                    style={{
                        opacity: working ? getSplashProps(splash2, 2).opacity : 0,
                        transform: [
                            { translateY: getSplashProps(splash2, 2).translateY },
                            { translateX: getSplashProps(splash2, 2).translateX },
                            { scale: getSplashProps(splash2, 2).scale }
                        ]
                    }}
                />

                {/* Pot Group - Shakes */}
                {/* @ts-ignore */}
                <AnimatedG
                    style={{
                        transform: [
                            { translateX: working ? shakeTransform : 0 },
                            { rotate: working ? rotateTransform : '0deg' }
                        ]
                    }}
                    origin="12, 14" // Center of rotation approx
                >
                    {/* Pot Body */}
                    <Path
                        d="M4 10h16v2a8 8 0 0 1-8 8h0a8 8 0 0 1-8-8v-2z"
                        fill={potColor}
                        stroke={theme.background} // Small border to separate from bg
                        strokeWidth="1" 
                    />
                    {/* Pot Rim/Soup Surface */}
                    <Path
                        d="M4 10h16v2h-16z"
                        fill={soupColor}
                    />
                    {/* Pot Handles? Optional detail */}
                    <Path d="M2 11h2M20 11h2" stroke={potColor} strokeWidth="2" strokeLinecap="round" />
                </AnimatedG>

            </Svg>
        </View>
    );
}
