/**
 * GitHub Repository Cache Service (Client-side)
 * Stores and retrieves cached repository data in SQLite
 */

import { getDatabase } from "@nomi/front/services/database/database";

export interface CachedGitHubRepo {
  id: number;
  integrationId: string;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  language: string | null;
  updated_at: string;
  cachedAt: number;
}

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

class GitHubRepoCache {
  /**
   * Get cached repositories for integration
   */
  async getCachedRepos(integrationId: string): Promise<CachedGitHubRepo[]> {
    const db = getDatabase();
    try {
      const rows = await db.getAllAsync<CachedGitHubRepo>(
        `
        SELECT * FROM github_repos_cache
        WHERE integrationId = ?
        ORDER BY cachedAt DESC
        `,
        [integrationId]
      );

      const now = Date.now();
      // Filter out stale repos
      const validRepos = rows.filter((repo) => {
        const age = now - repo.cachedAt;
        return age <= CACHE_TTL_MS;
      });

      if (validRepos.length > 0 && validRepos.length === rows.length) {
        console.log(
          `[GitHubRepoCache] Returning ${validRepos.length} cached repos for integration ${integrationId}`
        );
        return validRepos;
      } else if (validRepos.length < rows.length) {
        // Some repos are stale, invalidate entire cache
        console.log(
          `[GitHubRepoCache] Cache partially stale, invalidating for integration ${integrationId}`
        );
        await this.invalidateCache(integrationId);
        return [];
      }

      return [];
    } catch (error) {
      console.error("[GitHubRepoCache] Failed to get cached repos:", error);
      return [];
    }
  }

  /**
   * Set cached repositories for integration
   */
  async setCachedRepos(
    integrationId: string,
    repos: any[]
  ): Promise<void> {
    const db = getDatabase();
    try {
      // Clear old cache
      await db.runAsync(
        "DELETE FROM github_repos_cache WHERE integrationId = ?",
        [integrationId]
      );

      // Insert new cache entries
      const now = Date.now();
      for (const repo of repos) {
        await db.runAsync(
          `
          INSERT INTO github_repos_cache (
            id, integrationId, name, full_name, description,
            html_url, stargazers_count, language, updated_at, cachedAt
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            repo.id,
            integrationId,
            repo.name,
            repo.full_name,
            repo.description || null,
            repo.html_url,
            repo.stargazers_count || 0,
            repo.language || null,
            repo.updated_at,
            now,
          ]
        );
      }

      console.log(
        `[GitHubRepoCache] Cached ${repos.length} repos for integration ${integrationId}`
      );
    } catch (error) {
      console.error("[GitHubRepoCache] Failed to set cached repos:", error);
      throw error;
    }
  }

  /**
   * Invalidate cache for integration
   */
  async invalidateCache(integrationId: string): Promise<void> {
    const db = getDatabase();
    try {
      await db.runAsync(
        "DELETE FROM github_repos_cache WHERE integrationId = ?",
        [integrationId]
      );
      console.log(
        `[GitHubRepoCache] Invalidated cache for integration ${integrationId}`
      );
    } catch (error) {
      console.error("[GitHubRepoCache] Failed to invalidate cache:", error);
      throw error;
    }
  }

  /**
   * Clear all cached repos
   */
  async clearAllCache(): Promise<void> {
    const db = getDatabase();
    try {
      await db.runAsync("DELETE FROM github_repos_cache");
      console.log("[GitHubRepoCache] Cleared all cached repos");
    } catch (error) {
      console.error("[GitHubRepoCache] Failed to clear cache:", error);
      throw error;
    }
  }
}

export const gitHubRepoCache = new GitHubRepoCache();
