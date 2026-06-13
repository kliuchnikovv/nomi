import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../../../context/ThemeContext';
import type { DashboardStackParamList } from '../../../navigation/types';

/**
 * Dashboard card that opens the Tasks screen — the entry point for the
 * autonomous background-task feature.
 */
export function TasksCard() {
    const navigation =
        useNavigation<
            NativeStackNavigationProp<DashboardStackParamList, 'DashboardHome'>
        >();
    const { theme } = useTheme();

    return (
        <TouchableOpacity
            style={[
                styles.card,
                { backgroundColor: theme.surface, borderColor: theme.border },
            ]}
            onPress={() => navigation.navigate('Tasks')}
            activeOpacity={0.8}
        >
            <View
                style={[
                    styles.iconBg,
                    { backgroundColor: `${theme.accent}20` },
                ]}
            >
                <Ionicons
                    name="rocket-outline"
                    size={20}
                    color={theme.accent}
                />
            </View>
            <View style={styles.textBlock}>
                <Text style={[styles.title, { color: theme.textPrimary }]}>
                    Tasks
                </Text>
                <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
                    Background work Nomi runs for you
                </Text>
            </View>
            <View style={[styles.badge, { backgroundColor: theme.accent }]}>
                <Text style={styles.badgeText}>View</Text>
            </View>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 14,
        borderRadius: 16,
        borderWidth: 1,
    },
    iconBg: {
        width: 40,
        height: 40,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    textBlock: {
        flex: 1,
        gap: 2,
    },
    title: {
        fontSize: 15,
        fontWeight: '600',
    },
    subtitle: {
        fontSize: 12,
    },
    badge: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
    },
    badgeText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#fff',
    },
});
