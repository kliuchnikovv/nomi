/**
 * Реестр интеграций для Frontend.
 * 
 * Содержит UI метаданные и конфигурацию для всех доступных интеграций.
 */

export type StorageType = 'client' | 'server' | 'hybrid';

export interface IntegrationMetadata {
    id: string;
    name: string;
    displayName: string;
    description: string;
    icon: string;
    storageType: StorageType;
    supportsBackgroundTasks: boolean;
    systemEventListeners: string[];
    authType: 'oauth2' | 'api_key' | 'none';
    category?: string;
}

/**
 * Реестр всех доступных интеграций с их метаданными.
 */
export const INTEGRATION_REGISTRY: Record<string, IntegrationMetadata> = {
    gmail: {
        id: 'gmail',
        name: 'gmail',
        displayName: 'Gmail',
        description: 'Gmail интеграция для работы с почтой',
        icon: 'gmail',
        storageType: 'client',
        supportsBackgroundTasks: true,
        systemEventListeners: ['push_notifications', 'app_lifecycle'],
        authType: 'oauth2',
        category: 'email',
    },
    calendar: {
        id: 'calendar',
        name: 'calendar',
        displayName: 'Google Calendar',
        description: 'Google Calendar интеграция для работы с календарем',
        icon: 'calendar',
        storageType: 'client',
        supportsBackgroundTasks: true,
        systemEventListeners: ['push_notifications', 'app_lifecycle'],
        authType: 'oauth2',
        category: 'calendar',
    },
    github: {
        id: 'github',
        name: 'github',
        displayName: 'GitHub',
        description: 'GitHub интеграция для работы с репозиториями',
        icon: 'github',
        storageType: 'server',
        supportsBackgroundTasks: false,
        systemEventListeners: [],
        authType: 'oauth2',
        category: 'development',
    },
    jules: {
        id: 'jules',
        name: 'jules',
        displayName: 'Jules',
        description: 'Jules API интеграция для автоматизации задач',
        icon: 'jules',
        storageType: 'server',
        supportsBackgroundTasks: false,
        systemEventListeners: [],
        authType: 'api_key',
        category: 'automation',
    },
};

/**
 * Получить метаданные интеграции по ID.
 */
export function getIntegrationMetadata(id: string): IntegrationMetadata | undefined {
    return INTEGRATION_REGISTRY[id.toLowerCase()];
}

/**
 * Получить все клиентские интеграции (ClientOnly).
 */
export function getClientOnlyIntegrations(): IntegrationMetadata[] {
    return Object.values(INTEGRATION_REGISTRY).filter(
        (integration) => integration.storageType === 'client'
    );
}

/**
 * Получить все серверные интеграции.
 */
export function getServerIntegrations(): IntegrationMetadata[] {
    return Object.values(INTEGRATION_REGISTRY).filter(
        (integration) => integration.storageType === 'server'
    );
}

/**
 * Получить все интеграции, поддерживающие фоновые задачи.
 */
export function getIntegrationsWithBackgroundTasks(): IntegrationMetadata[] {
    return Object.values(INTEGRATION_REGISTRY).filter(
        (integration) => integration.supportsBackgroundTasks
    );
}

/**
 * Проверить, является ли интеграция клиентской.
 */
export function isClientOnly(integrationId: string): boolean {
    const metadata = getIntegrationMetadata(integrationId);
    return metadata?.storageType === 'client' || false;
}

/**
 * Проверить, является ли интеграция серверной.
 */
export function isServer(integrationId: string): boolean {
    const metadata = getIntegrationMetadata(integrationId);
    return metadata?.storageType === 'server' || false;
}

/**
 * Проверить, поддерживает ли интеграция фоновые задачи.
 */
export function supportsBackgroundTasks(integrationId: string): boolean {
    const metadata = getIntegrationMetadata(integrationId);
    return metadata?.supportsBackgroundTasks ?? false;
}

/**
 * Получить все доступные интеграции.
 */
export function getAllIntegrations(): IntegrationMetadata[] {
    return Object.values(INTEGRATION_REGISTRY);
}

/**
 * Получить интеграции по категории.
 */
export function getIntegrationsByCategory(category: string): IntegrationMetadata[] {
    return Object.values(INTEGRATION_REGISTRY).filter(
        (integration) => integration.category === category
    );
}
