import React from 'react';
import { StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { Text } from '@genie/ds';
import { useTheme } from '../../../context/ThemeContext';

export function DateWidget() {
    const { theme, descriptor } = useTheme();
    const now = new Date();
    const day = now.getDate();
    const month = now.toLocaleDateString('en-US', { month: 'long' });

    const openCalendar = () => Linking.openURL('calshow://');

    return (
        <TouchableOpacity
            style={[
                styles.card,
                { backgroundColor: theme.surface, borderColor: theme.border },
            ]}
            onPress={openCalendar}
            activeOpacity={0.8}
        >
            <Text
                theme={descriptor}
                variant="display"
                tone="primary"
                style={styles.dayGap}
            >
                {day}{' '}
            </Text>
            <Text
                theme={descriptor}
                variant="title"
                tone="secondary"
                weight="400"
            >
                {month}
            </Text>
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
    dayGap: {
        marginRight: 0,
    },
});
