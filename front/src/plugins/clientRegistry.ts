/**
 * Registry of client-side plugin handlers.
 * Plugins register via registerClientPlugin; ClientToolExecutor uses getHandler to dispatch.
 */

import { ClientPluginHandler } from './types';
import { registerChatElement } from './chatElementRegistry';
import { registerWidget } from './widgetRegistry';

export type { ClientPluginHandler } from './types';

const handlers = new Map<string, ClientPluginHandler>();

export function registerClientPlugin(
    name: string,
    handler: ClientPluginHandler,
): void {
    handlers.set(name.toLowerCase(), handler);

    // Auto-register chat elements provided by this plugin
    if (handler.chatElements) {
        for (const el of handler.chatElements) {
            registerChatElement(el);
        }
    }

    // Auto-register widgets provided by this plugin
    if (handler.widgets) {
        for (const w of handler.widgets) {
            registerWidget(w);
        }
    }
}

export function getClientPluginHandler(
    name: string,
): ClientPluginHandler | undefined {
    const nameLower = name.toLowerCase();

    // Try exact match first
    if (handlers.has(nameLower)) {
        return handlers.get(nameLower);
    }

    // Try prefix match (e.g. "gmail (bob@example.com)" -> "gmail")
    // Sort by length desc to match longest prefix first
    const keys = Array.from(handlers.keys()).sort(
        (a, b) => b.length - a.length,
    );
    for (const key of keys) {
        if (nameLower.startsWith(key)) {
            return handlers.get(key);
        }
    }

    return undefined;
}

export function getClientPlugin(name: string): ClientPluginHandler | undefined {
    return handlers.get(name.toLowerCase());
}

export function getBackgroundTask(
    provider: string,
): ((integrationId: string) => Promise<void>) | undefined {
    const handler = handlers.get(provider.toLowerCase());
    return handler?.backgroundTask;
}

export function getRegisteredClientPluginNames(): string[] {
    return Array.from(handlers.keys());
}
