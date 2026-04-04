import { credentialsApi } from '../apiClient';

/**
 * CredentialsManager - manages API keys and credentials for server plugins.
 * 
 * Core logic:
 * - Checks if credentials exist in Redis (via /api/credentials/:provider/check)
 * - Sends credentials only if they don't exist (via /api/credentials)
 * - Automatically refreshes TTL on each use
 */

export interface CredentialConfig {
    provider: string;
    type: 'api_key' | 'custom';
    apiKey?: string;
    extra?: Record<string, any>;
}

export class CredentialsManager {
    private static instance: CredentialsManager;
    private cachedProviders: Set<string> = new Set();
    private lastCheck: Map<string, number> = new Map();
    private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    static getInstance(): CredentialsManager {
        if (!CredentialsManager.instance) {
            CredentialsManager.instance = new CredentialsManager();
        }
        return CredentialsManager.instance;
    }

    /**
     * Save credentials on the server (Redis with 1-hour TTL)
     */
    async saveCredentials(config: CredentialConfig): Promise<boolean> {
        try {
            const response = await credentialsApi.save(
                config.provider,
                config.type,
                config.apiKey,
                config.extra
            );
            if (response?.ok) {
                this.cachedProviders.add(config.provider);
                this.lastCheck.set(config.provider, Date.now());
                console.log(`[CredentialsManager] Saved credentials for ${config.provider}`);
                return true;
            }
            return false;
        } catch (error) {
            console.error(`[CredentialsManager] Failed to save credentials for ${config.provider}:`, error);
            return false;
        }
    }

    /**
     * Check if credentials exist on the server.
     * Caches the result for 5 minutes.
     */
    async checkCredentials(provider: string, force = false): Promise<boolean> {
        // Check cache
        if (!force && this.isCached(provider)) {
            return true;
        }

        try {
            const response = await credentialsApi.check(provider);
            const exists = response?.exists ?? false;
            
            if (exists) {
                this.cachedProviders.add(provider);
                this.lastCheck.set(provider, Date.now());
            } else {
                this.cachedProviders.delete(provider);
            }
            
            return exists;
        } catch (error) {
            console.error(`[CredentialsManager] Failed to check credentials for ${provider}:`, error);
            return false;
        }
    }

    /**
     * Check multiple providers at once.
     * Returns a list of those that don't have credentials.
     */
    async checkMultipleProviders(providers: string[]): Promise<string[]> {
        try {
            const response = await credentialsApi.request(providers);
            if (response?.ok) {
                // Update cache for existing providers
                providers.forEach(p => {
                    if (!response.missing?.includes(p)) {
                        this.cachedProviders.add(p);
                        this.lastCheck.set(p, Date.now());
                    } else {
                        this.cachedProviders.delete(p);
                    }
                });
                return response.missing || [];
            }
            return providers;
        } catch (error) {
            console.error('[CredentialsManager] Failed to check multiple providers:', error);
            return providers;
        }
    }

    /**
     * Delete credentials from the server
     */
    async deleteCredentials(provider: string): Promise<boolean> {
        try {
            const response = await credentialsApi.delete(provider);
            if (response?.ok) {
                this.cachedProviders.delete(provider);
                this.lastCheck.delete(provider);
                console.log(`[CredentialsManager] Deleted credentials for ${provider}`);
                return true;
            }
            return false;
        } catch (error) {
            console.error(`[CredentialsManager] Failed to delete credentials for ${provider}:`, error);
            return false;
        }
    }

    /**
     * Get a list of all providers with credentials
     */
    async listProviders(): Promise<string[]> {
        try {
            const response = await credentialsApi.list();
            return response?.providers || [];
        } catch (error) {
            console.error('[CredentialsManager] Failed to list providers:', error);
            return [];
        }
    }

    /**
     * Ensure credentials exist — send if needed.
     * Used before sending a message to the server.
     */
    async ensureCredentials(config: CredentialConfig): Promise<boolean> {
        // First check if they already exist
        const exists = await this.checkCredentials(config.provider);
        if (exists) {
            console.log(`[CredentialsManager] Credentials for ${config.provider} already exist on server`);
            return true;
        }

        // If not — send them
        console.log(`[CredentialsManager] Credentials for ${config.provider} not found, sending...`);
        return await this.saveCredentials(config);
    }

    /**
     * Check cache
     */
    private isCached(provider: string): boolean {
        if (!this.cachedProviders.has(provider)) {
            return false;
        }

        const lastCheckTime = this.lastCheck.get(provider);
        if (!lastCheckTime) {
            return false;
        }

        // Check if cache is still valid
        return Date.now() - lastCheckTime < this.CACHE_TTL;
    }

    /**
     * Clear cache for a provider
     */
    invalidateCache(provider?: string) {
        if (provider) {
            this.cachedProviders.delete(provider);
            this.lastCheck.delete(provider);
        } else {
            this.cachedProviders.clear();
            this.lastCheck.clear();
        }
    }
}

export const credentialsManager = CredentialsManager.getInstance();
