import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Pressable,
    Text,
    View,
    StyleSheet
} from 'react-native';
import { Plus, Trash, Github, Play, Check, XmarkCircle, Folder, RefreshDouble } from 'iconoir-react-native';
import Animated, { useAnimatedStyle, withRepeat, withTiming, withSequence } from 'react-native-reanimated';
import { projectsApi, Project } from '../apiClient';
import { useTheme } from '../context/ThemeContext';
import { ThemePalette } from '../themes/types';
import AddProjectModal from '../screens/integrationsSidebar/AddProjectModal';
import { integrationStorage } from '../services/integrations';

const formatTimestamp = (timestamp?: number) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) {
        return `${diffMins}m ago`;
    } else if (diffHours < 24) {
        return `${diffHours}h ago`;
    } else if (diffDays < 7) {
        return `${diffDays}d ago`;
    }
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
};

function ProjectCard({
    project,
    isActive,
    onPress,
    onDelete,
    onReindex,
    theme,
    palette
}: {
    project: Project;
    isActive: boolean;
    onPress: () => void;
    onDelete: (id: string) => void;
    onReindex: (id: string) => void;
    theme: any;
    palette: ThemePalette;
}) {
    const isAnalyzing = project.status === 'ANALYZING';

    const pulseStyle = useAnimatedStyle(() => {
        if (!isAnalyzing) return { opacity: 1 };
        return {
            opacity: withRepeat(
                withSequence(
                    withTiming(0.4, { duration: 1000 }),
                    withTiming(1, { duration: 1000 })
                ),
                -1,
                true
            )
        };
    });

    const getStatusInfo = () => {
        switch (project.status) {
            case 'ANALYZING':
                return { label: 'Analyzing', color: palette.blue, Icon: Play };
            case 'READY':
                return { label: 'Ready', color: palette.green, Icon: Check };
            case 'FAILED':
                return { label: 'Failed', color: palette.red, Icon: XmarkCircle };
            default:
                return { label: 'Pending', color: palette.commentGrey, Icon: Play };
        }
    };

    const statusInfo = getStatusInfo();
    const StatusIcon = statusInfo.Icon;

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                {
                    backgroundColor: isActive ? `${theme.accent}15` : 'transparent',
                    borderRadius: 12,
                    padding: 12,
                    marginBottom: 8,
                    borderWidth: 1,
                    borderColor: isActive ? theme.accent : theme.border,
                    opacity: pressed ? 0.8 : 1,
                }
            ]}
        >
            <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                <View style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    backgroundColor: `${statusInfo.color}15`,
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginRight: 12
                }}>
                    <Folder width={18} height={18} color={statusInfo.color} />
                </View>
                <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ color: theme.text, fontWeight: '700', fontSize: 15, flex: 1, marginRight: 8 }} numberOfLines={1}>
                            {project.name}
                        </Text>
                        <View style={{ flexDirection: 'row', gap: 16 }}>
                            {project.repository && project.status !== 'ANALYZING' && (
                                <Pressable key="reindex" onPress={(e) => { e.stopPropagation(); onReindex(project.id); }}>
                                    <RefreshDouble width={14} height={14} color={theme.textSecondary} />
                                </Pressable>
                            )}
                            <Pressable key="delete" onPress={(e) => { e.stopPropagation(); onDelete(project.id); }}>
                                <Trash width={14} height={14} color={palette.red} />
                            </Pressable>
                        </View>
                    </View>

                    {project.repository && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                            <Github width={12} height={12} color={theme.textSecondary} style={{ marginRight: 4 }} />
                            <Text style={{ color: theme.textSecondary, fontSize: 12 }} numberOfLines={1}>
                                {project.repository}
                            </Text>
                        </View>
                    )}

                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                        <Animated.View style={[
                            {
                                flexDirection: 'row',
                                alignItems: 'center',
                                backgroundColor: `${statusInfo.color}15`,
                                paddingHorizontal: 6,
                                paddingVertical: 2,
                                borderRadius: 4,
                            },
                            pulseStyle
                        ]}>
                            <StatusIcon width={10} height={10} color={statusInfo.color} style={{ marginRight: 4 }} />
                            <Text style={{ color: statusInfo.color, fontSize: 10, fontWeight: '700', textTransform: 'uppercase' }}>
                                {statusInfo.label}
                            </Text>
                        </Animated.View>
                        {project.last_indexed_at && (
                            <Text key="indexed-at" style={{ color: theme.textSecondary, fontSize: 10, marginLeft: 8 }}>
                                Indexed {formatTimestamp(new Date(project.last_indexed_at).getTime())}
                            </Text>
                        )}
                    </View>
                </View>
            </View>
        </Pressable>
    );
}

