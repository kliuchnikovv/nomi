import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../../context/ThemeContext';

interface GreetingWidgetProps {
    userName?: string;
}

function getGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
}

export function GreetingWidget({ userName }: GreetingWidgetProps) {
    const { theme } = useTheme();

    return (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Text style={[styles.greeting, { color: theme.textPrimary }]}>
                {getGreeting()}
                {userName ? `,\n${userName}` : ''}!
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        flex: 1,
        padding: 16,
        borderRadius: 16,
        borderWidth: 1,
        minHeight: 130,
        justifyContent: 'flex-end',
        gap: 4,
    },
    greeting: {
        fontSize: 20,
        fontWeight: '700',
        lineHeight: 26,
    },
});
