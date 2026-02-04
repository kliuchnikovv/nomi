import { credentialsApi } from '../apiClient';

/**
 * CredentialsManager - управление API ключами и credentials для серверных плагинов.
 * 
 * Основная логика:
 * - Проверяет наличие credentials в Redis (через /api/credentials/:provider/check)
 * - Отправляет credentials только если их нет (через /api/credentials)
 * - Автоматически обновляет TTL при каждом использовании
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
     * Сохранить credentials на сервере (Redis с TTL 1 час)
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
     * Проверить наличие credentials на сервере
     * Кеширует результат на 5 минут
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
     * Проверить несколько провайдеров сразу
     * Возвращает список тех, у кого нет credentials
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
     * Удалить credentials с сервера
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
     * Получить список всех провайдеров с credentials
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
     * Убедиться, что credentials существуют - отправить если нужно
     * Используется перед отправкой сообщения на сервер
     */
    async ensureCredentials(config: CredentialConfig): Promise<boolean> {
        // Сначала проверяем, есть ли уже
        const exists = await this.checkCredentials(config.provider);
        if (exists) {
            console.log(`[CredentialsManager] Credentials for ${config.provider} already exist on server`);
            return true;
        }

        // Если нет - отправляем
        console.log(`[CredentialsManager] Credentials for ${config.provider} not found, sending...`);
        return await this.saveCredentials(config);
    }

    /**
     * Проверить кеш
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
     * Очистить кеш для провайдера
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