export function ProjectList({ visible = true }: { visible?: boolean }) {
    const { theme, palette } = useTheme();
    const [projects, setProjects] = useState<Project[]>([]);
    const [projectsLoading, setProjectsLoading] = useState(false);
    const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
    const [isAddModalVisible, setIsAddModalVisible] = useState(false);
    const [projectsLoaded, setProjectsLoaded] = useState(false);

    const fetchProjects = async (silent = false) => {
        if (!silent) setProjectsLoading(true);
        try {
            const data = await projectsApi.list();
            if (data) setProjects(data);
        } catch (err) {
            console.error('Failed to fetch projects', err);
        } finally {
            if (!silent) setProjectsLoading(false);
        }
    };

    const handleDeleteProject = async (id: string) => {
        const project = projects.find(p => p.id === id);
        if (!project) return;

        Alert.alert(
            'Delete Project',
            `Are you sure you want to delete "${project.name}"? This will also remove all indexed knowledge.`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await projectsApi.delete(id);
                            setProjects(prev => prev.filter(p => p.id !== id));
                            if (activeProjectId === id) setActiveProjectId(null);
                        } catch (err) {
                            console.error('Failed to delete project', err);
                            Alert.alert('Error', 'Failed to delete project');
                        }
                    }
                }
            ]
        );
    };

    const handleReindexProject = async (id: string) => {
        const project = projects.find(p => p.id === id);
        if (!project) return;

        Alert.alert(
            'Re-index Project',
            `This will delete existing knowledge and re-analyze the repository "${project.repository}". Continue?`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Re-index',
                    onPress: async () => {
                        try {
                            // Get GitHub token for private repos
                            let githubToken: string | undefined;
                            const integrations = await integrationStorage.getIntegrations();
                            const githubInteg = integrations.find(i => i.provider === 'github' && i.enabled);
                            if (githubInteg) {
                                const creds = await integrationStorage.getCredentials(githubInteg.id);
                                githubToken = creds?.accessToken;
                            }

                            // Optimistic update
                            setProjects(prev => prev.map(p =>
                                p.id === id ? { ...p, status: 'ANALYZING' as const } : p
                            ));
                            await projectsApi.reindex(id, githubToken);
                        } catch (err) {
                            console.error('Failed to reindex project', err);
                            Alert.alert('Error', 'Failed to start re-indexing');
                            // Revert on error
                            fetchProjects(true);
                        }
                    }
                }
            ]
        );
    };

    // Load projects only when sidebar becomes visible (or component mounted if always visible)
    useEffect(() => {
        if (visible && !projectsLoaded) {
            fetchProjects();
            setProjectsLoaded(true);
        }
    }, [visible, projectsLoaded]);

    // Poll for status updates if any project is ANALYZING
    useEffect(() => {
        const hasAnalyzing = projects.some(p => p.status === 'ANALYZING');
        if (!hasAnalyzing) return;

        const interval = setInterval(() => {
            fetchProjects(true);
        }, 5000);

        return () => clearInterval(interval);
    }, [projects]);

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
            <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Projects</Text>
                <Pressable
                    style={({ pressed }) => [
                        {
                            opacity: pressed ? 0.6 : 1,
                            padding: 6,
                            backgroundColor: `${theme.accent}15`,
                            borderRadius: 8
                        },
                    ]}
                    onPress={() => setIsAddModalVisible(true)}
                >
                    <Plus width={18} height={18} color={theme.accent} strokeWidth={2.5} />
                </Pressable>
            </View>

            {projectsLoading && projects.length === 0 ? (
                <View style={{ padding: 16 }}>
                    <ActivityIndicator size="small" color={theme.accent} />
                </View>
            ) : (
                <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
                    {projects.length === 0 ? (
                        <View style={{
                            padding: 16,
                            borderRadius: 12,
                            borderWidth: 1,
                            borderColor: theme.border,
                            borderStyle: 'dashed',
                            alignItems: 'center'
                        }}>
                            <Text style={{ color: theme.textSecondary, fontSize: 13 }}>
                                No projects yet
                            </Text>
                        </View>
                    ) : (
                        projects.map((project, index) => (
                            <ProjectCard
                                key={project.id || `project-${index}`}
                                project={project}
                                isActive={activeProjectId === project.id}
                                onPress={() => setActiveProjectId(activeProjectId === project.id ? null : project.id)}
                                onDelete={handleDeleteProject}
                                onReindex={handleReindexProject}
                                theme={theme}
                                palette={palette}
                            />
                        ))
                    )}
                </View>
            )}

            <AddProjectModal
                visible={isAddModalVisible}
                onClose={() => setIsAddModalVisible(false)}
                onProjectCreated={(project) => {
                    setProjects(prev => [...prev, project]);
                }}
            />
        </View>
    );
}
