import React, { useCallback, useEffect, useState } from 'react';
import {
    View,
    Text,
    FlatList,
    TouchableOpacity,
    StyleSheet,
    ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import { tasksApi } from '../../apiClient';
import type { AgentTask, AgentTaskStatus } from '../main/models';
import type { DashboardStackParamList } from '../../navigation/types';
import { statusColor, statusLabel } from './status';

type Nav = NativeStackNavigationProp<DashboardStackParamList, 'Tasks'>;

const ACTIVE: AgentTaskStatus[] = [
    'planning',
    'running',
    'waiting_input',
    'paused',
];

export const TasksScreen = () => {
    const navigation = useNavigation<Nav>();
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const [tasks, setTasks] = useState<AgentTask[]>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        try {
            const result = await tasksApi.list();
            setTasks(result ?? []);
        } catch {
            // keep last-known list on transient errors
        } finally {
            setLoading(false);
        }
    }, []);

    // Reload on focus, and poll while any task is active.
    useEffect(() => {
        const unsubscribe = navigation.addListener('focus', load);
        return unsubscribe;
    }, [navigation, load]);

    useEffect(() => {
        const hasActive = tasks.some(t => ACTIVE.includes(t.status));
        if (!hasActive) return;
        const interval = setInterval(load, 4000);
        return () => clearInterval(interval);
    }, [tasks, load]);

    const renderItem = ({ item }: { item: AgentTask }) => {
        const done = item.plan?.filter(s => s.status === 'done').length ?? 0;
        const total = item.plan?.length ?? 0;
        return (
            <TouchableOpacity
                style={[styles.row, { backgroundColor: theme.surface }]}
                onPress={() =>
                    navigation.navigate('TaskDetail', { taskId: item.id })
                }
                activeOpacity={0.7}
            >
                <View
                    style={[
                        styles.dot,
                        { backgroundColor: statusColor(item.status, theme) },
                    ]}
                />
                <View style={styles.rowText}>
                    <Text
                        style={[styles.goal, { color: theme.textPrimary }]}
                        numberOfLines={2}
                    >
                        {item.goal}
                    </Text>
                    <Text style={[styles.meta, { color: theme.textSecondary }]}>
                        {statusLabel(item.status)}
                        {total > 0 ? ` · ${done}/${total} steps` : ''}
                    </Text>
                </View>
                <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={theme.textSecondary}
                />
            </TouchableOpacity>
        );
    };

    return (
        <View
            style={[
                styles.container,
                { backgroundColor: theme.background, paddingTop: insets.top },
            ]}
        >
            <View style={styles.header}>
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
                <Text style={[styles.title, { color: theme.textPrimary }]}>
                    Tasks
                </Text>
                <View style={styles.headerSpacer} />
            </View>
            {loading ? (
                <ActivityIndicator style={styles.loader} color={theme.accent} />
            ) : (
                <FlatList
                    data={tasks}
                    keyExtractor={(t: AgentTask) => t.id}
                    renderItem={renderItem}
                    ItemSeparatorComponent={() => (
                        <View
                            style={[
                                styles.separator,
                                { backgroundColor: theme.border },
                            ]}
                        />
                    )}
                    contentContainerStyle={
                        tasks.length === 0 ? styles.empty : undefined
                    }
                    ListEmptyComponent={
                        <Text
                            style={[
                                styles.emptyText,
                                { color: theme.textSecondary },
                            ]}
                        >
                            No tasks yet. Ask Nomi to run something in the
                            background.
                        </Text>
                    }
                />
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 12,
    },
    title: { fontSize: 24, fontWeight: '700' },
    headerSpacer: { flex: 1 },
    loader: { flex: 1 },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 14,
        gap: 12,
    },
    dot: { width: 10, height: 10, borderRadius: 5 },
    rowText: { flex: 1 },
    goal: { fontSize: 16, fontWeight: '600' },
    meta: { fontSize: 13, marginTop: 2 },
    separator: { height: StyleSheet.hairlineWidth, marginLeft: 38 },
    empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    emptyText: { fontSize: 15, textAlign: 'center', paddingHorizontal: 32 },
});
