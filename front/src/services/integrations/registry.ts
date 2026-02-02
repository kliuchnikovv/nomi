/**
 * Реестр интеграций для Frontend.
 * Источник: plugins/registry.generated.ts (из манифестов плагинов).
 */

import type { IntegrationMetadata } from '../../plugins/registry.generated';
import { INTEGRATION_REGISTRY as REGISTRY } from '../../plugins/registry.generated';

export type { IntegrationMetadata, StorageType } from '../../plugins/registry.generated';
export const INTEGRATION_REGISTRY = REGISTRY;

/**
 * Получить метаданные интеграции по ID.
 */
export function getIntegrationMetadata(id: string): IntegrationMetadata | undefined {
    return REGISTRY[id.toLowerCase()];
}

/**
 * Получить все клиентские интеграции (ClientOnly).
 */
export function getClientOnlyIntegrations() {
    return Object.values(REGISTRY).filter(
        (integration) => integration.storageType === 'client'
    );
}

/**
 * Получить все серверные интеграции.
 */
export function getServerIntegrations() {
    return Object.values(REGISTRY).filter(
        (integration) => integration.storageType === 'server'
    );
}

/**
 * Получить все интеграции, поддерживающие фоновые задачи.
 */
export function getIntegrationsWithBackgroundTasks() {
    return Object.values(REGISTRY).filter(
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
export function getAllIntegrations() {
    return Object.values(REGISTRY);
}

/**
 * Получить интеграции по категории.
 */
export function getIntegrationsByCategory(category: string) {
    return Object.values(REGISTRY).filter(
        (integration) => integration.category === category
    );
}
