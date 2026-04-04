/**
 * Integration registry for Frontend.
 * Source: plugins/registry.generated.ts (from plugin manifests).
 */

import type { IntegrationMetadata } from '../../plugins/registry.generated';
import { INTEGRATION_REGISTRY as REGISTRY } from '../../plugins/registry.generated';

export type { IntegrationMetadata, StorageType } from '../../plugins/registry.generated';
export const INTEGRATION_REGISTRY = REGISTRY;

/**
 * Get integration metadata by ID.
 */
export function getIntegrationMetadata(id: string): IntegrationMetadata | undefined {
    return REGISTRY[id.toLowerCase()];
}

/**
 * Get all client-only integrations.
 */
export function getClientOnlyIntegrations() {
    return Object.values(REGISTRY).filter(
        (integration) => integration.storageType === 'client'
    );
}

/**
 * Get all server integrations.
 */
export function getServerIntegrations() {
    return Object.values(REGISTRY).filter(
        (integration) => integration.storageType === 'server' || integration.storageType === 'hybrid'
    );
}

/**
 * Check if an integration is client-only.
 */
export function isClientOnly(integrationId: string): boolean {
    const metadata = getIntegrationMetadata(integrationId);
    return metadata?.storageType === 'client' || false;
}

/**
 * Get all integrations that support background tasks.
 */
export function getIntegrationsWithBackgroundTasks() {
    return Object.values(REGISTRY).filter(
        (integration) => integration.supportsBackgroundTasks
    );
}

/**
 * Check if an integration is server-side (server or hybrid).
 */
export function isServer(integrationId: string): boolean {
    const metadata = getIntegrationMetadata(integrationId);
    return metadata?.storageType === 'server' || metadata?.storageType === 'hybrid' || false;
}

/**
 * Check if an integration supports background tasks.
 */
export function supportsBackgroundTasks(integrationId: string): boolean {
    const metadata = getIntegrationMetadata(integrationId);
    return metadata?.supportsBackgroundTasks ?? false;
}

/**
 * Get all available integrations.
 */
export function getAllIntegrations() {
    return Object.values(REGISTRY);
}

/**
 * Get integrations by category.
 */
export function getIntegrationsByCategory(category: string) {
    return Object.values(REGISTRY).filter(
        (integration) => integration.category === category
    );
}
