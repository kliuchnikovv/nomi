/**
 * BackgroundTaskManager - Управление фоновыми процессами для клиентских интеграций.
 * 
 * Автоматически регистрирует и управляет фоновыми задачами на основе реестра интеграций.
 * Поддерживает периодические задачи и обработку системных событий.
 */

import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, AppStateStatus } from 'react-native';
import { integrationStorage } from './IntegrationStorage';
import { getIntegrationMetadata } from './registry';
import { getBackgroundTask, getRegisteredClientPluginNames } from '../../plugins/clientRegistry';
import { registerClientPlugins } from '../../plugins/registerClientPlugins';
import { setAuthToken } from '../../apiClient';

// Типы для фоновых задач
export interface BackgroundTaskConfig {
    integrationId: string;
    provider: string;
    interval?: number;
    enabled: boolean;
}

// Реестр активных фоновых задач (один провайдер может иметь несколько аккаунтов)
const activeTasks = new Map<string, BackgroundTaskConfig[]>();

// Имена задач для TaskManager
const TASK_NAME_PREFIX = 'integration-background-';

function getTaskName(provider: string): string {
    return `${TASK_NAME_PREFIX}${provider}`;
}

/**
 * Load auth token from AsyncStorage and wire it into apiClient.
 * Required when background tasks run outside the React lifecycle.
 */
async function bootstrapAuthForBackground(): Promise<void> {
    const token = await AsyncStorage.getItem('token');
    setAuthToken(token);
}

function getBackgroundTaskForProvider(provider: string): ((integrationId: string) => Promise<void>) | undefined {
    registerClientPlugins();
    const task = getBackgroundTask(provider);
    console.log(`[BackgroundTaskManager] getBackgroundTaskForProvider(${provider}): ${task ? 'FOUND' : 'NOT FOUND'}`);
    return task;
}

export function defineAllBackgroundTasks(): void {
    console.log('[BackgroundTaskManager] =========================================');
    console.log('[BackgroundTaskManager] 📱 Defining all background tasks at module level...');
    console.log('[BackgroundTaskManager] =========================================');
    registerClientPlugins();

    // Get providers dynamically from registered client plugins
    const providers = getRegisteredClientPluginNames();
    console.log(`[BackgroundTaskManager] 📋 Found ${providers.length} registered plugins: ${providers.join(', ')}`);

    for (const provider of providers) {
        const taskName = getTaskName(provider);

        if (TaskManager.isTaskDefined(taskName)) {
            console.log(`[BackgroundTaskManager] ⏭️ Task ${taskName} already defined, skipping`);
            continue;
        }

        console.log(`[BackgroundTaskManager] 📝 Defining background task: ${taskName} for provider: ${provider}`);

        TaskManager.defineTask(taskName, async ({ data: _data, error }: any) => {
            console.log(`[BackgroundTaskManager] =========================================`);
            console.log(`[BackgroundTaskManager] 🚀 BACKGROUND TASK EXECUTED: ${provider}`);
            console.log(`[BackgroundTaskManager] =========================================`);

            if (error) {
                console.error(`[BackgroundTaskManager] ❌ Background task error for ${provider}:`, error);
                return;
            }

            try {
                await bootstrapAuthForBackground();

                console.log(`[BackgroundTaskManager] 🔍 Looking up configs for ${provider}...`);
                const configs = activeTasks.get(provider);
                if (!configs || configs.length === 0) {
                    console.warn(`[BackgroundTaskManager] ⚠️ No active configs for ${provider}, skipping...`);
                    return;
                }
                console.log(`[BackgroundTaskManager] ✅ Found ${configs.length} account(s) for ${provider}`);

                console.log(`[BackgroundTaskManager] 🔍 Getting background task function for ${provider}...`);
                const taskFunction = getBackgroundTaskForProvider(provider);
                if (!taskFunction) {
                    console.warn(`[BackgroundTaskManager] ⚠️ No background task function for ${provider}`);
                    return;
                }

                for (const config of configs) {
                    console.log(`[BackgroundTaskManager] ✅ Calling task for integrationId: ${config.integrationId}`);
                    await taskFunction(config.integrationId);
                    console.log(`[BackgroundTaskManager] ✅ Background task completed for ${config.integrationId}`);
                }
            } catch (err) {
                console.error(`[BackgroundTaskManager] ❌ Background task failed for ${provider}:`, err);
            }
        });

        console.log(`[BackgroundTaskManager] ✅ Defined background task: ${taskName}`);
    }

    console.log('[BackgroundTaskManager] =========================================');
    console.log('[BackgroundTaskManager] ✅ All background tasks defined');
    console.log('[BackgroundTaskManager] =========================================');
}

