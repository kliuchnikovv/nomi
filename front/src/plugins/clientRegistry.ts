/**
 * Registry of client-side plugin handlers.
 * Plugins register via registerClientPlugin; ClientToolExecutor uses getHandler to dispatch.
 */

import React from 'react';

export interface ClientPluginHandler {
    execute(method: string, params: Record<string, any>): Promise<string>;
    /** Optional: sync/background task for this integration (e.g. sync emails, events). */
    backgroundTask?: (integrationId: string) => Promise<void>;
    /** Optional: Full-screen component to show when plugin is selected. */
    MainComponent?: React.ComponentType<any>;
    /** Optional: Sidebar item component for this plugin. */
    SidebarComponent?: React.ComponentType<any>;
}

const handlers = new Map<string, ClientPluginHandler>();

export function registerClientPlugin(name: string, handler: ClientPluginHandler): void {
    handlers.set(name.toLowerCase(), handler);
}

export function getClientPluginHandler(name: string): ClientPluginHandler | undefined {
    const nameLower = name.toLowerCase();
    
    // Try exact match first
    if (handlers.has(nameLower)) {
        return handlers.get(nameLower);
    }
    
    // Try prefix match (e.g. "gmail (bob@example.com)" -> "gmail")
    // Sort by length desc to match longest prefix first
    const keys = Array.from(handlers.keys()).sort((a, b) => b.length - a.length);
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

export function getBackgroundTask(provider: string): ((integrationId: string) => Promise<void>) | undefined {
    const handler = handlers.get(provider.toLowerCase());
    return handler?.backgroundTask;
}

export function getRegisteredClientPluginNames(): string[] {
    return Array.from(handlers.keys());
}
