import React from 'react';
import { Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { useTheme } from '../../../context/ThemeContext';

export function DateWidget() {
    const { theme } = useTheme();
    const now = new Date();
    const day = now.getDate();
    const month = now.toLocaleDateString('en-US', { month: 'long' });

    const openCalendar = () => Linking.openURL('calshow://');

    return (
        <TouchableOpacity
            style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
            onPress={openCalendar}
            activeOpacity={0.8}
        >
            <Text style={[styles.day, { color: theme.textPrimary }]}>{day} </Text>
            <Text style={[styles.month, { color: theme.textSecondary }]}>{month}</Text>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    card: {
        flex: 1,
        borderRadius: 16,
        borderWidth: 1,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
    },
    day: {
        fontSize: 28,
        fontWeight: '700',
    },
    month: {
        fontSize: 18,
        fontWeight: '400',
    },
});
