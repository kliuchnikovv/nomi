import React, { useCallback, useEffect, useState } from 'react';
import {
    View,
    Text,
    FlatList,
    TouchableOpacity,
    StyleSheet,
    ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { projectsApi } from '../../apiClient';
import type { Project } from '../main/models';
import type { ProjectsStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<ProjectsStackParamList, 'ProjectsList'>;

export function ProjectsScreen() {
    const navigation = useNavigation<Nav>();
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        try {
            const result = await projectsApi.list();
            setProjects(result ?? []);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        const unsubscribe = navigation.addListener('focus', load);
        return unsubscribe;
    }, [navigation, load]);

    const renderItem = ({ item }: { item: Project }) => (
        <TouchableOpacity
            style={[styles.row, { backgroundColor: theme.surface }]}
            onPress={() => navigation.navigate('ProjectDetail', { projectId: item.id })}
            activeOpacity={0.7}
        >
            <Text style={styles.icon}>{item.icon}</Text>
            <View style={styles.rowText}>
                <Text style={[styles.name, { color: theme.textPrimary }]}>{item.name}</Text>
                {item.description ? (
                    <Text style={[styles.description, { color: theme.textSecondary }]} numberOfLines={1}>
                        {item.description}
                    </Text>
                ) : null}
            </View>
            <Text style={[styles.count, { color: theme.textSecondary }]}>{item.chat_count}</Text>
            <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
        </TouchableOpacity>
    );

    return (
        <View style={[styles.container, { backgroundColor: theme.background, paddingTop: insets.top }]}>
            <View style={styles.header}>
                <Text style={[styles.title, { color: theme.textPrimary }]}>Projects</Text>
                <TouchableOpacity
                    onPress={() => navigation.navigate('CreateEditProject', {})}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                    <Ionicons name="add" size={28} color={theme.accent} />
                </TouchableOpacity>
            </View>
            {loading ? (
                <ActivityIndicator style={styles.loader} color={theme.accent} />
            ) : (
                <FlatList
                    data={projects}
                    keyExtractor={(p: Project) => p.id}
                    renderItem={renderItem}
                    ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: theme.border }]} />}
                    contentContainerStyle={projects.length === 0 ? styles.empty : undefined}
                    ListEmptyComponent={
                        <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                            No projects yet. Tap + to create one.
                        </Text>
                    }
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    title: { fontSize: 24, fontWeight: '700' },
    loader: { flex: 1 },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 14,
        gap: 12,
    },
    rowText: { flex: 1 },
    icon: { fontSize: 22 },
    name: { fontSize: 16, fontWeight: '600' },
    description: { fontSize: 13, marginTop: 2 },
    count: { fontSize: 13 },
    separator: { height: StyleSheet.hairlineWidth, marginLeft: 56 },
    empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    emptyText: { fontSize: 15, textAlign: 'center', paddingHorizontal: 32 },
});
