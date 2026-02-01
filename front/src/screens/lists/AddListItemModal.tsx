import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable } from 'react-native';
import Dialog from '../../components/Dialog';
import { listsApi, ListItem, ListItemType } from '../../apiClient';
import { useTheme } from '../../context/ThemeContext';

const TYPES: { value: ListItemType; label: string }[] = [
    { value: 'fact', label: 'Fact' },
    { value: 'link', label: 'Link' },
    { value: 'document', label: 'Document' },
];

interface AddListItemModalProps {
    visible: boolean;
    listId: string;
    onClose: () => void;
    onItemCreated: (item: ListItem) => void;
}

export default function AddListItemModal({ visible, listId, onClose, onItemCreated }: AddListItemModalProps) {
    const { theme, palette } = useTheme();
    const [type, setType] = useState<ListItemType>('fact');
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [url, setUrl] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!visible) {
            setType('fact');
            setTitle('');
            setContent('');
            setUrl('');
            setError(null);
        }
    }, [visible]);

    const handleCreate = async () => {
        if (type === 'link' && !url.trim()) {
            setError('URL is required for link');
            return;
        }
        if (!content.trim() && !url.trim()) {
            setError('Content or URL is required');
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const item = await listsApi.addItem(listId, {
                type,
                title: title.trim() || undefined,
                content: content.trim() || '',
                url: type === 'link' ? url.trim() : undefined,
            });
            if (item) {
                onItemCreated(item);
                onClose();
            }
        } catch (err: any) {
            setError(err.message || 'Failed to add item');
        } finally {
            setLoading(false);
        }
    };

    const dynamicStyles = {
        input: { borderColor: theme.border, color: theme.text, backgroundColor: theme.background },
        label: { color: theme.textSecondary },
        error: { color: palette.red },
        typeBtn: (selected: boolean) => ({
            backgroundColor: selected ? `${theme.accent}25` : theme.background,
            borderColor: selected ? theme.accent : theme.border,
        }),
    };

    return (
        <Dialog
            visible={visible}
            title="Add to list"
            onClose={onClose}
            dismissOnBackdrop={!loading}
            actions={[
                { label: 'Cancel', onPress: onClose },
                { label: loading ? 'Adding…' : 'Add', onPress: handleCreate, variant: 'primary' },
            ]}
        >
            <View style={styles.fields}>
                <Text style={[styles.label, dynamicStyles.label]}>Type</Text>
                <View style={styles.typeRow}>
                    {TYPES.map((t) => (
                        <Pressable
                            key={t.value}
                            onPress={() => setType(t.value)}
                            style={[
                                styles.typeBtn,
                                dynamicStyles.typeBtn(type === t.value),
                                { borderWidth: 1, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
                            ]}
                        >
                            <Text style={{ color: type === t.value ? theme.accent : theme.text, fontSize: 14 }}>
                                {t.label}
                            </Text>
                        </Pressable>
                    ))}
                </View>
                <Text style={[styles.label, dynamicStyles.label]}>Title (optional)</Text>
                <TextInput
                    style={[styles.input, dynamicStyles.input]}
                    value={title}
                    onChangeText={setTitle}
                    placeholder="Title"
                    placeholderTextColor={theme.textSecondary}
                    editable={!loading}
                />
                {type === 'link' && (
                    <>
                        <Text style={[styles.label, dynamicStyles.label]}>URL</Text>
                        <TextInput
                            style={[styles.input, dynamicStyles.input]}
                            value={url}
                            onChangeText={setUrl}
                            placeholder="https://..."
                            placeholderTextColor={theme.textSecondary}
                            keyboardType="url"
                            autoCapitalize="none"
                            editable={!loading}
                        />
                    </>
                )}
                <Text style={[styles.label, dynamicStyles.label]}>
                    {type === 'link' ? 'Description (optional)' : 'Content'}
                </Text>
                <TextInput
                    style={[styles.input, styles.textArea, dynamicStyles.input]}
                    value={content}
                    onChangeText={setContent}
                    placeholder={type === 'link' ? 'Description' : 'Text content'}
                    placeholderTextColor={theme.textSecondary}
                    multiline
                    numberOfLines={3}
                    editable={!loading}
                />
                {error ? <Text style={[styles.error, dynamicStyles.error]}>{error}</Text> : null}
            </View>
        </Dialog>
    );
}

const styles = StyleSheet.create({
    fields: { gap: 8 },
    label: { fontSize: 13, marginBottom: 4 },
    input: { borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 16 },
    textArea: { minHeight: 72, textAlignVertical: 'top' },
    typeRow: { flexDirection: 'row', gap: 8 },
    typeBtn: {},
    error: { fontSize: 13, marginTop: 8 },
});
