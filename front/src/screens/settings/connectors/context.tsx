import React, {
    createContext,
    useContext,
    ReactNode,
    useState,
    useEffect,
    useRef,
} from 'react';
import { Linking } from 'react-native';
import InAppBrowser from 'react-native-inappbrowser-reborn';

import { ConnectorContextType, Tool, Integration } from './models';
import { integrationsApi, pluginsApi } from '../../../apiClient.ts';
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
    const [pendingProvider, setPendingProvider] = useState<string | null>(null);
    const [authStatus, setAuthStatus] = useState<string | null>(null);
    const lastHandledUrl = useRef<string | null>(null);

    useEffect(() => {
        getIntegrations();
    }, [getIntegrations]);

    async function getTools() {
        // For backward compatibility: tools mirror the plugins list
        await getIntegrations();
    }

    const getIntegrations = React.useCallback(async () => {
        try {
            const response = await integrationsApi.list();
            const items = Array.isArray(response) ? response : (response?.items || []);
            const normalized: Integration[] = (items || []).map(p => {
                const parsedParams = (() => {
                    if (!p?.params) return undefined;
                    if (typeof p.params === 'object') return p.params;
                    try {
                        return JSON.parse(String(p.params));
                    } catch {
                        return undefined;
                    }
                })();
                const provider = p.provider || p.name;
                const integrationId = p.id;
                const displayName =
                    (p.info && (p.info.title || p.info.name)) ||
                    p.name ||
                    parsedParams?.account_email ||
                    provider;

                return {
                    id: integrationId,
                    name: displayName,
                    provider,
                    connected: !!p.enabled,
                    info: p.info,
                    state: p.state,
                    params: parsedParams,
                };
            });
            setConfigs(normalized);
            setTools(normalized.map(p => ({
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

    const handleOAuthUrl = React.useCallback(async (url: string) => {
        if (!url || !url.startsWith(OAUTH_CALLBACK_URL)) return;
        if (lastHandledUrl.current === url) return;
        lastHandledUrl.current = url;
        try {
            const parsed = new URL(url);
            const provider = parsed.searchParams.get('provider');
            const status = parsed.searchParams.get('status');
            const email = parsed.searchParams.get('email');
            const accountEmail = parsed.searchParams.get('account_email');
            if (provider && pendingProvider && provider !== pendingProvider) {
                return;
            }
            if (status === 'ok' && provider) {
                const labelEmail = accountEmail || email;
                setAuthStatus(`Connected ${provider}${labelEmail ? ` (${labelEmail})` : ''}`);
                await getIntegrations();
            } else {
                setAuthStatus(`OAuth failed${provider ? ` for ${provider}` : ''}`);
            }
        } finally {
            setPendingProvider(null);
            await getIntegrations();
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

    const openOAuthFlow = React.useCallback(async (authUrl: string) => {
        console.log('Opening OAuth flow', authUrl);
        try {
            const isAvailable = await InAppBrowser.isAvailable();
            console.log('InAppBrowser available:', isAvailable);
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
                if (result.type === 'cancel') {
                    setAuthStatus('OAuth flow cancelled');
                    setPendingProvider(null);
                }
                return;
            }
        } catch (e) {
            console.warn('Failed to open OAuth flow in InAppBrowser', e);
            console.log('Falling back to Linking.openURL');
            try {
                await Linking.openURL(authUrl);
            } catch (err) {
                console.warn('Failed to open OAuth URL', err);
            }
        }
    }, [handleOAuthUrl]);

    const startOAuth = React.useCallback(async (provider: string) => {
        try {
            setPendingProvider(provider);
            const redirectUrl = await pluginsApi.startOAuthLogin(provider);
            if (redirectUrl) {
                await openOAuthFlow(redirectUrl);
            }
        } catch (authError) {
            console.warn('Failed to start OAuth login', authError);
            setPendingProvider(null);
            setAuthStatus('Failed to start OAuth login');
            throw authError;
        }
    }, [openOAuthFlow]);

    async function toggleTool(configID: string, enabled: boolean) {
        const integration = configs.find(c => c.id === configID || c.provider === configID);
        if (!integration) {
            console.warn(`Integration not found for ID: ${configID}`);
            return;
        }

        try {
            await integrationsApi.update(integration.id, { enabled });
            await getIntegrations();
        } catch (e) {
            console.warn('Failed to update integration', e);
        }
    }

    const deleteIntegration = React.useCallback(async (id: string) => {
        try {
            await integrationsApi.delete(id);
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
        <ConnectorsContext.Provider
            value={value}
        >
            {children}
        </ConnectorsContext.Provider>
    );
}
