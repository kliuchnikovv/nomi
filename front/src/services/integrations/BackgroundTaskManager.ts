/**
 * BackgroundTaskManager - Управление фоновыми процессами для клиентских интеграций.
 * 
 * Автоматически регистрирует и управляет фоновыми задачами на основе реестра интеграций.
 * Поддерживает периодические задачи и обработку системных событий.
 */

import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import { AppState, AppStateStatus } from 'react-native';
import { integrationStorage } from './IntegrationStorage';
import { getIntegrationMetadata } from './registry';
import { getBackgroundTask, getRegisteredClientPluginNames } from '../../plugins/clientRegistry';
import { registerClientPlugins } from '../../plugins/registerClientPlugins';

// Типы для фоновых задач
export interface BackgroundTaskConfig {
    integrationId: string;
    provider: string;
    interval?: number;
    enabled: boolean;
}

// Реестр активных фоновых задач
const activeTasks = new Map<string, BackgroundTaskConfig>();

// Имена задач для TaskManager
const TASK_NAME_PREFIX = 'integration-background-';

function getTaskName(provider: string): string {
    return `${TASK_NAME_PREFIX}${provider}`;
}

function getBackgroundTaskForProvider(provider: string): ((integrationId: string) => Promise<void>) | undefined {
    registerClientPlugins();
    const task = getBackgroundTask(provider);
    console.log(`[BackgroundTaskManager] getBackgroundTaskForProvider(${provider}): ${task ? 'FOUND' : 'NOT FOUND'}`);
    return task;
}

export function defineAllBackgroundTasks(): void {
    console.log('[BackgroundTaskManager] Defining all background tasks at module level...');
    registerClientPlugins();

    // Get providers dynamically from registered client plugins
    const providers = getRegisteredClientPluginNames();
    console.log(`[BackgroundTaskManager] Found ${providers.length} registered plugins: ${providers.join(', ')}`);

    for (const provider of providers) {
        const taskName = getTaskName(provider);

        if (TaskManager.isTaskDefined(taskName)) {
            console.log(`[BackgroundTaskManager] Task ${taskName} already defined, skipping`);
            continue;
        }

        TaskManager.defineTask(taskName, async ({ data: _data, error }: any) => {
            if (error) {
                console.error(`[BackgroundTaskManager] Background task error for ${provider}:`, error);
                return;
            }

            try {
                console.log(`[BackgroundTaskManager] Executing background task for ${provider}`);

                const config = activeTasks.get(provider);
                if (!config) {
                    console.warn(`[BackgroundTaskManager] No active config for ${provider}, skipping...`);
                    return;
                }

                const taskFunction = getBackgroundTaskForProvider(provider);
                if (!taskFunction) {
                    console.warn(`[BackgroundTaskManager] No background task function for ${provider}`);
                    return;
                }

                await taskFunction(config.integrationId);
            } catch (err) {
                console.error(`[BackgroundTaskManager] Background task failed for ${provider}:`, err);
            }
        });

        console.log(`[BackgroundTaskManager] Defined background task: ${taskName}`);
    }

    console.log('[BackgroundTaskManager] All background tasks defined');
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
    
    activeTasks.set(provider, config);

    try {
        const isRegistered = await TaskManager.isTaskRegisteredAsync(taskName);
        if (isRegistered) {
            console.log(`[BackgroundTaskManager] Task ${taskName} already registered`);
            activeTasks.set(provider, config);
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

export async function unregisterBackgroundTask(provider: string): Promise<void> {
    const taskName = getTaskName(provider);
    
    if (!activeTasks.has(provider)) {
        console.log(`[BackgroundTaskManager] Task ${taskName} not in active tasks, skipping unregister`);
        return;
    }

    try {
        const isRegistered = await TaskManager.isTaskRegisteredAsync(taskName);
        if (!isRegistered) {
            console.log(`[BackgroundTaskManager] Task ${taskName} not registered, skipping unregister`);
            activeTasks.delete(provider);
            return;
        }

        await BackgroundFetch.unregisterTaskAsync(taskName);
        console.log(`[BackgroundTaskManager] Unregistered background task for ${provider}`);
    } catch (error) {
        console.error(`[BackgroundTaskManager] Failed to unregister task ${provider}:`, error);
    } finally {
        activeTasks.delete(provider);
    }
}

export function getActiveTaskConfig(provider: string): BackgroundTaskConfig | undefined {
    return activeTasks.get(provider);
}

export function isActive(provider: string): boolean {
    return activeTasks.has(provider);
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
    console.log('[BackgroundTaskManager] Initializing background tasks...');
    
    try {
        await cleanupOrphanedTasks();
        
        const integrations = await integrationStorage.getIntegrations();
        console.log(`[BackgroundTaskManager] Total integrations: ${integrations.length}`);

        const integrationsWithBackgroundTasks = integrations.filter(
            integration => {
                const metadata = getIntegrationMetadata(integration.provider);
                const supportedTasks = metadata?.supportsBackgroundTasks === true;
                const validStorage = metadata?.storageType === 'client' || metadata?.storageType === 'hybrid';
                const enabled = integration.enabled;

                if (enabled && supportedTasks && validStorage) {
                    console.log(`[BackgroundTaskManager] ✓ ${integration.provider}: enabled=${enabled}, supportsTasks=${supportedTasks}, storageType=${metadata?.storageType}`);
                    return true;
                } else {
                    console.log(`[BackgroundTaskManager] ✗ ${integration.provider}: enabled=${enabled}, supportsTasks=${supportedTasks}, storageType=${metadata?.storageType}`);
                    return false;
                }
            }
        );

        console.log(`[BackgroundTaskManager] Found ${integrationsWithBackgroundTasks.length} integrations with background tasks`);
        
        for (const integration of integrationsWithBackgroundTasks) {
            const metadata = getIntegrationMetadata(integration.provider);
            if (!metadata) continue;
            
            const interval = 15 * 60;
            
            await registerBackgroundTask({
                integrationId: integration.id,
                provider: integration.provider,
                interval,
                enabled: integration.enabled,
            });
        }
        
        console.log('[BackgroundTaskManager] Background tasks initialized');
    } catch (error) {
        console.error('[BackgroundTaskManager] Failed to initialize background tasks:', error);
    }
}

export async function refreshBackgroundTasks(): Promise<void> {
    console.log('[BackgroundTaskManager] Refreshing background tasks...');
    
    await stopAllBackgroundTasks();
    await initializeBackgroundTasks();
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
