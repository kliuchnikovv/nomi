import React, { useCallback, useEffect, useState } from 'react';
import {
    View,
    Text,
    FlatList,
    TouchableOpacity,
    StyleSheet,
    ActivityIndicator,
    Alert,
} from 'react-native';
import {
    useNavigation,
    useRoute,
    type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import DocumentPicker from 'react-native-document-picker';
import { useTheme } from '../../context/ThemeContext';
import { projectsApi, projectDocsApi, apiClient } from '../../apiClient';
import { getApiUrl } from '../../config';
import type { Project, Chat, ProjectDocument } from '../main/models';
import type { ProjectsStackParamList } from '../../navigation/types';

type Nav = NativeStackNavigationProp<ProjectsStackParamList, 'ProjectDetail'>;
type Route = RouteProp<ProjectsStackParamList, 'ProjectDetail'>;

export function ProjectDetailScreen() {
    const navigation = useNavigation<Nav>();
    const route = useRoute<Route>();
    const { projectId } = route.params;
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const [project, setProject] = useState<Project | null>(null);
    const [chats, setChats] = useState<Chat[]>([]);
    const [documents, setDocuments] = useState<ProjectDocument[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [allProjects, allChats, docs] = await Promise.all([
                projectsApi.list(),
                apiClient.get<Chat[]>(`${getApiUrl()}/chats`),
                projectDocsApi
                    .list(projectId)
                    .catch(() => [] as ProjectDocument[]),
            ]);
            const found =
                (allProjects ?? []).find(p => p.id === projectId) ?? null;
            setProject(found);
            setChats((allChats ?? []).filter(c => c.project_id === projectId));
            setDocuments(docs ?? []);
        } finally {
            setLoading(false);
        }
    }, [projectId]);

    useEffect(() => {
        const unsubscribe = navigation.addListener('focus', load);
        return unsubscribe;
    }, [navigation, load]);

    const handleDelete = () => {
        Alert.alert(
            'Delete project',
            'Are you sure? Chats will not be deleted.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        await projectsApi.delete(projectId);
                        navigation.goBack();
                    },
                },
            ],
        );
    };

    const handleAddDocument = useCallback(async () => {
        try {
            const result = await DocumentPicker.pick({
                type: [
                    DocumentPicker.types.pdf,
                    DocumentPicker.types.plainText,
                    DocumentPicker.types.allFiles,
                ],
                copyTo: 'cachesDirectory',
            });
            const asset = result?.[0];
            if (!asset) return;

            const name = asset.name || 'document';
            const lower = name.toLowerCase();
            const allowed =
                lower.endsWith('.txt') ||
                lower.endsWith('.md') ||
                lower.endsWith('.pdf');
            if (!allowed) {
                Alert.alert(
                    'Unsupported file',
                    'Only .txt, .md and .pdf files are supported.',
                );
                return;
            }

            setUploading(true);
            await projectDocsApi.upload(projectId, {
                uri: asset.fileCopyUri || asset.uri,
                name,
                type: asset.type || 'application/octet-stream',
            });
            await load();
        } catch (err: any) {
            if (DocumentPicker.isCancel(err)) return;
            Alert.alert(
                'Upload failed',
                err?.message
                    ? String(err.message)
                    : 'Could not upload the document.',
            );
        } finally {
            setUploading(false);
        }
    }, [projectId, load]);

    const handleDeleteDocument = useCallback(
        (doc: ProjectDocument) => {
            Alert.alert('Remove document', `Remove "${doc.file_name}"?`, [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: async () => {
                        setDocuments(prev => prev.filter(d => d.id !== doc.id));
                        try {
                            await projectDocsApi.delete(projectId, doc.id);
                        } catch {
                            await load();
                        }
                    },
                },
            ]);
        },
        [projectId, load],
    );

    const statusColor = (status: ProjectDocument['status']): string => {
        if (status === 'ready') return '#34C759';
        if (status === 'failed') return '#FF3B30';
        return theme.accent;
    };

    const renderChat = ({ item }: { item: Chat }) => (
        <TouchableOpacity
            style={[styles.chatRow, { backgroundColor: theme.surface }]}
            onPress={() =>
                navigation.navigate('ProjectChatDetail', { chatId: item.id })
            }
            activeOpacity={0.7}
        >
            <Text style={styles.chatIcon}>{item.icon || '💬'}</Text>
            <Text
                style={[styles.chatTitle, { color: theme.textPrimary }]}
                numberOfLines={1}
            >
                {item.title}
            </Text>
            <Ionicons
                name="chevron-forward"
                size={16}
                color={theme.textSecondary}
            />
        </TouchableOpacity>
    );

    if (loading) {
        return (
            <View
                style={[
                    styles.container,
                    {
                        backgroundColor: theme.background,
                        paddingTop: insets.top,
                    },
                ]}
            >
                <ActivityIndicator style={styles.loader} color={theme.accent} />
            </View>
        );
    }

    if (!project) {
        return (
            <View
                style={[
                    styles.container,
                    {
                        backgroundColor: theme.background,
                        paddingTop: insets.top,
                    },
                ]}
            >
                <Text
                    style={[styles.errorText, { color: theme.textSecondary }]}
                >
                    Project not found.
                </Text>
            </View>
        );
    }

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
                >
                    <Ionicons
                        name="chevron-back"
                        size={24}
                        color={theme.textPrimary}
                    />
                </TouchableOpacity>
                <Text
                    style={[styles.headerTitle, { color: theme.textPrimary }]}
                    numberOfLines={1}
                >
                    {project.name}
                </Text>
                <TouchableOpacity
                    onPress={() =>
                        navigation.navigate('CreateEditProject', { projectId })
                    }
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                    <Ionicons name="pencil" size={20} color={theme.accent} />
                </TouchableOpacity>
            </View>

            <View
                style={[
                    styles.descriptionCard,
                    { backgroundColor: theme.surface },
                ]}
            >
                <Text style={styles.projectIcon}>{project.icon}</Text>
                {project.description ? (
                    <Text
                        style={[
                            styles.description,
                            { color: theme.textSecondary },
                        ]}
                    >
                        {project.description}
                    </Text>
                ) : (
                    <Text
                        style={[
                            styles.description,
                            { color: theme.textSecondary, fontStyle: 'italic' },
                        ]}
                    >
                        No description.
                    </Text>
                )}
            </View>

            <View style={styles.sectionHeaderRow}>
                <Text
                    style={[styles.sectionTitle, { color: theme.textPrimary }]}
                >
                    Documents
                </Text>
                <TouchableOpacity
                    onPress={handleAddDocument}
                    disabled={uploading}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                    {uploading ? (
                        <ActivityIndicator size="small" color={theme.accent} />
                    ) : (
                        <Text
                            style={[styles.newChatBtn, { color: theme.accent }]}
                        >
                            Add document
                        </Text>
                    )}
                </TouchableOpacity>
            </View>

            {documents.length === 0 ? (
                <Text style={[styles.docHint, { color: theme.textSecondary }]}>
                    Attach .txt, .md or .pdf files. Their content becomes
                    searchable by the assistant in this project's chats.
                </Text>
            ) : (
                documents.map(doc => (
                    <View
                        key={doc.id}
                        style={[
                            styles.docRow,
                            { backgroundColor: theme.surface },
                        ]}
                    >
                        <Ionicons
                            name="document-text-outline"
                            size={18}
                            color={theme.textSecondary}
                        />
                        <View style={styles.docInfo}>
                            <Text
                                style={[
                                    styles.docName,
                                    { color: theme.textPrimary },
                                ]}
                                numberOfLines={1}
                            >
                                {doc.file_name}
                            </Text>
                            <Text
                                style={[
                                    styles.docStatus,
                                    { color: statusColor(doc.status) },
                                ]}
                            >
                                {doc.status === 'ready'
                                    ? `Ready · ${doc.chunk_count} chunks`
                                    : doc.status === 'failed'
                                    ? 'Failed to index'
                                    : 'Indexing…'}
                            </Text>
                        </View>
                        <TouchableOpacity
                            onPress={() => handleDeleteDocument(doc)}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                            <Ionicons
                                name="trash-outline"
                                size={18}
                                color="#FF3B30"
                            />
                        </TouchableOpacity>
                    </View>
                ))
            )}

            <View style={styles.sectionHeaderRow}>
                <Text
                    style={[styles.sectionTitle, { color: theme.textPrimary }]}
                >
                    Chats
                </Text>
                <TouchableOpacity
                    onPress={() =>
                        navigation.navigate('ProjectChatDetail', {
                            chatId: '',
                            projectId,
                        })
                    }
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                    <Text style={[styles.newChatBtn, { color: theme.accent }]}>
                        New chat
                    </Text>
                </TouchableOpacity>
            </View>

            <FlatList
                data={chats}
                keyExtractor={(c: Chat) => c.id}
                renderItem={renderChat}
                ItemSeparatorComponent={() => (
                    <View
                        style={[
                            styles.separator,
                            { backgroundColor: theme.border },
                        ]}
                    />
                )}
                ListEmptyComponent={
                    <Text
                        style={[
                            styles.emptyText,
                            { color: theme.textSecondary },
                        ]}
                    >
                        No chats in this project yet.
                    </Text>
                }
            />

            <TouchableOpacity
                style={[styles.deleteBtn, { borderColor: theme.border }]}
                onPress={handleDelete}
            >
                <Text style={styles.deleteBtnText}>Delete project</Text>
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    loader: { flex: 1 },
    errorText: { textAlign: 'center', marginTop: 40, fontSize: 15 },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 12,
    },
    headerTitle: { flex: 1, fontSize: 18, fontWeight: '600' },
    descriptionCard: {
        marginHorizontal: 16,
        marginBottom: 16,
        borderRadius: 12,
        padding: 16,
        gap: 8,
    },
    projectIcon: { fontSize: 32 },
    description: { fontSize: 14, lineHeight: 20 },
    sectionHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingBottom: 8,
    },
    sectionTitle: { fontSize: 16, fontWeight: '600' },
    newChatBtn: { fontSize: 14, fontWeight: '500' },
    docHint: {
        fontSize: 13,
        lineHeight: 18,
        paddingHorizontal: 16,
        paddingBottom: 12,
    },
    docRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: 16,
        marginBottom: 8,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 12,
        gap: 12,
    },
    docInfo: { flex: 1, gap: 2 },
    docName: { fontSize: 14, fontWeight: '500' },
    docStatus: { fontSize: 12 },
    chatRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 14,
        gap: 12,
    },
    chatIcon: { fontSize: 18 },
    chatTitle: { flex: 1, fontSize: 15 },
    separator: { height: StyleSheet.hairlineWidth, marginLeft: 56 },
    emptyText: {
        textAlign: 'center',
        marginTop: 24,
        fontSize: 14,
        paddingHorizontal: 32,
    },
    deleteBtn: {
        margin: 16,
        borderRadius: 10,
        borderWidth: 1,
        padding: 14,
        alignItems: 'center',
    },
    deleteBtnText: { color: '#FF3B30', fontSize: 15, fontWeight: '500' },
});
