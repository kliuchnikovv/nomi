import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Github } from "iconoir-react-native";
import { useTheme } from "@nomi/front/context/ThemeContext";
import { ThemePalette, ThemeColors } from "@nomi/front/themes/types";
import { PluginMainScreenProps } from "@nomi/front/plugins/types";
import { SharedPluginScreen } from "@nomi/front/plugins/components/SharedPluginScreen";
import { getApiUrl } from "@nomi/front/config";
import { authStore } from "@nomi/front/apiClient";
import { ContextItem } from "@nomi/front/screens/chat/components/ContextItemCard";
import { contextStore } from "@nomi/front/services/ContextStore";
import { gitHubRepoCache } from "../cache";

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

export function GithubMainScreen({
  integrationId,
  onClose,
}: PluginMainScreenProps) {
  const { theme, palette } = useTheme();
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadRepos = async (forceRefresh = false) => {
    try {
      setLoading(true);
      setError(null);

      const apiUrl = getApiUrl();
      const token = authStore.getToken();

      if (!token) {
        throw new Error("Not authenticated");
      }

      // Try to get from cache first
      if (!forceRefresh && integrationId) {
        try {
          const cached = await gitHubRepoCache.getCachedRepos(integrationId);
          if (cached.length > 0) {
            setRepos(cached);
            setLoading(false);
            return;
          }
        } catch (error) {
          console.error("[GithubMainScreen] Failed to load from cache:", error);
        }
      }

      const response = await fetch(`${apiUrl}/github/repos?limit=30`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Failed to load repositories");
      }

      const data = await response.json();
      const repos = data.repos || [];
      setRepos(repos);

      // Update client-side cache
      if (integrationId && repos.length > 0) {
        try {
          await gitHubRepoCache.setCachedRepos(integrationId, repos);
        } catch (error) {
          console.error("[GithubMainScreen] Failed to update cache:", error);
        }
      }
    } catch (error) {
      console.error("Failed to load GitHub repos:", error);
      setError(
        error instanceof Error ? error.message : "Failed to load repositories"
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRepos(false);
  }, [integrationId]);

  const handleRefresh = () => {
    loadRepos(true);
  };

  const openRepo = async (repo: Repo) => {
    console.log("[GithubMainScreen] Adding repository to context:", repo.id, repo.full_name);
    try {
      const item: ContextItem = {
        id: repo.id.toString(),
        sourceType: "github_repo",
        title: repo.full_name,
        preview: repo.description || "",
        metadata: {
          name: repo.name,
          full_name: repo.full_name,
          description: repo.description,
          html_url: repo.html_url,
          stargazers_count: repo.stargazers_count,
          language: repo.language,
          updated_at: repo.updated_at,
        },
        addedAt: Date.now(),
      };

      console.log("[GithubMainScreen] Adding to contextStore:", item);
      contextStore.add(item);
      onClose?.(true);
    } catch (error) {
      console.error("[GithubMainScreen] Failed to add repository to context:", error);
    }
  };

  return (
    <SharedPluginScreen title="GitHub" onClose={onClose}>
      <FlatList
        data={repos}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.listContent}
        onRefresh={handleRefresh}
        refreshing={loading}
        ListEmptyComponent={
          loading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator size="large" color={theme.primary} />
              <Text
                style={[styles.emptyText, { color: theme.text, marginTop: 16 }]}
              >
                Loading repositories...
              </Text>
            </View>
          ) : error ? (
            <View style={styles.emptyState}>
              <Text style={[styles.emptyText, { color: theme.text }]}>
                Error loading repositories
              </Text>
              <Text
                style={[styles.emptySubtext, { color: theme.textSecondary }]}
              >
                {error}
              </Text>
              <Pressable
                style={[styles.retryButton, { backgroundColor: theme.primary }]}
                onPress={handleRefresh}
              >
                {/*<RefreshCw width={16} height={16} color="white" />*/}
                <Text style={styles.retryButtonText}>Retry</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Text style={[styles.emptyText, { color: theme.text }]}>
                No repositories found
              </Text>
              <Text
                style={[styles.emptySubtext, { color: theme.textSecondary }]}
              >
                Connect your GitHub account to see your repositories
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <Pressable
            style={[
              styles.repoItem,
              { backgroundColor: theme.card, borderColor: theme.border },
            ]}
            onPress={() => openRepo(item)}
          >
            <View style={styles.repoHeader}>
              <Text style={[styles.repoName, { color: theme.text }]}>
                {item.name}
              </Text>
              {/*<ExternalLink width={16} height={16} color={theme.textSecondary} />*/}
            </View>
            {item.description && (
              <Text
                style={[styles.repoDescription, { color: theme.textSecondary }]}
                numberOfLines={2}
              >
                {item.description}
              </Text>
            )}
            <View style={styles.repoFooter}>
              {item.language && (
                <View style={styles.languageBadge}>
                  <View
                    style={[
                      styles.languageDot,
                      {
                        backgroundColor: getLanguageColor(
                          item.language,
                          palette,
                          theme
                        ),
                      },
                    ]}
                  />
                  <Text
                    style={[
                      styles.languageText,
                      { color: theme.textSecondary },
                    ]}
                  >
                    {item.language}
                  </Text>
                </View>
              )}
              <View style={styles.stat}>
                <Text style={[styles.statText, { color: theme.textSecondary }]}>
                  ★ {item.stargazers_count}
                </Text>
              </View>
            </View>
          </Pressable>
        )}
      />
    </SharedPluginScreen>
  );
}

function getLanguageColor(
  language: string,
  palette: ThemePalette,
  theme: ThemeColors
): string {
  const colors: Record<string, string> = {
    TypeScript: palette.blue,
    JavaScript: palette.yellow,
    Python: palette.green,
    Go: palette.cyan,
    Rust: palette.orange,
    Java: palette.red,
    "C++": palette.purple,
    Swift: palette.magenta,
  };
  return colors[language] || theme.textSecondary;
}

const styles = StyleSheet.create({
  listContent: {
    padding: 16,
    gap: 12,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: "500",
  },
  emptySubtext: {
    fontSize: 14,
    marginTop: 8,
    textAlign: "center",
  },
  repoItem: {
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
  },
  repoHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  repoName: {
    fontSize: 16,
    fontWeight: "600",
  },
  repoDescription: {
    fontSize: 14,
    marginBottom: 12,
  },
  repoFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  languageBadge: {
    flexDirection: "row",
    alignItems: "center",
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
    flexDirection: "row",
    alignItems: "center",
  },
  statText: {
    fontSize: 12,
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 16,
  },
  retryButtonText: {
    color: "white",
    fontSize: 14,
    fontWeight: "600",
  },
});
