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
import { pluginsApi } from '../../../apiClient.ts';
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
            const response = await pluginsApi.list();
            const normalized: Integration[] = (response || []).map(p => ({
                id: p.name,
                name: (p.info && (p.info.title || p.info.name)) || p.name,
                provider: p.name,
                connected: !!p.enabled,
                info: p.info,
                state: p.state,
            }));
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
            console.warn('Failed to load plugins', e);
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
            if (provider && pendingProvider && provider !== pendingProvider) {
                return;
            }
            if (status === 'ok' && provider) {
                setAuthStatus(`Connected ${provider}${email ? ` (${email})` : ''}`);
                await pluginsApi.enablePlugin(provider).catch(err => console.warn('Failed to enable plugin after OAuth', err));
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

    async function openOAuthFlow(authUrl: string) {
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
    }

    async function toggleTool(configID: string, enabled: boolean) {
        const integration = configs.find(c => c.id === configID || c.provider === configID);
        if (!integration) {
            console.warn(`Integration not found for ID: ${configID}`);
            return;
        }

        if (enabled) {
            // Connect
            try {
                if (['gmail', 'calendar'].includes(integration.provider)) {
                    try {
                        setPendingProvider(integration.provider);
                        const redirectUrl = await pluginsApi.startOAuthLogin(integration.provider);
                        if (redirectUrl) {
                            await openOAuthFlow(redirectUrl);
                        }
                    } catch (authError) {
                        console.warn('Failed to start OAuth login', authError);
                        setPendingProvider(null);
                        setAuthStatus('Failed to start OAuth login');
                        return;
                    }
                } else {
                    await pluginsApi.enablePlugin(integration.provider);
                    await getIntegrations();
                }
            } catch (e) {
                console.warn('Failed to connect integration', e);
            }
        } else {
            console.log('Disconnecting integration', integration);
            console.log('Available tools', tools);

            try {
                await pluginsApi.disablePlugin(integration.provider);
                await getIntegrations();
            } catch (e) {
                console.warn('Failed to disable plugin', e);
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
