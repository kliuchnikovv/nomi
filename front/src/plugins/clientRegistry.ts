/**
 * Registry of client-side plugin handlers.
 * Plugins register via registerClientPlugin; ClientToolExecutor uses getHandler to dispatch.
 */

export interface ClientPluginHandler {
    execute(method: string, params: Record<string, any>): Promise<string>;
    /** Optional: sync/background task for this integration (e.g. sync emails, events). */
    backgroundTask?: (integrationId: string) => Promise<void>;
}

const handlers = new Map<string, ClientPluginHandler>();

export function registerClientPlugin(name: string, handler: ClientPluginHandler): void {
    handlers.set(name.toLowerCase(), handler);
}

export function getClientPluginHandler(name: string): ClientPluginHandler | undefined {
    return handlers.get(name.toLowerCase());
}

export function getBackgroundTask(provider: string): ((integrationId: string) => Promise<void>) | undefined {
    const handler = handlers.get(provider.toLowerCase());
    return handler?.backgroundTask;
}

export function getRegisteredClientPluginNames(): string[] {
    return Array.from(handlers.keys());
}
