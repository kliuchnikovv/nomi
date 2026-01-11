import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, Keyboard, TouchableWithoutFeedback } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { projectsApi } from '../apiClient';

interface Project {
    id: string;
    name: string;
}

interface NewTaskModalProps {
    visible: boolean;
    onClose: () => void;
    onTaskCreated: (task: any, projectId: string) => void;
}

export const NewTaskModal = ({ visible, onClose, onTaskCreated }: NewTaskModalProps) => {
    const { theme } = useTheme();
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(false);
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        if (visible) {
            loadProjects();
            setTitle('');
            setDescription('');
            setSelectedProjectId(null);
        }
    }, [visible]);

    const loadProjects = async () => {
        setLoading(true);
        try {
            const data = await projectsApi.list();
            setProjects(data);
            if (data.length > 0) {
                setSelectedProjectId(data[0].id);
            }
        } catch (e) {
            console.error('Failed to load projects', e);
            Alert.alert('Error', 'Failed to load projects');
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async () => {
        if (!title.trim() || !selectedProjectId) {
            Alert.alert('Error', 'Please enter a title and select a project');
            return;
        }

        setCreating(true);
        try {
            const task = await projectsApi.createTask(selectedProjectId, {
                title,
                description,
                priority: 'medium',
            });
            onTaskCreated(task, selectedProjectId);
            onClose();
        } catch (e) {
            console.error('Failed to create task', e);
            Alert.alert('Error', 'Failed to create task');
        } finally {
            setCreating(false);
        }
    };

    return (
        <Modal
            visible={visible}
            animationType="slide"
            transparent={true}
            onRequestClose={onClose}
        >
            <KeyboardAvoidingView
                style={styles.keyboardAvoidingView}
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
            >
                <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
                    <View style={styles.centeredView}>
                        <View style={[styles.modalView, { backgroundColor: theme.background, borderColor: theme.border }]}>
                            <ScrollView
                                showsVerticalScrollIndicator={false}
                                keyboardShouldPersistTaps="handled"
                                contentContainerStyle={styles.scrollContent}
                            >
                                <Text style={[styles.modalTitle, { color: theme.text }]}>New Task</Text>

                                {loading ? (
                                    <ActivityIndicator size="large" color={theme.primary} />
                                ) : (
                                    <>
                                        <Text style={[styles.label, { color: theme.textSecondary }]}>Project</Text>
                                        <View style={styles.projectList}>
                                            {projects.map(project => (
                                                <TouchableOpacity
                                                    key={project.id}
                                                    style={[
                                                        styles.projectItem,
                                                        selectedProjectId === project.id && { backgroundColor: theme.primary + '20', borderColor: theme.primary }
                                                    ]}
                                                    onPress={() => setSelectedProjectId(project.id)}
                                                >
                                                    <Text style={[
                                                        styles.projectText,
                                                        { color: selectedProjectId === project.id ? theme.primary : theme.text }
                                                    ]}>
                                                        {project.name}
                                                    </Text>
                                                </TouchableOpacity>
                                            ))}
                                        </View>

                                        <Text style={[styles.label, { color: theme.textSecondary }]}>Task Title</Text>
                                        <TextInput
                                            style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
                                            placeholder="E.g. Refactor Login"
                                            placeholderTextColor={theme.textSecondary}
                                            value={title}
                                            onChangeText={setTitle}
                                        />

                                        <Text style={[styles.label, { color: theme.textSecondary }]}>Description (Optional)</Text>
                                        <TextInput
                                            style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface, height: 80 }]}
                                            placeholder="Details about the task..."
                                            placeholderTextColor={theme.textSecondary}
                                            value={description}
                                            onChangeText={setDescription}
                                            multiline
                                        />

                                        <View style={styles.actions}>
                                            <TouchableOpacity style={[styles.button, { backgroundColor: theme.surface }]} onPress={onClose}>
                                                <Text style={[styles.buttonText, { color: theme.text }]}>Cancel</Text>
                                            </TouchableOpacity>
                                            <TouchableOpacity
                                                style={[styles.button, { backgroundColor: theme.primary }]}
                                                onPress={handleCreate}
                                                disabled={creating}
                                            >
                                                {creating ? (
                                                    <ActivityIndicator color="#FFF" size="small" />
                                                ) : (
                                                    <Text style={[styles.buttonText, { color: '#FFF' }]}>Create & Chat</Text>
                                                )}
                                            </TouchableOpacity>
                                        </View>
                                    </>
                                )}
                            </ScrollView>
                        </View>
                    </View>
                </TouchableWithoutFeedback>
            </KeyboardAvoidingView>
        </Modal>
    );
};

const styles = StyleSheet.create({
    keyboardAvoidingView: {
        flex: 1,
    },
    scrollContent: {
        flexGrow: 1,
    },
    centeredView: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.5)',
    },
    modalView: {
        width: '90%',
        maxWidth: 500,
        borderRadius: 20,
        padding: 24,
        borderWidth: 1,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 5,
    },
    modalTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 20,
    },
    label: {
        fontSize: 14,
        marginBottom: 8,
        fontWeight: '600',
    },
    input: {
        borderWidth: 1,
        borderRadius: 12,
        padding: 12,
        marginBottom: 20,
        fontSize: 16,
    },
    projectList: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginBottom: 20,
        gap: 8,
    },
    projectItem: {
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: 'transparent',
        backgroundColor: 'rgba(150, 150, 150, 0.1)',
    },
    projectText: {
        fontSize: 14,
        fontWeight: '500',
    },
    actions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: 12,
    },
    button: {
        paddingVertical: 12,
        paddingHorizontal: 20,
        borderRadius: 12,
        minWidth: 100,
        alignItems: 'center',
    },
    buttonText: {
        fontSize: 16,
        fontWeight: '600',
    },
});
