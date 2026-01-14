import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import Dialog from '../../components/Dialog';
import { tokyoNight } from '../../themes/tokyoNight';
import { projectsApi, Project } from '../../apiClient';
import { integrationStorage } from '../../services/integrations';
import { Github, Folder, Search } from 'iconoir-react-native';

interface AddProjectModalProps {
    visible: boolean;
    onClose: () => void;
    onProjectCreated: (project: Project) => void;
}

interface Repo {
    id: number;
    name: string;
    url: string;
    private: boolean;
    description?: string;
}

export default function AddProjectModal({ visible, onClose, onProjectCreated }: AddProjectModalProps) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [repository, setRepository] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [repos, setRepos] = useState<Repo[]>([]);
    const [fetchingRepos, setFetchingRepos] = useState(false);
    const [showRepoList, setShowRepoList] = useState(false);
    const [githubToken, setGithubToken] = useState<string | undefined>(undefined);

    useEffect(() => {
        if (visible) {
            fetchRepos();
        } else {
            // Reset state on close
            setName('');
            setDescription('');
            setRepository('');
            setShowRepoList(false);
        }
    }, [visible]);

    const fetchRepos = async () => {
        setFetchingRepos(true);
        try {
            const integrations = await integrationStorage.getIntegrations();
            const githubInteg = integrations.find(i => i.provider === 'github' && i.enabled);

            if (githubInteg) {
                const creds = await integrationStorage.getCredentials(githubInteg.id);
                if (creds?.accessToken) {
                    setGithubToken(creds.accessToken);
                    const res = await projectsApi.listRepositories(creds.accessToken);
                    if (res?.repos) {
                        setRepos(res.repos);
                    }
                }
            }
        } catch (e) {
            console.warn('Failed to fetch repos', e);
        } finally {
            setFetchingRepos(false);
        }
    };

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
                github_token: githubToken,
            });

            if (project) {
                onProjectCreated(project);
                onClose();
            }
        } catch (err: any) {
            setError(err.message || 'Failed to create project');
        } finally {
            setLoading(false);
        }
    };

    const filteredRepos = repos.filter(r =>
        r.name.toLowerCase().includes(repository.toLowerCase())
    );

    const handleSelectRepo = (repo: Repo) => {
        setRepository(repo.name);
        setShowRepoList(false);
        if (!name) setName(repo.name.split('/')[1] || repo.name);
        if (!description && repo.description) setDescription(repo.description);
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
                <Text style={styles.label}>GitHub Repository</Text>
                <View style={styles.repoInputContainer}>
                    <Github width={16} height={16} color={tokyoNight.textSecondary} style={styles.inputIcon} />
                    <TextInput
                        style={styles.repoInput}
                        value={repository}
                        onChangeText={(text) => {
                            setRepository(text);
                            setShowRepoList(true);
                        }}
                        placeholder="owner/repo"
                        placeholderTextColor={tokyoNight.fadedText}
                        autoCapitalize="none"
                        onFocus={() => setShowRepoList(true)}
                    />
                    {fetchingRepos && <ActivityIndicator size="small" color={tokyoNight.textSecondary} style={{ marginRight: 8 }} />}
                </View>

                {showRepoList && repos.length > 0 && (
                    <View style={styles.repoListContainer}>
                        {filteredRepos.length > 0 ? (
                            <FlatList
                                data={filteredRepos.slice(0, 5)} // Show top 5 matches
                                keyExtractor={item => item.id.toString()}
                                keyboardShouldPersistTaps="always"
                                renderItem={({ item }) => (
                                    <TouchableOpacity
                                        style={styles.repoItem}
                                        onPress={() => handleSelectRepo(item)}
                                    >
                                        <Folder width={14} height={14} color={tokyoNight.accent} style={{ marginRight: 8 }} />
                                        <View style={{ flex: 1 }}>
                                            <Text style={styles.repoName}>{item.name}</Text>
                                        </View>
                                        {item.private && <Text style={styles.privateTag}>Private</Text>}
                                    </TouchableOpacity>
                                )}
                            />
                        ) : (
                            <Text style={styles.noRepoText}>No repositories found</Text>
                        )}
                    </View>
                )}

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
    repoInputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.2)',
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: tokyoNight.border,
    },
    inputIcon: {
        marginLeft: 10,
    },
    repoInput: {
        flex: 1,
        color: tokyoNight.text,
        padding: 10,
        fontSize: 15,
    },
    repoListContainer: {
        backgroundColor: tokyoNight.surface,
        borderRadius: 8,
        marginTop: 4,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: tokyoNight.border,
        maxHeight: 200,
        zIndex: 1000,
    },
    repoItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: tokyoNight.border,
    },
    repoName: {
        color: tokyoNight.text,
        fontSize: 14,
    },
    privateTag: {
        fontSize: 10,
        color: tokyoNight.textSecondary,
        backgroundColor: 'rgba(255,255,255,0.1)',
        paddingHorizontal: 4,
        paddingVertical: 2,
        borderRadius: 4,
    },
    noRepoText: {
        color: tokyoNight.fadedText,
        padding: 10,
        textAlign: 'center',
        fontSize: 13,
    },
    textArea: {
        height: 80,
        textAlignVertical: 'top',
    },
    errorText: {
        color: tokyoNight.error || tokyoNight.attention || '#ff4444',
        fontSize: 13,
        marginTop: 12,
    },
});
