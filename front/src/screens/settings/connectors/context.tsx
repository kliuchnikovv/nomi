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
import { pluginsApi, authStore } from '../../../apiClient.ts';
import { OAUTH_CALLBACK_URL, getApiUrl } from '../../../config.ts';
import { initDatabase } from '../../../services/database/database';
import { integrationStorage, Integration as LocalIntegration } from '../../../services/integrations/IntegrationStorage';

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
    const [pendingCode, setPendingCode] = useState<string | null>(null);
    const [authStatus, setAuthStatus] = useState<string | null>(null);
    const [dbReady, setDbReady] = useState(false);
    const lastHandledUrl = useRef<string | null>(null);

    // Initialize database on mount
    useEffect(() => {
        initDatabase()
            .then(() => {
                console.log('[ConnectorsProvider] Database initialized');
                setDbReady(true);
            })
            .catch(e => {
                console.error('[ConnectorsProvider] Failed to initialize database:', e);
            });
    }, []);

    // Load integrations once database is ready
    useEffect(() => {
        if (dbReady) {
            getIntegrations();
        }
    }, [dbReady]);

    async function getTools() {
        await getIntegrations();
    }

    const getIntegrations = React.useCallback(async () => {
        if (!dbReady) return;

        try {
            // Load from local SQLite
            const localIntegrations = await integrationStorage.getIntegrations();

            const normalized: Integration[] = localIntegrations.map(p => ({
                id: p.id,
                name: p.name,
                provider: p.provider,
                connected: p.enabled,
                params: { account_email: p.accountEmail },
            }));

            setConfigs(normalized);
            setTools(normalized.map(p => ({
                id: p.id,
                name: p.name,
                provider: p.provider,
                enabled: p.connected,
            })));

            console.log(`[ConnectorsProvider] Loaded ${normalized.length} integrations from local storage`);
        } catch (e) {
            console.warn('Failed to load integrations', e);
            setConfigs([]);
            setTools([]);
        }
    }, [dbReady]);

    const handleOAuthUrl = React.useCallback(async (url: string) => {
        if (!url || !url.startsWith(OAUTH_CALLBACK_URL)) return;
        if (lastHandledUrl.current === url) return;
        lastHandledUrl.current = url;

        try {
            const parsed = new URL(url);
            const provider = parsed.searchParams.get('provider');
            const status = parsed.searchParams.get('status');
            const code = parsed.searchParams.get('code');
            const email = parsed.searchParams.get('email');
            const accountEmail = parsed.searchParams.get('account_email');

            if (provider && pendingProvider && provider !== pendingProvider) {
                return;
            }

            // If we got a code, exchange it for tokens using mobile endpoint
            if (code && provider) {
                await exchangeCodeForTokens(provider, code);
                return;
            }

            // Legacy flow: backend already handled tokens
            if (status === 'ok' && provider) {
                const labelEmail = accountEmail || email;
                setAuthStatus(`Connected ${provider}${labelEmail ? ` (${labelEmail})` : ''}`);
                await getIntegrations();
            } else {
                setAuthStatus(`OAuth failed${provider ? ` for ${provider}` : ''}`);
            }
        } finally {
            setPendingProvider(null);
            setPendingCode(null);
            await getIntegrations();
        }
    }, [pendingProvider, getIntegrations]);

    /**
     * Exchange OAuth code for tokens and save locally
     */
    const exchangeCodeForTokens = async (provider: string, code: string) => {
        try {
            console.log(`[ConnectorsProvider] Exchanging code for tokens (${provider})...`);

            const apiUrl = getApiUrl();
            const token = authStore.getToken();
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
            };
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }

            const response = await fetch(`${apiUrl}/oauth/${provider}/callback-mobile`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ code }),
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.error || 'Token exchange failed');
            }

            const data = await response.json();

            // Save integration and credentials locally
            await integrationStorage.createIntegration({
                provider: data.provider as LocalIntegration['provider'],
                name: `${data.provider.charAt(0).toUpperCase() + data.provider.slice(1)} (${data.account_email})`,
                enabled: true,
                accountEmail: data.account_email,
            }, {
                accessToken: data.access_token,
                refreshToken: data.refresh_token,
                tokenExpiry: new Date(data.token_expiry * 1000),
            });

            console.log(`[ConnectorsProvider] Integration saved locally: ${data.account_email}`);
            setAuthStatus(`Connected ${provider} (${data.account_email})`);

            await getIntegrations();
        } catch (e) {
            console.error('[ConnectorsProvider] Token exchange failed:', e);
            setAuthStatus(`Failed to connect ${provider}`);
            throw e;
        }
    };

    useEffect(() => {
        const subscription = Linking.addEventListener('url', ({ url }) => handleOAuthUrl(url));
        Linking.getInitialURL().then(initialUrl => {
            if (initialUrl) {
                handleOAuthUrl(initialUrl);
            }
        }).catch(() => { });

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
            // Update in local storage
            await integrationStorage.updateIntegration(integration.id, { enabled });
            await getIntegrations();
        } catch (e) {
            console.warn('Failed to update integration', e);
        }
    }

    const deleteIntegration = React.useCallback(async (id: string) => {
        try {
            // Delete from local storage
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
        <ConnectorsContext.Provider
            value={value}
        >
            {children}
        </ConnectorsContext.Provider>
    );
}
