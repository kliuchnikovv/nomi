import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../../context/ThemeContext';

interface PlaceholderWidgetProps {
    size: 'half' | 'full';
    label?: string;
}

export function PlaceholderWidget({ size, label }: PlaceholderWidgetProps) {
    const { theme } = useTheme();

    return (
        <View
            style={[
                styles.card,
                size === 'half' ? styles.half : styles.full,
                {
                    borderColor: theme.border,
                    backgroundColor: theme.surface,
                },
            ]}
        >
            <Text style={[styles.plus, { color: theme.textSecondary }]}>+</Text>
            {label && (
                <Text style={[styles.label, { color: theme.textSecondary }]}>{label}</Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        borderWidth: 1,
        borderStyle: 'dashed',
        borderRadius: 16,
        minHeight: 100,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 4,
    },
    half: {
        flex: 1,
    },
    full: {
        alignSelf: 'stretch',
    },
    plus: {
        fontSize: 28,
        fontWeight: '300',
    },
    label: {
        fontSize: 12,
    },
});
