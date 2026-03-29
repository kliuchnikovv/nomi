import React, { useMemo } from 'react';
import { View, StyleSheet, ViewStyle, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '../context/ThemeContext';

type GlassCardVariant = 'raised' | 'flat' | 'inset';

interface GlassCardProps {
    variant?: GlassCardVariant;
    style?: ViewStyle;
    children: React.ReactNode;
    noPadding?: boolean;
    onPress?: () => void;
}

export function GlassCard({ variant = 'raised', style, children, noPadding }: GlassCardProps) {
    const { theme, effects } = useTheme();

    const glassStyle = useMemo((): ViewStyle => {
        if (!effects) {
            return {
                backgroundColor: theme.surface,
                borderColor: theme.border,
                borderWidth: 1,
                borderRadius: 16,
                padding: noPadding ? 0 : 16,
            };
        }

        const base: ViewStyle = {
            borderRadius: effects.cardBorderRadius,
            borderWidth: effects.glassBorderWidth,
            borderColor: effects.glassBorderColor,
            padding: noPadding ? 0 : effects.cardPadding,
            backgroundColor: effects.glassBackground,
            overflow: 'hidden',
        };

        if (variant === 'raised') {
            base.shadowColor = effects.cardShadowRaised.shadowColor;
            base.shadowOffset = effects.cardShadowRaised.shadowOffset;
            base.shadowOpacity = effects.cardShadowRaised.shadowOpacity;
            base.shadowRadius = effects.cardShadowRaised.shadowRadius;
            if (Platform.OS === 'android') {
                base.elevation = effects.cardShadowRaised.elevation;
            }
        } else if (variant === 'inset') {
            base.shadowColor = effects.cardShadowInset.shadowColor;
            base.shadowOffset = effects.cardShadowInset.shadowOffset;
            base.shadowOpacity = effects.cardShadowInset.shadowOpacity;
            base.shadowRadius = effects.cardShadowInset.shadowRadius;
        }

        return base;
    }, [theme, effects, variant, noPadding]);

    if (effects) {
        return (
            <BlurView
                intensity={effects.blurIntensity}
                tint={effects.blurTint}
                style={[glassStyle, style]}
            >
                {children}
            </BlurView>
        );
    }

    return (
        <View style={[glassStyle, style]}>
            {children}
        </View>
    );
}

export function useGlassCardStyle(variant: GlassCardVariant = 'raised', noPadding = false) {
    const { theme, effects } = useTheme();

    return useMemo((): ViewStyle => {
        if (!effects) {
            return {
                backgroundColor: theme.surface,
                borderColor: theme.border,
                borderWidth: 1,
                borderRadius: 16,
                padding: noPadding ? 0 : 16,
            };
        }

        const base: ViewStyle = {
            borderRadius: effects.cardBorderRadius,
            borderWidth: effects.glassBorderWidth,
            borderColor: effects.glassBorderColor,
            padding: noPadding ? 0 : effects.cardPadding,
            backgroundColor: effects.glassBackground,
            overflow: 'hidden',
        };

        if (variant === 'raised') {
            base.shadowColor = effects.cardShadowRaised.shadowColor;
            base.shadowOffset = effects.cardShadowRaised.shadowOffset;
            base.shadowOpacity = effects.cardShadowRaised.shadowOpacity;
            base.shadowRadius = effects.cardShadowRaised.shadowRadius;
            if (Platform.OS === 'android') {
                base.elevation = effects.cardShadowRaised.elevation;
            }
        } else if (variant === 'inset') {
            base.shadowColor = effects.cardShadowInset.shadowColor;
            base.shadowOffset = effects.cardShadowInset.shadowOffset;
            base.shadowOpacity = effects.cardShadowInset.shadowOpacity;
            base.shadowRadius = effects.cardShadowInset.shadowRadius;
        }

        return base;
    }, [theme, effects, variant, noPadding]);
}

export function useIsGlassTheme() {
    const { effects } = useTheme();
    return !!effects;
}
