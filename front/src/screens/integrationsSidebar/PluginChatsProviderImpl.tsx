import React, { useState, useEffect, useMemo } from 'react';
import { View, Text } from 'react-native';
import { Plugin, PluginChat } from './models';
import { PluginChatsContext } from './context';
import { getAllIntegrations } from '../../services/integrations/registry';
import { INTEGRATION_REGISTRY } from '../../plugins/registry.generated';

export const PluginChatsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [plugins, setPlugins] = useState<Plugin[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadPlugins = async () => {
        try {
            setLoading(true);
            setError(null);

            // Load integrations from registry, exclude server-only
            const integrations = getAllIntegrations().filter(
                (integration) => integration.storageType !== 'server'
            );
            console.log('[PluginChatsProvider] Loading integrations:', integrations.length);

            // Transform integrations to plugins format
            const loadedPlugins: Plugin[] = integrations.map((integration) => {
                const metadata = INTEGRATION_REGISTRY[integration.id.toLowerCase()];
                console.log('[PluginChatsProvider] Loading plugin:', integration.id, integration.displayName);
                return {
                    id: integration.id,
                    provider: integration.id,
                    name: integration.displayName,
                    icon: integration.icon,
                    color: metadata?.color,
                    chats: [],
                };
            });

            console.log('[PluginChatsProvider] Loaded plugins:', loadedPlugins.length);
            setPlugins(loadedPlugins);
        } catch (err) {
            console.error('Failed to load plugins:', err);
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadPlugins();
    }, []);

    const value = useMemo(() => ({
        plugins,
        loading,
        refreshing: false,
        error,
        selectedChatId: null,
        selectedChatMessages: [],
        chatLoading: false,
        chatError: null,
        selectChat: async () => null,
        setSelectedChatId: () => { },
        refresh: async () => { await loadPlugins(); },
        loadMoreForPlugin: async () => { },
        hasMoreForPlugin: () => false,
        loadingMorePlugins: new Set<string>(),
    }), [plugins, loading, error]);

    return (
        <PluginChatsContext.Provider value={value}>
            <View style={{ flex: 1 }}>
                {children}
            </View>
        </PluginChatsContext.Provider>
    );
};

// Add legacy export just in case
export const InboxProvider = PluginChatsProvider;
