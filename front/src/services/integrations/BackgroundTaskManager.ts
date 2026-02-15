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
import { getBackgroundTask } from '../../plugins/clientRegistry';
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
    return getBackgroundTask(provider);
}

export function defineAllBackgroundTasks(): void {
    console.log('[BackgroundTaskManager] Defining all background tasks at module level...');
    registerClientPlugins();
    
    const providers = ['gmail', 'calendar', 'github', 'ios_calendar', 'ios_reminders', 'ios_contacts'];
    
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

        console.log(`[BackgroundTaskManager] Registered background task for ${provider}`);
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
        const integrationsWithBackgroundTasks = integrations.filter(
            integration => {
                const metadata = getIntegrationMetadata(integration.provider);
                return integration.enabled && 
                       metadata?.supportsBackgroundTasks === true &&
                       metadata?.storageType === 'client';
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

export function initializeSystemEventListeners(): void {
    AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
        if (nextAppState === 'active') {
            systemEventListener.triggerEvent('app_lifecycle', { state: 'active' });
        } else if (nextAppState === 'background') {
            systemEventListener.triggerEvent('app_lifecycle', { state: 'background' });
        }
    });
    
    console.log('[BackgroundTaskManager] System event listeners initialized');
}

export async function registerSystemEventListeners(integrationId: string, provider: string): Promise<void> {
    const metadata = getIntegrationMetadata(provider);
    if (!metadata || !metadata.supportsBackgroundTasks) {
        return;
    }
    
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
            // Обработчик уже зарегистрирован глобально
        }
    }
}
