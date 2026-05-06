import React, { useCallback, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { NavArrowLeft, Trash } from 'iconoir-react-native';
import { useTheme } from '../../../context/ThemeContext';
import { themes } from '../../../themes';
import { MemoryEntry, EntityEntry, memoryApi, entityApi } from '../../../apiClient';
import { SettingsStackParamList } from '../../../navigation/types';

type Nav = NativeStackNavigationProp<SettingsStackParamList, 'MemoryScreen'>;

function formatDate(iso: string): string {
    try {
        return new Date(iso).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
        });
    } catch {
        return iso;
    }
}

export function MemoryScreen() {
    const navigation = useNavigation<Nav>();
    const { theme, themeName } = useTheme();
    const palette = themes[themeName].palette;
    const insets = useSafeAreaInsets();

    const [memories, setMemories] = useState<MemoryEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [entities, setEntities] = useState<EntityEntry[]>([]);

    const load = useCallback(async (isRefresh = false) => {
        if (isRefresh) setRefreshing(true);
        else setLoading(true);
        try {
            const [memoriesData, entitiesData] = await Promise.all([
                memoryApi.list(),
                entityApi.list(),
            ]);
            setMemories(memoriesData ?? []);
            setEntities(entitiesData ?? []);
        } catch (e) {
            console.error('Failed to load memories', e);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useFocusEffect(
        useCallback(() => {
            load();
        }, [load]),
    );

    const handleDelete = useCallback((item: MemoryEntry) => {
        Alert.alert(
            'Delete Memory',
            'Remove this memory? The agent will no longer recall this fact.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        // Optimistic removal
                        setMemories(prev => prev.filter(m => m.id !== item.id));
                        try {
                            await memoryApi.delete(item.id);
                        } catch (e) {
                            // Restore on failure
                            setMemories(prev => [item, ...prev]);
                            Alert.alert('Error', 'Failed to delete memory. Please try again.');
                        }
                    },
                },
            ],
        );
    }, []);

    const styles = useMemo(() => StyleSheet.create({
        root: { flex: 1, backgroundColor: theme.background },
        header: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingBottom: 12,
            gap: 8,
        },
        backBtn: { padding: 4 },
        title: { flex: 1, fontSize: 24, fontWeight: '700', color: theme.textPrimary },
        centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
        emptyText: { fontSize: 15, color: theme.fadedText, textAlign: 'center', paddingHorizontal: 32 },
        listContent: { paddingHorizontal: 16, paddingBottom: insets.bottom + 32 },
        item: {
            flexDirection: 'row',
            alignItems: 'flex-start',
            backgroundColor: theme.surface,
            borderRadius: 12,
            padding: 14,
            marginTop: 10,
            gap: 10,
        },
        itemText: { flex: 1 },
        memoryText: { fontSize: 15, color: theme.textPrimary, lineHeight: 21 },
        dateText: { fontSize: 12, color: theme.fadedText, marginTop: 4 },
        deleteBtn: { padding: 4, marginTop: 2 },
        sectionTitle: {
            fontSize: 17,
            fontWeight: '600' as const,
            color: theme.textPrimary,
            marginTop: 20,
            marginBottom: 4,
        },
        entityCard: {
            backgroundColor: theme.surface,
            borderRadius: 12,
            padding: 14,
            marginTop: 10,
        },
        entityHeader: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            marginBottom: 6,
        },
        entityName: {
            fontSize: 15,
            fontWeight: '600',
            color: theme.textPrimary,
            flex: 1,
        },
        entityTypeBadge: {
            backgroundColor: theme.accent + '22',
            borderRadius: 6,
            paddingHorizontal: 8,
            paddingVertical: 2,
        },
        entityTypeText: {
            fontSize: 11,
            fontWeight: '600',
            color: theme.accent,
            textTransform: 'capitalize',
        },
        entityFact: {
            fontSize: 13,
            color: theme.textSecondary ?? theme.fadedText,
            lineHeight: 18,
            marginTop: 2,
        },
    }), [theme, palette, insets.bottom]);

    const renderItem = useCallback(({ item }: { item: MemoryEntry }) => (
        <View style={styles.item}>
            <View style={styles.itemText}>
                <Text style={styles.memoryText}>{item.memory}</Text>
                <Text style={styles.dateText}>{formatDate(item.created_at)}</Text>
            </View>
            <Pressable
                style={styles.deleteBtn}
                onPress={() => handleDelete(item)}
                hitSlop={8}
            >
                <Trash width={18} height={18} color={theme.error ?? '#ef4444'} />
            </Pressable>
        </View>
    ), [styles, theme, handleDelete]);

    const renderEntityCard = useCallback((entity: EntityEntry) => (
        <View key={entity.id} style={styles.entityCard}>
            <View style={styles.entityHeader}>
                <Text style={styles.entityName} numberOfLines={1}>
                    {entity.name || entity.entity_id}
                </Text>
                <View style={styles.entityTypeBadge}>
                    <Text style={styles.entityTypeText}>{entity.entity_type}</Text>
                </View>
            </View>
            {(entity.facts ?? []).slice(0, 3).map(fact => (
                <Text key={fact.id} style={styles.entityFact}>• {fact.content}</Text>
            ))}
        </View>
    ), [styles]);

    const listHeader = useMemo(() => entities.length > 0 ? (
        <View>
            <Text style={styles.sectionTitle}>Entity Memory</Text>
            {entities.map(renderEntityCard)}
            {memories.length > 0 && (
                <Text style={styles.sectionTitle}>Memories</Text>
            )}
        </View>
    ) : memories.length > 0 ? (
        <Text style={styles.sectionTitle}>Memories</Text>
    ) : null, [entities, memories.length, styles, renderEntityCard]);

    return (
        <View style={[styles.root, { paddingTop: insets.top }]}>
            <View style={styles.header}>
                <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <NavArrowLeft width={24} height={24} color={theme.textPrimary} />
                </Pressable>
                <Text style={styles.title}>Memory</Text>
            </View>

            {loading ? (
                <View style={styles.centered}>
                    <ActivityIndicator size="large" color={theme.accent} />
                </View>
            ) : memories.length === 0 && entities.length === 0 ? (
                <View style={styles.centered}>
                    <Text style={styles.emptyText}>
                        No memories yet. Chat with the agent and it will start remembering things about you.
                    </Text>
                </View>
            ) : (
                <FlatList<MemoryEntry>
                    data={memories}
                    keyExtractor={item => item.id}
                    renderItem={renderItem}
                    ListHeaderComponent={listHeader}
                    contentContainerStyle={styles.listContent}
                    onRefresh={() => load(true)}
                    refreshing={refreshing}
                />
            )}
        </View>
    );
}
