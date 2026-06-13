import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import type { DashboardStackParamList } from '../../navigation/types';

/**
 * Placeholder for the Tasks screen. The autonomous background-task feature
 * (plan-execute runner, live progress, steering) lands later — this empty
 * state will be replaced with a live task list fed by GET /api/tasks.
 */
export const TasksScreen = () => {
    const navigation =
        useNavigation<
            NativeStackNavigationProp<DashboardStackParamList, 'Tasks'>
        >();
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();

    return (
        <View style={[styles.container, { backgroundColor: theme.background }]}>
            {/* Header with back button */}
            <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
                <TouchableOpacity
                    onPress={() => navigation.goBack()}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel="Back"
                >
                    <Ionicons
                        name="chevron-back"
                        size={26}
                        color={theme.textPrimary}
                    />
                </TouchableOpacity>
                <Text
                    style={[styles.headerTitle, { color: theme.textPrimary }]}
                >
                    Tasks
                </Text>
                <View style={styles.headerSpacer} />
            </View>

            {/* Empty state */}
            <View style={styles.empty}>
                <View
                    style={[
                        styles.emptyIconBg,
                        { backgroundColor: `${theme.accent}20` },
                    ]}
                >
                    <Ionicons
                        name="rocket-outline"
                        size={32}
                        color={theme.accent}
                    />
                </View>
                <Text style={[styles.emptyTitle, { color: theme.textPrimary }]}>
                    No tasks yet
                </Text>
                <Text
                    style={[
                        styles.emptySubtitle,
                        { color: theme.textSecondary },
                    ]}
                >
                    Background work Nomi runs for you will show up here.
                </Text>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingBottom: 12,
        gap: 12,
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: '700',
    },
    headerSpacer: {
        flex: 1,
    },
    empty: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 32,
        gap: 12,
    },
    emptyIconBg: {
        width: 64,
        height: 64,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 4,
    },
    emptyTitle: {
        fontSize: 18,
        fontWeight: '600',
    },
    emptySubtitle: {
        fontSize: 14,
        textAlign: 'center',
        lineHeight: 20,
    },
});
