import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Pressable,
    Text,
    View,
    StyleSheet,
} from 'react-native';
import { Plus, Trash, List } from 'iconoir-react-native';
import { listsApi, List as ListType } from '../apiClient';
import { useTheme } from '../context/ThemeContext';
import { ThemePalette } from '../themes/types';
import AddListModal from '../screens/lists/AddListModal';
import ListDetailModal from '../screens/lists/ListDetailModal';

interface ListListProps {
    visible?: boolean;
}

function ListCard({
    list,
    onPress,
    onDelete,
    theme,
    palette,
}: {
    list: ListType;
    onPress: () => void;
    onDelete: (id: string) => void;
    theme: any;
    palette: ThemePalette;
}) {
    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                {
                    backgroundColor: 'transparent',
                    borderRadius: 12,
                    padding: 12,
                    marginBottom: 8,
                    borderWidth: 1,
                    borderColor: theme.border,
                    opacity: pressed ? 0.8 : 1,
                },
            ]}
        >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View
                    style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        backgroundColor: `${palette.blue || theme.accent}15`,
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginRight: 12,
                    }}
                >
                    <List width={18} height={18} color={palette.blue || theme.accent} />
                </View>
                <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.text, fontWeight: '600', fontSize: 15 }} numberOfLines={1}>
                        {list.name}
                    </Text>
                    {list.description ? (
                        <Text style={{ color: theme.textSecondary, fontSize: 13, marginTop: 2 }} numberOfLines={1}>
                            {list.description}
                        </Text>
                    ) : null}
                </View>
                <Pressable
                    onPress={(e) => {
                        e.stopPropagation();
                        Alert.alert('Delete list', `Remove "${list.name}" and all its items?`, [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Delete', style: 'destructive', onPress: () => onDelete(list.id) },
                        ]);
                    }}
                    hitSlop={8}
                    style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1, padding: 4 }]}
                >
                    <Trash width={18} height={18} color={theme.textSecondary} />
                </Pressable>
            </View>
        </Pressable>
    );
}

export default function ListList({ visible = true }: ListListProps) {
    const { theme, palette } = useTheme();
    const [lists, setLists] = useState<ListType[]>([]);
    const [loading, setLoading] = useState(false);
    const [listsLoaded, setListsLoaded] = useState(false);
    const [addModalVisible, setAddModalVisible] = useState(false);
    const [detailList, setDetailList] = useState<ListType | null>(null);

    const fetchLists = async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const data = await listsApi.list();
            if (data) setLists(data);
        } catch (err) {
            console.error('Failed to fetch lists', err);
        } finally {
            if (!silent) setLoading(false);
        }
    };

    useEffect(() => {
        if (visible && !listsLoaded) {
            fetchLists();
            setListsLoaded(true);
        }
    }, [visible, listsLoaded]);

    const handleDelete = async (id: string) => {
        try {
            await listsApi.delete(id);
            setLists((prev) => prev.filter((l) => l.id !== id));
            if (detailList?.id === id) setDetailList(null);
        } catch (err) {
            console.error('Failed to delete list', err);
        }
    };

    const styles = StyleSheet.create({
        sectionHeader: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 12,
            paddingVertical: 12,
        },
        sectionTitle: {
            fontSize: 14,
            fontWeight: '600',
            color: theme.textPrimary,
        },
    });

    return (
        <View>
            <View style={[styles.sectionHeader, { marginTop: 12 }]}>
                <Text style={styles.sectionTitle}>Lists</Text>
                <Pressable
                    style={({ pressed }) => [
                        {
                            opacity: pressed ? 0.6 : 1,
                            padding: 6,
                            backgroundColor: `${theme.accent}15`,
                            borderRadius: 8,
                        },
                    ]}
                    onPress={() => setAddModalVisible(true)}
                >
                    <Plus width={18} height={18} color={theme.accent} strokeWidth={2.5} />
                </Pressable>
            </View>

            {loading && lists.length === 0 ? (
                <View style={{ padding: 16 }}>
                    <ActivityIndicator size="small" color={theme.accent} />
                </View>
            ) : (
                <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
                    {lists.length === 0 ? (
                        <View
                            style={{
                                padding: 16,
                                borderRadius: 12,
                                borderWidth: 1,
                                borderColor: theme.border,
                                borderStyle: 'dashed',
                                alignItems: 'center',
                            }}
                        >
                            <Text style={{ color: theme.textSecondary, fontSize: 13 }}>No lists yet</Text>
                        </View>
                    ) : (
                        lists.map((list) => (
                            <ListCard
                                key={list.id}
                                list={list}
                                onPress={() => setDetailList(list)}
                                onDelete={handleDelete}
                                theme={theme}
                                palette={palette}
                            />
                        ))
                    )}
                </View>
            )}

            <AddListModal
                visible={addModalVisible}
                onClose={() => setAddModalVisible(false)}
                onListCreated={(list) => {
                    setLists((prev) => [...prev, list]);
                }}
            />
            <ListDetailModal
                visible={detailList !== null}
                list={detailList}
                onClose={() => setDetailList(null)}
                onItemsChanged={() => fetchLists(true)}
            />
        </View>
    );
}
