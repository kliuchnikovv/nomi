import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import Dialog from '../../components/Dialog';
import { listsApi, List } from '../../apiClient';
import { useTheme } from '../../context/ThemeContext';

interface AddListModalProps {
    visible: boolean;
    onClose: () => void;
    onListCreated: (list: List) => void;
}

export default function AddListModal({ visible, onClose, onListCreated }: AddListModalProps) {
    const { theme, palette } = useTheme();
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!visible) {
            setName('');
            setDescription('');
            setError(null);
        }
    }, [visible]);

    const handleCreate = async () => {
        if (!name.trim()) {
            setError('Name is required');
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const list = await listsApi.create({ name: name.trim(), description: description.trim() });
            if (list) {
                onListCreated(list);
                onClose();
            }
        } catch (err: any) {
            setError(err.message || 'Failed to create list');
        } finally {
            setLoading(false);
        }
    };

    const dynamicStyles = {
        input: { borderColor: theme.border, color: theme.text, backgroundColor: theme.background },
        label: { color: theme.textSecondary },
        error: { color: palette.red },
    };

    return (
        <Dialog
            visible={visible}
            title="New list"
            onClose={onClose}
            dismissOnBackdrop={!loading}
            actions={[
                { label: 'Cancel', onPress: onClose },
                { label: loading ? 'Creating…' : 'Create', onPress: handleCreate, variant: 'primary' },
            ]}
        >
            <View style={styles.fields}>
                <Text style={[styles.label, dynamicStyles.label]}>Name</Text>
                <TextInput
                    style={[styles.input, dynamicStyles.input]}
                    value={name}
                    onChangeText={setName}
                    placeholder="List name"
                    placeholderTextColor={theme.textSecondary}
                    editable={!loading}
                    autoCapitalize="none"
                />
                <Text style={[styles.label, dynamicStyles.label]}>Description (optional)</Text>
                <TextInput
                    style={[styles.input, styles.textArea, dynamicStyles.input]}
                    value={description}
                    onChangeText={setDescription}
                    placeholder="Short description"
                    placeholderTextColor={theme.textSecondary}
                    multiline
                    numberOfLines={2}
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
    textArea: { minHeight: 60, textAlignVertical: 'top' },
    error: { fontSize: 13, marginTop: 8 },
});
