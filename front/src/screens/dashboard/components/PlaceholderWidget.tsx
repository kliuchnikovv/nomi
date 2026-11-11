import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from '@nomi/ds';
import { useTheme } from '../../../context/ThemeContext';

interface PlaceholderWidgetProps {
    size: 'half' | 'full';
    label?: string;
}

export function PlaceholderWidget({ size, label }: PlaceholderWidgetProps) {
    const { theme, descriptor } = useTheme();

    return (
        <View
            style={[
                styles.card,
                size === 'half' ? styles.half : styles.full,
                {
                    borderColor: theme.border,
                    backgroundColor: theme.surface,
                    borderRadius: descriptor.radius.lg,
                },
            ]}
        >
            <Text
                theme={descriptor}
                variant="title"
                tone="secondary"
                weight="300"
            >
                +
            </Text>
            {label && (
                <Text theme={descriptor} variant="caption" tone="secondary">
                    {label}
                </Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        borderWidth: 1,
        borderStyle: 'dashed',
        minHeight: 100,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 4,
    },
    half: { flex: 1 },
    full: { alignSelf: 'stretch' },
});