export async function registerBackgroundTask(config: BackgroundTaskConfig): Promise<void> {
    const { provider, interval = 15 * 60 } = config;
    const taskName = getTaskName(provider);
    
    const metadata = getIntegrationMetadata(provider);
    if (!metadata || !metadata.supportsBackgroundTasks) {
        console.warn(`[BackgroundTaskManager] Provider ${provider} does not support background tasks`);
        return;
    }
    
    const taskFunction = getBackgroundTaskForProvider(provider);
    if (!taskFunction) {
        console.warn(`[BackgroundTaskManager] No background task function for ${provider}`);
        return;
    }
    
    const existing = activeTasks.get(provider) ?? [];
    const idx = existing.findIndex(c => c.integrationId === config.integrationId);
    if (idx >= 0) {
        existing[idx] = config;
    } else {
        existing.push(config);
    }
    activeTasks.set(provider, existing);

    try {
        const isRegistered = await TaskManager.isTaskRegisteredAsync(taskName);
        if (isRegistered) {
            console.log(`[BackgroundTaskManager] Task ${taskName} already registered, updated config for ${config.integrationId}`);
            return;
        }

        await BackgroundFetch.registerTaskAsync(taskName, {
            minimumInterval: interval,
            stopOnTerminate: false,
            startOnBoot: true,
        });

        console.log(`[BackgroundTaskManager] ✓ Registered background task for ${provider} (${taskName}) with interval ${interval}s`);
    } catch (error) {
        console.error(`[BackgroundTaskManager] Failed to register task for ${provider}:`, error);
    }
}

export async function unregisterBackgroundTask(provider: string, integrationId?: string): Promise<void> {
    const taskName = getTaskName(provider);

    if (!activeTasks.has(provider)) {
        console.log(`[BackgroundTaskManager] Task ${taskName} not in active tasks, skipping unregister`);
        return;
    }

    if (integrationId) {
        // Remove only this account; keep BackgroundFetch task if others remain
        const remaining = (activeTasks.get(provider) ?? []).filter(c => c.integrationId !== integrationId);
        if (remaining.length > 0) {
            activeTasks.set(provider, remaining);
            console.log(`[BackgroundTaskManager] Removed integrationId=${integrationId} from ${provider}, ${remaining.length} account(s) remaining`);
            return;
        }
        // Last account removed — fall through to full unregister
    }

    // Delete FIRST — before any await — so a concurrent call sees has()=false and exits immediately,
    // preventing the double-unregister race that causes a native E_TASK_NOT_FOUND crash.
    activeTasks.delete(provider);

    try {
        const isRegistered = await TaskManager.isTaskRegisteredAsync(taskName);
        if (!isRegistered) {
            console.log(`[BackgroundTaskManager] Task ${taskName} not registered, skipping unregister`);
            return;
        }

        await BackgroundFetch.unregisterTaskAsync(taskName);
        console.log(`[BackgroundTaskManager] Unregistered background task for ${provider}`);
    } catch (error) {
        console.error(`[BackgroundTaskManager] Failed to unregister task ${provider}:`, error);
    }
}

export function getActiveTaskConfig(provider: string): BackgroundTaskConfig | undefined {
    return activeTasks.get(provider)?.[0];
}

export function isActive(provider: string): boolean {
    return (activeTasks.get(provider)?.length ?? 0) > 0;
}

/**
 * Manually trigger a background task for testing purposes.
 * This can be called from a debug screen or console to test background task execution.
 */
export async function manuallyTriggerBackgroundTask(provider: string): Promise<void> {
    console.log(`[BackgroundTaskManager] =========================================`);
    console.log(`[BackgroundTaskManager] 🧪 MANUALLY TRIGGERING: ${provider}`);
    console.log(`[BackgroundTaskManager] =========================================`);

    const configs = activeTasks.get(provider);
    if (!configs || configs.length === 0) {
        console.warn(`[BackgroundTaskManager] ❌ No active configs for ${provider}`);
        return;
    }

    const taskFunction = getBackgroundTaskForProvider(provider);
    if (!taskFunction) {
        console.warn(`[BackgroundTaskManager] ❌ No background task function for ${provider}`);
        return;
    }

    try {
        await bootstrapAuthForBackground();
        for (const config of configs) {
            console.log(`[BackgroundTaskManager] 🧪 Running manual task for integrationId: ${config.integrationId}`);
            await taskFunction(config.integrationId);
        }
        console.log(`[BackgroundTaskManager] ✅ Manual task completed for ${provider} (${configs.length} account(s))`);
    } catch (err) {
        console.error(`[BackgroundTaskManager] ❌ Manual task failed for ${provider}:`, err);
    }
}

