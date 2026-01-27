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
import * as DatabaseModule from '../../../services/database/database';
import { integrationStorage, Integration as LocalIntegration } from '../../../services/integrations/IntegrationStorage';
import { 
    getIntegrationMetadata, 
    isServer, 
    getServerIntegrations,
    INTEGRATION_REGISTRY 
} from '../../../services/integrations/registry';
import {
    initializeBackgroundTasks,
    refreshBackgroundTasks,
    registerSystemEventListeners,
    initializeSystemEventListeners,
} from '../../../services/integrations/BackgroundTaskManager';

// Safe wrapper for initDatabase that handles edge cases during startup
async function safeInitDatabase(): Promise<void> {
    try {
        if (typeof DatabaseModule.initDatabase === 'function') {
            await DatabaseModule.initDatabase();
        } else {
            console.warn('[ConnectorsProvider] initDatabase not available');
        }
    } catch (e) {
        console.error('[ConnectorsProvider] Failed to init database:', e);
        throw e;
    }
}

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
        safeInitDatabase()
            .then(() => {
                console.log('[ConnectorsProvider] Database initialized');
                setDbReady(true);
            })
            .catch(e => {
                console.error('[ConnectorsProvider] Failed to initialize database:', e);
            });
    }, []);

    // Initialize background tasks and system event listeners
    useEffect(() => {
        if (dbReady) {
            // Инициализируем обработчики системных событий
            initializeSystemEventListeners();
            
            // Инициализируем фоновые задачи для активных интеграций
            initializeBackgroundTasks().catch(e => {
                console.error('[ConnectorsProvider] Failed to initialize background tasks:', e);
            });
        }
    }, [dbReady]);

    // Load integrations once database is ready
    useEffect(() => {
        if (dbReady) {
            getIntegrations();
        }
    }, [dbReady]);

    async function getTools() {
        await getIntegrations();
    }

    const syncFromBackend = React.useCallback(async () => {
        try {
            const apiUrl = getApiUrl();
            const token = authStore.getToken();
            if (!token) return;

            const response = await fetch(`${apiUrl}/integrations`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!response.ok) return;

            const data = await response.json();
            const items: any[] = data.items || data || [];

            // Умная синхронизация: синхронизируем только серверные интеграции
            // Клиентские интеграции загружаются только из локального SQLite
            for (const item of items) {
                // Проверяем через реестр, является ли это серверной интеграцией
                if (!isServer(item.provider)) {
                    console.log(`[ConnectorsProvider] Skipping client-only integration: ${item.provider} (stored locally)`);
                    continue;
                }

                // Серверные интеграции синхронизируются для отображения метаданных
                // Но токены не синхронизируются (они остаются на сервере)
                console.log(`[ConnectorsProvider] Server integration found: ${item.provider} (metadata only)`);
                
                // Можно добавить логику для синхронизации метаданных серверных интеграций
                // если это необходимо для UI
            }
        } catch (e) {
            console.warn('Failed to sync from backend', e);
        }
    }, []);

    const getIntegrations = React.useCallback(async () => {
        if (!dbReady) return;

        try {
            // First sync from backend
            await syncFromBackend();

            // Load from local SQLite
            const localIntegrations = await integrationStorage.getIntegrations();

            const normalized: Integration[] = [];
            const toolsList: Tool[] = [];

            for (const p of localIntegrations) {
                // Получаем метаданные из реестра
                const metadata = getIntegrationMetadata(p.provider);
                
                // Fetch credentials
                const creds = await integrationStorage.getCredentials(p.id);
                const params: any = { account_email: p.accountEmail };

                if (creds) {
                    if (p.provider === 'jules') {
                        params.api_key = creds.accessToken;
                    } else if (p.provider === 'github') {
                        params.access_token = creds.accessToken;
                    }
                }

                // Добавляем метаданные из реестра
                normalized.push({
                    id: p.id,
                    name: p.name,
                    provider: p.provider,
                    connected: p.enabled,
                    storageType: metadata?.storageType,
                    supportsBackgroundTasks: metadata?.supportsBackgroundTasks,
                    systemEventListeners: metadata?.systemEventListeners,
                    params: params,
                });

                toolsList.push({
                    id: p.id,
                    name: p.name,
                    provider: p.provider,
                    enabled: p.enabled,
                    params: params,
                });
            }

            setConfigs(normalized);
            setTools(toolsList);

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

            // Получаем метаданные из реестра
            const metadata = getIntegrationMetadata(data.provider);
            const displayName = metadata?.displayName || data.provider.charAt(0).toUpperCase() + data.provider.slice(1);

            // Save integration and credentials locally
            // Для клиентских интеграций сохраняем метаданные из реестра
            await integrationStorage.createIntegration({
                provider: data.provider as LocalIntegration['provider'],
                name: `${displayName} (${data.account_email})`,
                enabled: true,
                accountEmail: data.account_email,
                storageType: metadata?.storageType,
                supportsBackgroundTasks: metadata?.supportsBackgroundTasks,
                systemEventListeners: metadata?.systemEventListeners,
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
            // Delete from backend first if it's synced
            const apiUrl = getApiUrl();
            const token = authStore.getToken();

            if (token) {
                // We need the backend ID for this, but our local ID might be different if we generated it.
                // However, with the new sync logic, we should try to match.
                // But wait, our local ID is a UUID generated locally currently.
                // The sync logic I added doesn't store the backend ID explicitly in a separate field, 
                // it just tries to use it or generates a new one.
                // Actually, if we look at syncFromBackend, I didn't enforce using backend ID.
                // So we might have a problem deleting by ID if they don't match.

                // Let's check if the ID matches a backend one. 
                // If we can't match it easily, we might fail to delete on backend.

                // Better approach:
                // 1. Get the local integration
                // 2. Fetch backend integrations
                // 3. Find the matching backend integration by provider + email
                // 4. Delete using backend ID

                const integration = configs.find(c => c.id === id);
                if (integration && integration.params?.account_email) {
                    const response = await fetch(`${apiUrl}/integrations`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (response.ok) {
                        const data = await response.json();
                        const items: any[] = data.items || [];
                        const backendInt = items.find((i: any) =>
                            i.provider === integration.provider &&
                            JSON.parse(i.params).account_email === integration.params!.account_email
                        );

                        if (backendInt) {
                            await fetch(`${apiUrl}/integrations/${backendInt.id}`, {
                                method: 'DELETE',
                                headers: { 'Authorization': `Bearer ${token}` }
                            });
                        }
                    }
                }
            }

            // Delete from local storage
            await integrationStorage.deleteIntegration(id);
            await getIntegrations();
        } catch (e) {
            console.warn('Failed to delete integration', e);
        }
    }, [getIntegrations, configs]);

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
