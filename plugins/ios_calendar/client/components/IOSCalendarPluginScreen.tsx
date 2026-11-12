/**
 * iOS Calendar Plugin Screen
 * Minimal UI component for plugin registration
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '@nomi/front/context/ThemeContext';
import { SharedPluginScreen } from '@nomi/front/plugins/components/SharedPluginScreen';
import { PluginMainScreenProps } from '@nomi/front/plugins/types';

export default function IOSCalendarPluginScreen({ onClose }: PluginMainScreenProps) {
    const { theme } = useTheme();

    return (
        <SharedPluginScreen title="iOS Calendar" onClose={onClose}>
            <View style={styles.center}>
                <Text style={[styles.description, { color: theme.textSecondary }]}>
                    Calendar integration via EventKit
                </Text>
            </View>
        </SharedPluginScreen>
    );
}

const styles = StyleSheet.create({
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    description: {
        fontSize: 16,
        textAlign: 'center',
    },
});