async function cleanupOrphanedTasks(): Promise<void> {
    console.log('[BackgroundTaskManager] Cleaning up orphaned tasks...');

    try {
        const tasks = await TaskManager.getRegisteredTasksAsync();
        console.log(`[BackgroundTaskManager] Found ${tasks.length} registered tasks`);

        const ourTasks = tasks.filter(task => task.taskName.startsWith(TASK_NAME_PREFIX));
        console.log(`[BackgroundTaskManager] Found ${ourTasks.length} tasks with our prefix`);

        for (const task of ourTasks) {
            try {
                // Re-check registration status before unregistering — a concurrent call may have
                // already unregistered this task, and calling unregisterTaskAsync on an unknown
                // task throws a native NSException that JS try-catch cannot intercept.
                const isStillRegistered = await TaskManager.isTaskRegisteredAsync(task.taskName);
                if (!isStillRegistered) {
                    console.log(`[BackgroundTaskManager] Orphaned task ${task.taskName} already unregistered, skipping`);
                    continue;
                }
                console.log(`[BackgroundTaskManager] Attempting to unregister orphaned task: ${task.taskName}`);
                await BackgroundFetch.unregisterTaskAsync(task.taskName);
                console.log(`[BackgroundTaskManager] Successfully unregistered orphaned task: ${task.taskName}`);
            } catch (error: any) {
                console.warn(`[BackgroundTaskManager] Could not unregister orphaned task ${task.taskName}:`, error);
            }
        }

        console.log('[BackgroundTaskManager] Orphaned tasks cleanup complete');
    } catch (error) {
        console.warn('[BackgroundTaskManager] Failed to cleanup orphaned tasks:', error);
    }
}

export async function initializeBackgroundTasks(): Promise<void> {
    console.log('[BackgroundTaskManager] =========================================');
    console.log('[BackgroundTaskManager] 🚀 Initializing background tasks...');
    console.log('[BackgroundTaskManager] =========================================');

    try {
        await cleanupOrphanedTasks();

        const integrations = await integrationStorage.getIntegrations();
        console.log(`[BackgroundTaskManager] 📦 Total integrations: ${integrations.length}`);

        const integrationsWithBackgroundTasks = integrations.filter(
            integration => {
                const metadata = getIntegrationMetadata(integration.provider);
                const supportedTasks = metadata?.supportsBackgroundTasks === true;
                const validStorage = metadata?.storageType === 'client' || metadata?.storageType === 'hybrid';
                const enabled = integration.enabled;

                if (enabled && supportedTasks && validStorage) {
                    console.log(`[BackgroundTaskManager] ✅ ${integration.provider}: enabled=${enabled}, supportsTasks=${supportedTasks}, storageType=${metadata?.storageType}`);
                    return true;
                } else {
                    console.log(`[BackgroundTaskManager] ❌ ${integration.provider}: enabled=${enabled}, supportsTasks=${supportedTasks}, storageType=${metadata?.storageType}`);
                    return false;
                }
            }
        );

        console.log(`[BackgroundTaskManager] 📋 Found ${integrationsWithBackgroundTasks.length} integrations with background tasks`);

        for (const integration of integrationsWithBackgroundTasks) {
            const metadata = getIntegrationMetadata(integration.provider);
            if (!metadata) continue;

            const interval = 15 * 60;
            console.log(`[BackgroundTaskManager] 📝 Registering task for ${integration.provider} (${integration.id})...`);

            await registerBackgroundTask({
                integrationId: integration.id,
                provider: integration.provider,
                interval,
                enabled: integration.enabled,
            });
        }

        console.log('[BackgroundTaskManager] =========================================');
        console.log('[BackgroundTaskManager] ✅ Background tasks initialized');
        console.log('[BackgroundTaskManager] =========================================');
    } catch (error) {
        console.error('[BackgroundTaskManager] ❌ Failed to initialize background tasks:', error);
    }
}

// Global mutex: prevents concurrent refreshes that would race in cleanupOrphanedTasks
// and unregisterBackgroundTask, causing native E_TASK_NOT_FOUND crashes.
let isRefreshing = false;

