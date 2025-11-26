import React, {
    createContext,
    useContext,
    ReactNode,
    useState,
    useEffect,
} from 'react';
import { Linking } from 'react-native';
import InAppBrowser from 'react-native-inappbrowser-reborn';

import { ConnectorContextType, Tool, Integration, CONNECTORS } from './models';
import { integrationsApi } from '../../../apiClient.ts';
import { OAUTH_CALLBACK_URL } from '../../../config.ts';

const ConnectorsContext = createContext<ConnectorContextType | undefined>(undefined);

export function useConnectors() {
    const context = useContext(ConnectorsContext);
    if (!context) {
        throw new Error('useConnectors must be used within a ConnectorsProvider');
    }
    return context;
}

export function ConnectorsProvider({ children }: { children: ReactNode }) {
    const [tools, setTools] = useState<Tool[]>([])
    const [configs, setConfigs] = useState<Integration[]>([])

    useEffect(() => {
        getTools();
        getIntegrations();
    }, []);

    async function getTools() {
        const response = await integrationsApi.getTools();
        const normalizedTools: Tool[] = (response || []).map((t: any) => ({
            id: t.ID || t.id,
            name: t.Name || t.name,
            provider: t.Provider || t.provider,
            enabled: t.Enabled !== undefined ? t.Enabled : t.enabled,
            created_at: t.CreatedAt || t.created_at,
        }));
        setTools(normalizedTools);
    }

    async function getIntegrations() {
        const response = await integrationsApi.getIntegrations();
        setConfigs(response || []);
    }

    async function openOAuthFlow(authUrl: string) {
        console.log('Opening OAuth flow', authUrl);
        try {
            const isAvailable = await InAppBrowser.isAvailable();
            console.log('InAppBrowser available:', isAvailable);
            if (isAvailable) {
                let result;
                try {
                    result = await InAppBrowser.openAuth(
                        authUrl,
                        OAUTH_CALLBACK_URL,
                        {
                            ephemeralWebSession: false,
                            dismissButtonStyle: 'cancel',
                            showTitle: false,
                            enableDefaultShare: false,
                        },
                    );
                } catch (error: any) {
                    console.warn('First attempt to open InAppBrowser failed', error);
                    if (error.message && error.message.includes('Another InAppBrowser is already being presented')) {
                        console.log('Closing existing InAppBrowser and retrying...');
                        await InAppBrowser.close();
                        result = await InAppBrowser.openAuth(
                            authUrl,
                            OAUTH_CALLBACK_URL,
                            {
                                ephemeralWebSession: false,
                                dismissButtonStyle: 'cancel',
                                showTitle: false,
                                enableDefaultShare: false,
                            },
                        );
                    } else {
                        throw error;
                    }
                }

                console.log('InAppBrowser result:', result);
                if (result.type === 'success' && result.url) {
                    // OAuth callback handled via Linking listener
                    return;
                }
                if (result.type === 'cancel') {
                    console.log('Auth cancelled');
                    return;
                }
            }
        } catch (e) {
            console.warn('Failed to open OAuth flow in InAppBrowser', e);
            console.log('Falling back to Linking.openURL');
            try {
                await Linking.openURL(authUrl);
            } catch (e) {
                console.warn('Failed to open OAuth URL', e);
            }
        }
    }

    async function toggleTool(configID: string, enabled: boolean) {
        const integration = configs.find(c => c.id === configID);
        if (!integration) {
            console.warn(`Integration not found for ID: ${configID}`);
            return;
        }

        if (enabled) {
            // Connect
            try {
                const response = await integrationsApi.connectIntegration(integration.provider);
                if (response?.auth_url) {
                    await openOAuthFlow(response.auth_url);
                }
                // After flow, we expect a redirect back.
                // Ideally we should refresh tools/integrations after coming back.
                // For now, we can just refresh.
                getIntegrations();
                getTools();
            } catch (e) {
                console.warn('Failed to connect integration', e);
            }
        } else {
            // Disconnect
            // Find the tool corresponding to this integration
            // Assuming tool.id is what we need to delete.
            // But wait, toggleTool receives configID (integration ID).
            // We need to find the tool that corresponds to this integration.
            // The new API returns tools. Is there a link?
            // The user prompt says: "List User Tools... Returns the list of tools actually configured".
            // "Delete Tool... DELETE /tools/{id}".
            // We need to know which tool corresponds to the integration.
            // In the new model, Tool has `provider`. Integration has `provider`.
            // So we can match by provider.
            console.log('Disconnecting integration', integration);
            console.log('Available tools', tools);

            let tool = tools.find(t => t.provider === integration.provider);

            if (!tool) {
                // Try to find by name
                tool = tools.find(t => t.name === integration.name);
            }

            if (!tool) {
                // Try to find by mapping via CONNECTORS
                // Find connector that matches integration (by name or provider)
                const connector = CONNECTORS.find(c =>
                    c.name === integration.name ||
                    c.toolKey === integration.provider ||
                    c.id === integration.provider
                );
                if (connector) {
                    tool = tools.find(t => t.provider === connector.toolKey);
                }
            }

            if (tool) {
                try {
                    await integrationsApi.deleteTool(tool.id);
                    await getTools();
                    await getIntegrations();
                } catch (e) {
                    console.warn('Failed to delete tool', e);
                }
            } else {
                console.warn('Tool not found for integration', integration.id);
            }
        }
    }

    const value: ConnectorContextType = {
        tools,
        integrations: configs,
        getTools,
        getIntegrations,
        toggleTool
    };

    return (
        <ConnectorsContext.Provider
            value={value}
        >
            {children}
        </ConnectorsContext.Provider>
    );
}