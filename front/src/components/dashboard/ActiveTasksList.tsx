import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useNotifications } from '../../context/NotificationContext';
import { ActiveTaskCard } from './ActiveTaskCard';
import { useTheme } from '../../context/ThemeContext';

export function ActiveTasksList() {
    const { activeTasks, markTaskAsSeen } = useNotifications();
    const { theme } = useTheme();

    if (activeTasks.length === 0) return null;

    return (
        <View style={styles.container}>
            <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>Active Operations</Text>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.scrollContent}
            >
                {activeTasks.map(task => (
                    <ActiveTaskCard
                        key={task.id}
                        task={task}
                        onDismiss={markTaskAsSeen}
                    />
                ))}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        marginTop: 16,
        marginBottom: 8,
    },
    sectionTitle: {
        fontSize: 12,
        fontWeight: '600',
        marginLeft: 16,
        marginBottom: 8,
        textTransform: 'uppercase'
    },
    scrollContent: {
        paddingHorizontal: 16
    }
});
