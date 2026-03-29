import React, { useState, useMemo } from 'react';
import { TouchableOpacity, ViewStyle, Platform, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';

interface NeumorphicButtonProps {
    onPress: () => void;
    style?: ViewStyle;
    children: React.ReactNode;
    disabled?: boolean;
    activeOpacity?: number;
}

export function NeumorphicButton({ onPress, style, children, disabled, activeOpacity = 0.8 }: NeumorphicButtonProps) {
    const { theme, effects } = useTheme();
    const [pressed, setPressed] = useState(false);

    const buttonStyle = useMemo((): ViewStyle => {
        if (!effects) {
            return {
                backgroundColor: theme.surface,
                borderColor: theme.border,
                borderWidth: 1,
                borderRadius: 12,
                padding: 12,
                alignItems: 'center',
                justifyContent: 'center',
            };
        }

        const shadow = pressed ? effects.buttonShadowPressed : effects.buttonShadowRaised;

        return {
            backgroundColor: effects.glassBackground,
            borderColor: effects.glassBorderColor,
            borderWidth: effects.glassBorderWidth,
            borderRadius: effects.cardBorderRadius,
            padding: effects.cardPadding,
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: shadow.shadowColor,
            shadowOffset: shadow.shadowOffset,
            shadowOpacity: shadow.shadowOpacity,
            shadowRadius: shadow.shadowRadius,
            ...(Platform.OS === 'android' && 'elevation' in shadow ? { elevation: (shadow as any).elevation } : {}),
            overflow: 'hidden',
        };
    }, [theme, effects, pressed]);

    return (
        <TouchableOpacity
            onPress={onPress}
            onPressIn={() => setPressed(true)}
            onPressOut={() => setPressed(false)}
            style={[buttonStyle, style, disabled && { opacity: 0.5 }]}
            activeOpacity={activeOpacity}
            disabled={disabled}
        >
            {children}
        </TouchableOpacity>
    );
}
