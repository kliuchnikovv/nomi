import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { Github, RefreshCw, ExternalLink } from 'iconoir-react-native';
import { useTheme } from '@genie/front/context/ThemeContext';
import { ThemePalette } from '@genie/front/themes/types';
import { PluginMainScreenProps } from '@genie/front/plugins/types';
import { SharedPluginScreen } from '@genie/front/plugins/components/SharedPluginScreen';

interface Repo {
    id: number;
    name: string;
    full_name: string;
    description: string | null;
    html_url: string;
    stargazers_count: number;
    language: string | null;
    updated_at: string;
}

export function GithubMainScreen({ integrationId, onClose }: PluginMainScreenProps) {
    const { theme, palette } = useTheme();
    const [repos, setRepos] = useState<Repo[]>([]);
    const [loading, setLoading] = useState(true);

    const loadRepos = async () => {
        try {
            setLoading(true);
            // TODO: Implement github client to fetch repos
            // const data = await githubClient.listRepos(integrationId);
            // setRepos(data);
        } catch (error) {
            console.error('Failed to load GitHub repos:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadRepos();
    }, [integrationId]);

    const openRepo = (url: string) => {
        console.log('Opening repo:', url);
        onClose?.(true);
    };

    return (
        <SharedPluginScreen title="GitHub" onClose={onClose}>
            <FlatList
                data={repos}
                keyExtractor={(item) => item.id.toString()}
                contentContainerStyle={styles.listContent}
                onRefresh={loadRepos}
                refreshing={loading}
                ListEmptyComponent={
                    !loading ? (
                        <View style={styles.emptyState}>
                            <Text style={[styles.emptyText, { color: theme.text }]}>No repositories found</Text>
                            <Text style={[styles.emptySubtext, { color: theme.textSecondary }]}>Connect your GitHub account to see your repositories</Text>
                        </View>
                    ) : null
                }
                renderItem={({ item }) => (
                    <Pressable
                        style={[styles.repoItem, { backgroundColor: theme.card, borderColor: theme.border }]}
                        onPress={() => openRepo(item.html_url)}
                    >
                        <View style={styles.repoHeader}>
                            <Text style={[styles.repoName, { color: theme.text }]}>{item.name}</Text>
                            <ExternalLink width={16} height={16} color={theme.textSecondary} />
                        </View>
                        {item.description && (
                            <Text style={[styles.repoDescription, { color: theme.textSecondary }]} numberOfLines={2}>
                                {item.description}
                            </Text>
                        )}
                        <View style={styles.repoFooter}>
                            {item.language && (
                                <View style={styles.languageBadge}>
                                    <View style={[styles.languageDot, { backgroundColor: getLanguageColor(item.language, palette) }]} />
                                    <Text style={[styles.languageText, { color: theme.textSecondary }]}>{item.language}</Text>
                                </View>
                            )}
                            <View style={styles.stat}>
                                <Text style={[styles.statText, { color: theme.textSecondary }]}>★ {item.stargazers_count}</Text>
                            </View>
                        </View>
                    </Pressable>
                )}
            />
        </SharedPluginScreen>
    );
}

function getLanguageColor(language: string, palette: ThemePalette): string {
    const colors: Record<string, string> = {
        TypeScript: palette.blue,
        JavaScript: palette.yellow,
        Python: palette.green,
        Go: palette.cyan,
        Rust: palette.orange,
        Java: palette.red,
        'C++': palette.purple,
        Swift: palette.pink,
    };
    return colors[language] || palette.textSecondary;
}

const styles = StyleSheet.create({
    listContent: {
        padding: 16,
        gap: 12,
    },
    emptyState: {
        alignItems: 'center',
        paddingVertical: 40,
    },
    emptyText: {
        fontSize: 16,
        fontWeight: '500',
    },
    emptySubtext: {
        fontSize: 14,
        marginTop: 8,
        textAlign: 'center',
    },
    repoItem: {
        borderRadius: 12,
        padding: 16,
        borderWidth: 1,
    },
    repoHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8,
    },
    repoName: {
        fontSize: 16,
        fontWeight: '600',
    },
    repoDescription: {
        fontSize: 14,
        marginBottom: 12,
    },
    repoFooter: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
    },
    languageBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    languageDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
    },
    languageText: {
        fontSize: 12,
    },
    stat: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    statText: {
        fontSize: 12,
    },
});