export async function refreshBackgroundTasks(): Promise<void> {
    if (isRefreshing) {
        console.log('[BackgroundTaskManager] Refresh already in progress, skipping concurrent call');
        return;
    }
    isRefreshing = true;
    console.log('[BackgroundTaskManager] Refreshing background tasks...');
    try {
        await stopAllBackgroundTasks();
        await initializeBackgroundTasks();
    } finally {
        isRefreshing = false;
    }
}

export async function stopAllBackgroundTasks(): Promise<void> {
    console.log('[BackgroundTaskManager] Stopping all background tasks...');
    
    const providers = Array.from(activeTasks.keys());
    for (const provider of providers) {
        await unregisterBackgroundTask(provider);
    }
    
    console.log('[BackgroundTaskManager] All background tasks stopped');
}

export class SystemEventListener {
    private listeners: Map<string, Set<(data?: any) => Promise<void>>> = new Map();
    // Track registered providers to prevent duplicate handler registration
    private registeredProviders: Set<string> = new Set();
    
    registerListener(eventType: string, handler: (data?: any) => Promise<void>): void {
        if (!this.listeners.has(eventType)) {
            this.listeners.set(eventType, new Set());
        }
        this.listeners.get(eventType)!.add(handler);
        console.log(`[BackgroundTaskManager] Registered listener for ${eventType}`);
    }
    
    unregisterListener(eventType: string, handler: (data?: any) => Promise<void>): void {
        const handlers = this.listeners.get(eventType);
        if (handlers) {
            handlers.delete(handler);
            if (handlers.size === 0) {
                this.listeners.delete(eventType);
            }
        }
    }

    clearAllListeners(): void {
        this.listeners.clear();
        this.registeredProviders.clear();
        console.log('[BackgroundTaskManager] All event listeners cleared');
    }

    isProviderRegistered(provider: string): boolean {
        return this.registeredProviders.has(provider);
    }

    markProviderRegistered(provider: string): void {
        this.registeredProviders.add(provider);
    }

    unmarkProvider(provider: string): void {
        this.registeredProviders.delete(provider);
    }
    
    async triggerEvent(eventType: string, data?: any): Promise<void> {
        const handlers = this.listeners.get(eventType);
        if (!handlers || handlers.size === 0) {
            return;
        }
        
        console.log(`[BackgroundTaskManager] Triggering event ${eventType} for ${handlers.size} handlers`);
        
        const handlersArray = Array.from(handlers);
        for (const handler of handlersArray) {
            try {
                await handler(data);
            } catch (error) {
                console.error(`[BackgroundTaskManager] Handler failed for ${eventType}:`, error);
            }
        }
    }
}

export const systemEventListener = new SystemEventListener();

// Guard: ensure AppState listener is registered only once
let appStateListenerInitialized = false;
let appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;

export function initializeSystemEventListeners(): void {
    if (appStateListenerInitialized) {
        console.log('[BackgroundTaskManager] System event listeners already initialized, skipping');
        return;
    }
    appStateListenerInitialized = true;

    appStateSubscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
        if (nextAppState === 'active') {
            systemEventListener.triggerEvent('app_lifecycle', { state: 'active' });
        } else if (nextAppState === 'background') {
            systemEventListener.triggerEvent('app_lifecycle', { state: 'background' });
        }
    });
    
    console.log('[BackgroundTaskManager] System event listeners initialized');
}

/**
 * Remove the global AppState listener. Call on logout or cleanup.
 */
export function cleanupSystemEventListeners(): void {
    if (appStateSubscription) {
        appStateSubscription.remove();
        appStateSubscription = null;
    }
    appStateListenerInitialized = false;
    systemEventListener.clearAllListeners();
    console.log('[BackgroundTaskManager] System event listeners cleaned up');
}

export async function registerSystemEventListeners(integrationId: string, provider: string): Promise<void> {
    const metadata = getIntegrationMetadata(provider);
    if (!metadata || !metadata.supportsBackgroundTasks) {
        return;
    }

    // Skip if this provider's listeners are already registered
    if (systemEventListener.isProviderRegistered(provider)) {
        return;
    }
    systemEventListener.markProviderRegistered(provider);
    
    for (const eventType of metadata.systemEventListeners) {
        if (eventType === 'push_notifications') {
            systemEventListener.registerListener('push_notifications', async () => {
                console.log(`[BackgroundTaskManager] Push notification received for ${provider}`);
                const taskFunction = getBackgroundTaskForProvider(provider);
                if (taskFunction) {
                    await taskFunction(integrationId);
                }
            });
        } else if (eventType === 'app_lifecycle') {
            // Handler is already registered globally via initializeSystemEventListeners
        }
    }
}
