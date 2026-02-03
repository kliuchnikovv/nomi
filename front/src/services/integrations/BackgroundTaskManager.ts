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
    interval?: number; // Интервал в секундах (по умолчанию 15 минут)
    enabled: boolean;
}

// Реестр активных фоновых задач
const activeTasks = new Map<string, BackgroundTaskConfig>();

// Имена задач для TaskManager
const TASK_NAME_PREFIX = 'integration-background-';

/**
 * Получить имя задачи для провайдера
 */
function getTaskName(provider: string): string {
    return `${TASK_NAME_PREFIX}${provider}`;
}

/**
 * Получить функцию фоновой задачи для провайдера (из плагинов или fallback).
 */
function getBackgroundTaskForProvider(provider: string): ((integrationId: string) => Promise<void>) | undefined {
    registerClientPlugins();
    return getBackgroundTask(provider);
}

/**
 * Define all background tasks at module level.
 * CRITICAL: In React Native/Expo, TaskManager.defineTask MUST be called at the top level,
 * not dynamically during runtime. This function should be called once when the app starts.
 */
export function defineAllBackgroundTasks(): void {
    console.log('[BackgroundTaskManager] Defining all background tasks at module level...');
    
    // Register client plugins first to ensure handlers are available
    registerClientPlugins();
    
    // Define tasks for all possible providers that support background tasks
    const providers = ['gmail', 'calendar']; // Add more as needed
    
    for (const provider of providers) {
        const taskName = getTaskName(provider);
        
        // Check if already defined to avoid duplicate definitions
        if (TaskManager.isTaskDefined(taskName)) {
            console.log(`[BackgroundTaskManager] Task ${taskName} already defined, skipping...`);
            continue;
        }
        
        // Define the task at module level
        TaskManager.defineTask(taskName, async ({ data, error }: any) => {
            if (error) {
                console.error(`[BackgroundTaskManager] Background task error for ${provider}:`, error);
                return BackgroundFetch.BackgroundFetchResult.Failed;
            }
            
            try {
                console.log(`[BackgroundTaskManager] Executing background task for ${provider}`);
                
                // Get the integration ID from active tasks
                const config = activeTasks.get(provider);
                if (!config) {
                    console.warn(`[BackgroundTaskManager] No active config for ${provider}, skipping...`);
                    return BackgroundFetch.BackgroundFetchResult.NoData;
                }
                
                const taskFunction = getBackgroundTaskForProvider(provider);
                if (!taskFunction) {
                    console.warn(`[BackgroundTaskManager] No background task function for ${provider}`);
                    return BackgroundFetch.BackgroundFetchResult.NoData;
                }
                
                await taskFunction(config.integrationId);
                return BackgroundFetch.BackgroundFetchResult.NewData;
            } catch (error) {
                console.error(`[BackgroundTaskManager] Background task failed for ${provider}:`, error);
                return BackgroundFetch.BackgroundFetchResult.Failed;
            }
        });
        
        console.log(`[BackgroundTaskManager] Defined background task: ${taskName}`);
    }
    
    console.log('[BackgroundTaskManager] All background tasks defined');
}

/**
 * Регистрировать фоновую задачу для интеграции
 */
export async function registerBackgroundTask(config: BackgroundTaskConfig): Promise<void> {
    const { provider, integrationId, interval = 15 * 60 } = config; // По умолчанию 15 минут
    const taskName = getTaskName(provider);
    
    // Проверяем метаданные интеграции
    const metadata = getIntegrationMetadata(provider);
    if (!metadata || !metadata.supportsBackgroundTasks) {
        console.warn(`[BackgroundTaskManager] Provider ${provider} does not support background tasks`);
        return;
    }
    
    const taskFunction = getBackgroundTaskForProvider(provider);
    if (!taskFunction) {
        console.warn(`[BackgroundTaskManager] No background task function for provider ${provider}`);
        return;
    }

    // Verify the task is defined (should be defined at module level via defineAllBackgroundTasks)
    if (!TaskManager.isTaskDefined(taskName)) {
        console.error(`[BackgroundTaskManager] Task ${taskName} is not defined! Call defineAllBackgroundTasks() at app startup.`);
        return;
    }
    
    // Регистрируем задачу в BackgroundFetch
    try {
        const isRegistered = await TaskManager.isTaskRegisteredAsync(taskName);
        if (isRegistered) {
            console.log(`[BackgroundTaskManager] Task ${taskName} already registered`);
            activeTasks.set(provider, config);
            return;
        }
        
        // Store config before registering (the background task will read from activeTasks)
        activeTasks.set(provider, config);
        
        await BackgroundFetch.registerTaskAsync(taskName, {
            minimumInterval: interval,
            stopOnTerminate: false, // Продолжать после закрытия приложения (iOS частично поддерживает)
            startOnBoot: true,      // Android: запускать при загрузке системы
        });
        
        console.log(`[BackgroundTaskManager] Registered background task for ${provider} (interval: ${interval}s)`);
    } catch (error) {
        console.error(`[BackgroundTaskManager] Failed to register task for ${provider}:`, error);
        throw error;
    }
}

