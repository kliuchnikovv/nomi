import React, {
    createContext,
    useContext,
    ReactNode,
    useState,
    useEffect,
    useRef,
    useCallback,
} from 'react';
import { Linking } from 'react-native';
import InAppBrowser from 'react-native-inappbrowser-reborn';
import { v4 as uuidv4 } from 'uuid';

import { ConnectorContextType, Tool, Integration } from './models';
import apiClient from '../../../apiClient';
import { integrationStorage } from '../../../services/integrations/IntegrationStorage';
import { migrationService } from '../../../services/migration/migrationService';
import { OAUTH_CALLBACK_URL } from '../../../config';

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
    const [pendingProvider, setPendingProvider] = useState<string | null>(null);
    const [authStatus, setAuthStatus] = useState<string | null>(null);
    const lastHandledUrl = useRef<string | null>(null);

    useEffect(() => {
        // Run migration once on mount
        migrationService.migrateFromBackend().then(() => {
            getIntegrations();
        });
    }, []);

    const getIntegrations = useCallback(async () => {
        try {
            const localIntegrations = await integrationStorage.getIntegrations();

            // Map local storage format to UI model
            const uiIntegrations: Integration[] = localIntegrations.map(local => ({
                id: local.id,
                name: local.name,
                provider: local.provider,
                connected: local.enabled,
                info: {
                    name: local.name,
                    title: local.name,
                    // Map other fields if needed
                },
                state: local.enabled ? 'connected' : 'disabled',
                params: {
                    account_email: local.accountEmail
                }
            }));

            setConfigs(uiIntegrations);
            setTools(uiIntegrations.map(p => ({
                id: p.id,
                name: p.name,
                provider: p.provider,
                enabled: p.connected,
                info: p.info,
                state: p.state,
            })));
        } catch (e) {
            console.warn('Failed to load integrations', e);
            setConfigs([]);
            setTools([]);
        }
    }, []);

    const getTools = async () => {
        await getIntegrations();
    }

    const handleOAuthUrl = useCallback(async (url: string) => {
        if (!url) return;
        if (lastHandledUrl.current === url) return;
        lastHandledUrl.current = url;

        try {
            const parsed = new URL(url);
            const code = parsed.searchParams.get('code');
            const error = parsed.searchParams.get('error');

            if (error) {
                setAuthStatus(`OAuth failed: ${error}`);
                return;
            }

            let provider = pendingProvider;
            if (!provider) {
                if (url.includes('google') || url.includes('gmail')) provider = 'gmail';
                else if (url.includes('github')) provider = 'github';
            }

            if (code && provider) {
                const tokenResponse = await apiClient.post(`/oauth/${provider}/callback-mobile`, { code });
                const data = tokenResponse.data;

                await integrationStorage.createIntegration({
                    id: uuidv4(),
                    provider: data.provider || provider,
                    name: `${data.provider} (${data.account_email || 'Connected'})`,
                    enabled: true,
                    accountEmail: data.account_email,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                }, {
                    accessToken: data.access_token,
                    refreshToken: data.refresh_token,
                    tokenExpiry: new Date(data.token_expiry * 1000),
                });

                setAuthStatus(`Connected ${provider}`);
                await getIntegrations();
            }
        } catch (e) {
            console.error('OAuth callback handling failed', e);
            setAuthStatus('OAuth failed');
        } finally {
            setPendingProvider(null);
        }
    }, [pendingProvider, getIntegrations]);

    useEffect(() => {
        const subscription = Linking.addEventListener('url', ({ url }) => handleOAuthUrl(url));
        Linking.getInitialURL().then(initialUrl => {
            if (initialUrl) {
                handleOAuthUrl(initialUrl);
            }
        }).catch(() => {});

        return () => {
            subscription.remove();
        };
    }, [handleOAuthUrl]);

    const openOAuthFlow = useCallback(async (authUrl: string) => {
        try {
            const isAvailable = await InAppBrowser.isAvailable();
            if (isAvailable) {
                const result = await InAppBrowser.openAuth(authUrl, OAUTH_CALLBACK_URL, {
                    ephemeralWebSession: false,
                    dismissButtonStyle: 'close',
                    showTitle: false,
                    enableDefaultShare: false,
                });

                if (result.type === 'success' && result.url) {
                    await handleOAuthUrl(result.url);
                }
                return;
            }
        } catch (e) {
            console.warn('InAppBrowser failed, falling back to Linking', e);
        }

        await Linking.openURL(authUrl);
    }, [handleOAuthUrl]);

    const startOAuth = useCallback(async (provider: string) => {
        try {
            setPendingProvider(provider);
            const response = await apiClient.post(`/oauth/${provider}/login`);
            const redirectUrl = response.data.url;

            if (redirectUrl) {
                await openOAuthFlow(redirectUrl);
            }
        } catch (authError) {
            console.warn('Failed to start OAuth login', authError);
            setPendingProvider(null);
            setAuthStatus('Failed to start OAuth login');
        }
    }, [openOAuthFlow]);

    async function toggleTool(configID: string, enabled: boolean) {
        try {
             let integration = await integrationStorage.getIntegration(configID);
             if (!integration) {
                 const list = await integrationStorage.getIntegrations();
                 integration = list.find(i => i.provider === configID || i.id === configID);
             }

             if (integration) {
                 await integrationStorage.updateIntegration(integration.id, { enabled });
                 await getIntegrations();
             }
        } catch (e) {
            console.warn('Failed to update integration', e);
        }
    }

    const deleteIntegration = useCallback(async (id: string) => {
        try {
            await integrationStorage.deleteIntegration(id);
            await getIntegrations();
        } catch (e) {
            console.warn('Failed to delete integration', e);
        }
    }, [getIntegrations]);

    const value: ConnectorContextType = {
        tools,
        integrations: configs,
        getTools,
        getIntegrations,
        toggleTool,
        startOAuth,
        deleteIntegration,
    };

    return (
        <ConnectorsContext.Provider value={value}>
            {children}
        </ConnectorsContext.Provider>
    );
}
