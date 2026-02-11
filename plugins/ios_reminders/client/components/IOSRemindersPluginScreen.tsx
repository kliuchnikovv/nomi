/**
 * iOS Reminders Plugin Screen
 * Minimal UI component for plugin registration
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function IOSRemindersPluginScreen() {
    return (
        <View style={styles.container}>
            <Text style={styles.title}>iOS Reminders</Text>
            <Text style={styles.description}>
                Reminders integration via EventKit
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 20,
        justifyContent: 'center',
        alignItems: 'center',
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 10,
    },
    description: {
        fontSize: 16,
        textAlign: 'center',
        color: '#666',
    },
});
