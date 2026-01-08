import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import Dialog from '../../components/Dialog';
import { tokyoNight } from '../../themes/tokyoNight';
import { projectsApi, Project } from '../../apiClient';

interface AddProjectModalProps {
    visible: boolean;
    onClose: () => void;
    onProjectCreated: (project: Project) => void;
}

export default function AddProjectModal({ visible, onClose, onProjectCreated }: AddProjectModalProps) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [repository, setRepository] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleCreate = async () => {
        if (!name.trim()) {
            setError('Name is required');
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const project = await projectsApi.create({
                name: name.trim(),
                description: description.trim(),
                repository: repository.trim(),
            });

            if (project) {
                onProjectCreated(project);
                setName('');
                setDescription('');
                setRepository('');
                onClose();
            }
        } catch (err: any) {
            setError(err.message || 'Failed to create project');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog
            visible={visible}
            onClose={onClose}
            title="Add Project"
            actions={[
                { label: 'Cancel', onPress: onClose },
                { label: loading ? 'Creating...' : 'Create', onPress: handleCreate, variant: 'primary' },
            ]}
        >
            <View style={styles.container}>
                <Text style={styles.label}>Project Name *</Text>
                <TextInput
                    style={styles.input}
                    value={name}
                    onChangeText={setName}
                    placeholder="My Awesome Project"
                    placeholderTextColor={tokyoNight.fadedText}
                />

                <Text style={styles.label}>Description</Text>
                <TextInput
                    style={[styles.input, styles.textArea]}
                    value={description}
                    onChangeText={setDescription}
                    placeholder="Short description..."
                    placeholderTextColor={tokyoNight.fadedText}
                    multiline
                    numberOfLines={3}
                />

                <Text style={styles.label}>GitHub Repository</Text>
                <TextInput
                    style={styles.input}
                    value={repository}
                    onChangeText={setRepository}
                    placeholder="owner/repo"
                    placeholderTextColor={tokyoNight.fadedText}
                    autoCapitalize="none"
                />
                <Text style={styles.helperText}>Example: facebook/react-native</Text>

                {error && <Text style={styles.errorText}>{error}</Text>}
            </View>
        </Dialog>
    );
}

const styles = StyleSheet.create({
    container: {
        marginTop: 8,
    },
    label: {
        color: tokyoNight.text,
        fontSize: 14,
        fontWeight: '600',
        marginBottom: 4,
        marginTop: 12,
    },
    input: {
        backgroundColor: 'rgba(0,0,0,0.2)',
        color: tokyoNight.text,
        borderRadius: 8,
        padding: 10,
        fontSize: 15,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: tokyoNight.border,
    },
    textArea: {
        height: 80,
        textAlignVertical: 'top',
    },
    helperText: {
        color: tokyoNight.fadedText,
        fontSize: 12,
        marginTop: 4,
    },
    errorText: {
        color: tokyoNight.error || tokyoNight.attention || '#ff4444',
        fontSize: 13,
        marginTop: 12,
    },
});
