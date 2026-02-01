import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    Modal,
    Pressable,
    StyleSheet,
    FlatList,
    ActivityIndicator,
    Alert,
    Linking,
} from 'react-native';
import { XmarkCircle, Plus, Trash, Link, EmptyPage, LightBulb } from 'iconoir-react-native';
import { listsApi, List, ListItem } from '../../apiClient';
import AddListItemModal from './AddListItemModal';
import { useTheme } from '../../context/ThemeContext';

interface ListDetailModalProps {
    visible: boolean;
    list: List | null;
    onClose: () => void;
    onItemsChanged?: () => void;
}

const typeIcons: Record<string, typeof LightBulb> = {
    fact: LightBulb,
    link: Link,
    document: EmptyPage,
};

export default function ListDetailModal({ visible, list, onClose, onItemsChanged }: ListDetailModalProps) {
    const { theme } = useTheme();
    const [items, setItems] = useState<ListItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [addItemVisible, setAddItemVisible] = useState(false);

    useEffect(() => {
        if (visible && list?.id) {
            setLoading(true);
            listsApi
                .listItems(list.id)
                .then((data) => setItems(data || []))
                .catch(() => setItems([]))
                .finally(() => setLoading(false));
        } else {
            setItems([]);
        }
    }, [visible, list?.id]);

    const handleDeleteItem = (item: ListItem) => {
        if (!list) return;
        Alert.alert('Delete item', 'Remove this item from the list?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                    try {
                        await listsApi.deleteItem(list.id, item.id);
                        setItems((prev) => prev.filter((i) => i.id !== item.id));
                        onItemsChanged?.();
                    } catch (e) {
                        console.warn('Failed to delete item', e);
                    }
                },
            },
        ]);
    };

    const handleItemCreated = (item: ListItem) => {
        setItems((prev) => [item, ...prev]);
        onItemsChanged?.();
    };

    const openLink = (item: ListItem) => {
        if (item.type === 'link' && item.url) {
            Linking.openURL(item.url).catch(() => {});
        }
    };

    if (!list) return null;

    const dynamicStyles = {
        header: { borderBottomColor: theme.border },
        title: { color: theme.text },
        closeBtn: { backgroundColor: theme.background, borderColor: theme.border },
        addBtn: { backgroundColor: `${theme.accent}20`, borderColor: theme.accent },
        card: { backgroundColor: theme.background, borderColor: theme.border },
        cardText: { color: theme.text },
        cardMeta: { color: theme.textSecondary },
        empty: { color: theme.textSecondary },
    };

    return (
        <>
            <Modal
                visible={visible}
                transparent
                animationType="slide"
                onRequestClose={onClose}
            >
                <View style={styles.overlay}>
                    <View style={[styles.panel, { backgroundColor: theme.background }]}>
                        <View style={[styles.header, dynamicStyles.header]}>
                            <Text style={[styles.title, dynamicStyles.title]} numberOfLines={1}>
                                {list.name}
                            </Text>
                            <Pressable
                                onPress={onClose}
                                style={[styles.closeBtn, dynamicStyles.closeBtn]}
                                hitSlop={12}
                            >
                                <XmarkCircle width={22} height={22} color={theme.text} />
                            </Pressable>
                        </View>
                        <Pressable
                            onPress={() => setAddItemVisible(true)}
                            style={[styles.addBtn, dynamicStyles.addBtn]}
                        >
                            <Plus width={18} height={18} color={theme.accent} strokeWidth={2.5} />
                            <Text style={[styles.addBtnText, { color: theme.accent }]}>Add item</Text>
                        </Pressable>
                        {loading ? (
                            <View style={styles.loading}>
                                <ActivityIndicator size="small" color={theme.accent} />
                            </View>
                        ) : (
                            <FlatList
                                data={items}
                                keyExtractor={(item) => item.id}
                                contentContainerStyle={[styles.listContent, items.length === 0 && styles.listEmpty]}
                                ListEmptyComponent={
                                    <Text style={[styles.emptyText, dynamicStyles.empty]}>
                                        No items yet. Add facts, links, or documents.
                                    </Text>
                                }
                                renderItem={({ item }) => {
                                    const Icon = typeIcons[item.type] || EmptyPage;
                                    return (
                                        <View style={[styles.card, dynamicStyles.card]}>
                                            <View style={styles.cardRow}>
                                                <View style={styles.cardLeft}>
                                                    <Icon width={18} height={18} color={theme.accent} />
                                                    <View style={styles.cardBody}>
                                                        {(item.title || item.type === 'link') && (
                                                            <Text style={[styles.cardTitle, dynamicStyles.cardText]} numberOfLines={1}>
                                                                {item.title || (item.type === 'link' ? item.url : item.type)}
                                                            </Text>
                                                        )}
                                                        {item.content ? (
                                                            <Text style={[styles.cardContent, dynamicStyles.cardMeta]} numberOfLines={2}>
                                                                {item.content}
                                                            </Text>
                                                        ) : null}
                                                        {item.type === 'link' && item.url && !item.title && item.content ? (
                                                            <Text style={[styles.cardUrl, dynamicStyles.cardMeta]} numberOfLines={1}>
                                                                {item.url}
                                                            </Text>
                                                        ) : null}
                                                    </View>
                                                </View>
                                                <View style={styles.cardActions}>
                                                    {item.type === 'link' && item.url ? (
                                                        <Pressable onPress={() => openLink(item)} hitSlop={8}>
                                                            <Link width={18} height={18} color={theme.accent} />
                                                        </Pressable>
                                                    ) : null}
                                                    <Pressable onPress={() => handleDeleteItem(item)} hitSlop={8}>
                                                        <Trash width={18} height={18} color={theme.textSecondary} />
                                                    </Pressable>
                                                </View>
                                            </View>
                                        </View>
                                    );
                                }}
                            />
                        )}
                    </View>
                </View>
            </Modal>
            <AddListItemModal
                visible={addItemVisible && visible}
                listId={list.id}
                onClose={() => setAddItemVisible(false)}
                onItemCreated={handleItemCreated}
            />
        </>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.4)',
        justifyContent: 'flex-end',
    },
    panel: {
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        maxHeight: '80%',
        paddingBottom: 24,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
    },
    title: { fontSize: 18, fontWeight: '700', flex: 1, marginRight: 8 },
    closeBtn: { padding: 6, borderRadius: 8, borderWidth: 1 },
    addBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        marginHorizontal: 16,
        marginTop: 12,
        paddingVertical: 10,
        borderRadius: 10,
        borderWidth: 1,
    },
    addBtnText: { fontSize: 15, fontWeight: '600' },
    listContent: { padding: 16, paddingTop: 8 },
    listEmpty: { flexGrow: 1, paddingTop: 24 },
    loading: { padding: 24, alignItems: 'center' },
    emptyText: { fontSize: 14, textAlign: 'center' },
    card: {
        borderRadius: 12,
        borderWidth: 1,
        padding: 12,
        marginBottom: 8,
    },
    cardRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
    cardLeft: { flexDirection: 'row', flex: 1, marginRight: 8 },
    cardBody: { flex: 1 },
    cardTitle: { fontSize: 15, fontWeight: '600', marginBottom: 2 },
    cardContent: { fontSize: 13 },
    cardUrl: { fontSize: 12, marginTop: 2 },
    cardActions: { flexDirection: 'row', gap: 12 },
});
