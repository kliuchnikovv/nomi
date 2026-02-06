import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet } from 'react-native';
import { Github, RefreshCw, ExternalLink } from 'iconoir-react-native';
import { useTheme } from '@genie/front/context/ThemeContext';
import { ThemePalette } from '@genie/front/themes/types';
import { PluginMainScreenProps } from '@genie/front/plugins/types';

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

export function GithubMainScreen({ integrationId }: PluginMainScreenProps) {
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
        // In a real app, use Linking.openURL(url)
        console.log('Opening repo:', url);
    };

    return (
        <View style={{ flex: 1, backgroundColor: theme.background }}>
            <View style={styles.header}>
                <View style={styles.headerLeft}>
                    <Github width={24} height={24} color={palette.black} />
                    <Text style={styles.title}>GitHub</Text>
                </View>
                <Pressable onPress={loadRepos}>
                    <RefreshCw 
                        width={20} 
                        height={20} 
                        color={theme.text} 
                        style={loading ? { transform: [{ rotate: '360deg' }] } : {}} 
                    />
                </Pressable>
            </View>

            <FlatList
                data={repos}
                keyExtractor={(item) => item.id.toString()}
                contentContainerStyle={styles.listContent}
                onRefresh={loadRepos}
                refreshing={loading}
                ListEmptyComponent={
                    !loading ? (
                        <View style={styles.emptyState}>
                            <Text style={styles.emptyText}>No repositories found</Text>
                            <Text style={styles.emptySubtext}>Connect your GitHub account to see your repositories</Text>
                        </View>
                    ) : null
                }
                renderItem={({ item }) => (
                    <Pressable 
                        style={styles.repoItem}
                        onPress={() => openRepo(item.html_url)}
                    >
                        <View style={styles.repoHeader}>
                            <Text style={styles.repoName}>{item.name}</Text>
                            <ExternalLink width={16} height={16} color={theme.textSecondary} />
                        </View>
                        {item.description && (
                            <Text style={styles.repoDescription} numberOfLines={2}>
                                {item.description}
                            </Text>
                        )}
                        <View style={styles.repoFooter}>
                            {item.language && (
                                <View style={styles.languageBadge}>
                                    <View style={[styles.languageDot, { backgroundColor: getLanguageColor(item.language, palette) }]} />
                                    <Text style={styles.languageText}>{item.language}</Text>
                                </View>
                            )}
                            <View style={styles.stat}>
                                <Text style={styles.statText}>★ {item.stargazers_count}</Text>
                            </View>
                        </View>
                    </Pressable>
                )}
            />
        </View>
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
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    title: {
        fontSize: 18,
        fontWeight: '600',
    },
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
        color: '#666',
        marginTop: 8,
        textAlign: 'center',
    },
    repoItem: {
        backgroundColor: '#fff',
        borderRadius: 12,
        padding: 16,
        borderWidth: 1,
        borderColor: '#e0e0e0',
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
        color: '#666',
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
        color: '#666',
    },
    stat: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    statText: {
        fontSize: 12,
        color: '#666',
    },
});
