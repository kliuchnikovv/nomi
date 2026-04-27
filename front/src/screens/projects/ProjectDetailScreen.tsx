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
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../context/ThemeContext';
import { projectsApi, apiClient } from '../../apiClient';
import { getApiUrl } from '../../config';
import type { Project, Chat } from '../main/models';
import type { ProjectsStackParamList } from '../../navigation/types';
import type { RootTabParamList } from '../../navigation/types';
import type { NavigationProp } from '@react-navigation/native';

type Nav = NativeStackNavigationProp<ProjectsStackParamList, 'ProjectDetail'>;
type Route = RouteProp<ProjectsStackParamList, 'ProjectDetail'>;

export function ProjectDetailScreen() {
    const navigation = useNavigation<Nav>();
    const rootNav = useNavigation<NavigationProp<RootTabParamList>>();
    const route = useRoute<Route>();
    const { projectId } = route.params;
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const [project, setProject] = useState<Project | null>(null);
    const [chats, setChats] = useState<Chat[]>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [allProjects, allChats] = await Promise.all([
                projectsApi.list(),
                apiClient.get<Chat[]>(`${getApiUrl()}/chats`),
            ]);
            const found = (allProjects ?? []).find((p) => p.id === projectId) ?? null;
            setProject(found);
            setChats((allChats ?? []).filter((c) => c.project_id === projectId));
        } finally {
            setLoading(false);
        }
    }, [projectId]);

    useEffect(() => {
        const unsubscribe = navigation.addListener('focus', load);
        return unsubscribe;
    }, [navigation, load]);

    const handleDelete = () => {
        Alert.alert('Delete project', 'Are you sure? Chats will not be deleted.', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                    await projectsApi.delete(projectId);
                    navigation.goBack();
                },
            },
        ]);
    };

    const renderChat = ({ item }: { item: Chat }) => (
        <TouchableOpacity
            style={[styles.chatRow, { backgroundColor: theme.surface }]}
            onPress={() => rootNav.navigate('Chat', { screen: 'ChatDetail', params: { chatId: item.id } })}
            activeOpacity={0.7}
        >
            <Text style={styles.chatIcon}>{item.icon || '💬'}</Text>
            <Text style={[styles.chatTitle, { color: theme.textPrimary }]} numberOfLines={1}>{item.title}</Text>
            <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
        </TouchableOpacity>
    );

    if (loading) {
        return (
            <View style={[styles.container, { backgroundColor: theme.background, paddingTop: insets.top }]}>
                <ActivityIndicator style={styles.loader} color={theme.accent} />
            </View>
        );
    }

    if (!project) {
        return (
            <View style={[styles.container, { backgroundColor: theme.background, paddingTop: insets.top }]}>
                <Text style={[styles.errorText, { color: theme.textSecondary }]}>Project not found.</Text>
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: theme.background, paddingTop: insets.top }]}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="chevron-back" size={24} color={theme.textPrimary} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: theme.textPrimary }]} numberOfLines={1}>{project.name}</Text>
                <TouchableOpacity
                    onPress={() => navigation.navigate('CreateEditProject', { projectId })}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                    <Ionicons name="pencil" size={20} color={theme.accent} />
                </TouchableOpacity>
            </View>

            <View style={[styles.descriptionCard, { backgroundColor: theme.surface }]}>
                <Text style={styles.projectIcon}>{project.icon}</Text>
                {project.description ? (
                    <Text style={[styles.description, { color: theme.textSecondary }]}>{project.description}</Text>
                ) : (
                    <Text style={[styles.description, { color: theme.textSecondary, fontStyle: 'italic' }]}>No description.</Text>
                )}
            </View>

            <View style={styles.chatsHeader}>
                <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Chats</Text>
                <TouchableOpacity
                    onPress={() => rootNav.navigate('Chat', { screen: 'ChatList' })}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                    <Text style={[styles.newChatBtn, { color: theme.accent }]}>New chat</Text>
                </TouchableOpacity>
            </View>

            <FlatList
                data={chats}
                keyExtractor={(c: Chat) => c.id}
                renderItem={renderChat}
                ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: theme.border }]} />}
                ListEmptyComponent={
                    <Text style={[styles.emptyText, { color: theme.textSecondary }]}>No chats in this project yet.</Text>
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
    chatsHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingBottom: 8,
    },
    sectionTitle: { fontSize: 16, fontWeight: '600' },
    newChatBtn: { fontSize: 14, fontWeight: '500' },
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
    emptyText: { textAlign: 'center', marginTop: 24, fontSize: 14, paddingHorizontal: 32 },
    deleteBtn: {
        margin: 16,
        borderRadius: 10,
        borderWidth: 1,
        padding: 14,
        alignItems: 'center',
    },
    deleteBtnText: { color: '#FF3B30', fontSize: 15, fontWeight: '500' },
});