/**
 * Отменить регистрацию фоновой задачи.
 * Вызываем нативный unregister только для задач, зарегистрированных в этой сессии (в activeTasks),
 * чтобы избежать краша в EXTaskService при unregister неизвестной задачи.
 */
export async function unregisterBackgroundTask(provider: string): Promise<void> {
    const taskName = getTaskName(provider);

    if (!activeTasks.has(provider)) {
        // Не регистрировали в этой сессии — не вызываем нативный unregister (избегаем краша)
        return;
    }

    try {
        const isRegistered = await TaskManager.isTaskRegisteredAsync(taskName);
        if (!isRegistered) {
            activeTasks.delete(provider);
            return;
        }

        await BackgroundFetch.unregisterTaskAsync(taskName);
        console.log(`[BackgroundTaskManager] Unregistered background task for ${provider}`);
    } catch (error) {
        // Не пробрасываем: нативный EXTaskService может бросить исключение при unregister,
        // что приводит к SIGABRT. Логируем и продолжаем.
        console.warn(`[BackgroundTaskManager] Failed to unregister task for ${provider}:`, error);
    } finally {
        activeTasks.delete(provider);
    }
}

/**
 * Инициализировать фоновые задачи для всех активных интеграций
 */
export async function initializeBackgroundTasks(): Promise<void> {
    console.log('[BackgroundTaskManager] Initializing background tasks...');
    
    try {
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
            
            // Определяем интервал из метаданных или используем значение по умолчанию
            const interval = 15 * 60; // 15 минут по умолчанию
            
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

/**
 * Остановить все фоновые задачи
 */
export async function stopAllBackgroundTasks(): Promise<void> {
    console.log('[BackgroundTaskManager] Stopping all background tasks...');
    
    const providers = Array.from(activeTasks.keys());
    for (const provider of providers) {
        await unregisterBackgroundTask(provider);
    }
    
    console.log('[BackgroundTaskManager] All background tasks stopped');
}

/**
 * Обновить фоновые задачи при изменении состояния интеграций
 */
export async function refreshBackgroundTasks(): Promise<void> {
    console.log('[BackgroundTaskManager] Refreshing background tasks...');
    
    // Останавливаем все текущие задачи
    await stopAllBackgroundTasks();
    
    // Инициализируем заново на основе текущего состояния
    await initializeBackgroundTasks();
}

/**
 * Обработчик системных событий (push-уведомления, lifecycle events)
 */
export class SystemEventListener {
    private listeners: Map<string, Set<(data?: any) => Promise<void>>> = new Map();
    
    /**
     * Зарегистрировать обработчик системного события
     */
    registerListener(eventType: string, handler: (data?: any) => Promise<void>): void {
        if (!this.listeners.has(eventType)) {
            this.listeners.set(eventType, new Set());
        }
        this.listeners.get(eventType)!.add(handler);
        console.log(`[BackgroundTaskManager] Registered listener for ${eventType}`);
    }
    
    /**
     * Отменить регистрацию обработчика
     */
    unregisterListener(eventType: string, handler: (data?: any) => Promise<void>): void {
        const handlers = this.listeners.get(eventType);
        if (handlers) {
            handlers.delete(handler);
            if (handlers.size === 0) {
                this.listeners.delete(eventType);
            }
        }
    }
    
    /**
     * Вызвать обработчики для события
     */
    async triggerEvent(eventType: string, data?: any): Promise<void> {
        const handlers = this.listeners.get(eventType);
        if (!handlers || handlers.size === 0) {
            return;
        }
        
        console.log(`[BackgroundTaskManager] Triggering event ${eventType} for ${handlers.size} handlers`);
        
        // Конвертируем Set в массив для итерации
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

// Глобальный экземпляр обработчика системных событий
export const systemEventListener = new SystemEventListener();

/**
 * Инициализировать обработчики системных событий
 */
export function initializeSystemEventListeners(): void {
    // Обработчик изменений состояния приложения (foreground/background)
    AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
        if (nextAppState === 'active') {
            // Приложение стало активным - можно запустить синхронизацию
            systemEventListener.triggerEvent('app_lifecycle', { state: 'active' });
        } else if (nextAppState === 'background') {
            // Приложение ушло в фон
            systemEventListener.triggerEvent('app_lifecycle', { state: 'background' });
        }
    });
    
    console.log('[BackgroundTaskManager] System event listeners initialized');
}

/**
 * Зарегистрировать обработчики системных событий для интеграции
 */
export async function registerSystemEventListeners(integrationId: string, provider: string): Promise<void> {
    const metadata = getIntegrationMetadata(provider);
    if (!metadata || !metadata.supportsBackgroundTasks) {
        return;
    }
    
    for (const eventType of metadata.systemEventListeners) {
        if (eventType === 'push_notifications') {
            // Регистрируем обработчик push-уведомлений
            systemEventListener.registerListener('push_notifications', async () => {
                console.log(`[BackgroundTaskManager] Push notification received for ${provider}`);
                const taskFunction = getBackgroundTaskForProvider(provider);
                if (taskFunction) {
                    await taskFunction(integrationId);
                }
            });
        } else if (eventType === 'app_lifecycle') {
            // Обработчик уже зарегистрирован глобально
            // Можно добавить специфичную логику для интеграции
        }
    }
}
