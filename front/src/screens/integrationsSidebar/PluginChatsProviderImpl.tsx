import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { View } from 'react-native';
import { Plugin, PluginChat } from './models';
import { PluginChatsContext } from './context';
import { integrationStorage } from '../../services/integrations/IntegrationStorage';
import { getAllIntegrations } from '../../services/integrations/registry';
import { INTEGRATION_REGISTRY } from '../../plugins/registry.generated';
import { getClientPlugin } from '../../plugins/clientRegistry';

export const PluginChatsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [plugins, setPlugins] = useState<Plugin[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadPlugins = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);

            // Load enabled integrations from local database
            const enabledIntegrations = await integrationStorage.getIntegrations();
            console.log('[PluginChatsProvider] Loading enabled integrations:', enabledIntegrations.length);

            // Get client-only providers from registry for filtering
            const clientOnlyProviders = getAllIntegrations().filter(
                (integration) => integration.storageType !== 'server'
            ).map(i => i.id);

            // Filter enabled integrations to only include client-only ones
            const clientIntegrations = enabledIntegrations.filter(
                (integration) => clientOnlyProviders.includes(integration.provider)
            );

            // Transform integrations to plugins format
            const loadedPlugins: Plugin[] = clientIntegrations.map((integration) => {
                const metadata = INTEGRATION_REGISTRY[integration.provider.toLowerCase()];
                const clientPlugin = getClientPlugin(integration.provider);
                console.log('[PluginChatsProvider] Loading plugin:', integration.id, integration.provider, integration.name);
                return {
                    id: integration.id,
                    provider: integration.provider,
                    name: integration.name,
                    icon: metadata?.icon,
                    color: metadata?.color,
                    chats: [],
                    // Add metadata for additional plugin info
                    metadata: {
                        ...metadata,
                        accountEmail: integration.accountEmail,
                        hasSidebar: !!clientPlugin?.SidebarComponent,
                        hasMainScreen: !!clientPlugin?.MainComponent,
                    },
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
    }, []);

    useEffect(() => {
        loadPlugins();
    }, [loadPlugins]);

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
        refresh: loadPlugins,
        loadMoreForPlugin: async () => { },
        hasMoreForPlugin: () => false,
        loadingMorePlugins: new Set<string>(),
    }), [plugins, loading, error, loadPlugins]);

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
