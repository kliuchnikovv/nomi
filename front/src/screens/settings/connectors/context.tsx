import React, {
    createContext,
    useContext,
    ReactNode,
    useState,
    useEffect,
    useRef,
} from 'react';
import { Linking, InteractionManager } from 'react-native';
import InAppBrowser from 'react-native-inappbrowser-reborn';

import { ConnectorContextType, Tool, Integration } from './models';
import { useAuth } from '../../auth/context';
import { pluginsApi, authStore, integrationsApi } from '../../../apiClient.ts';
import { OAUTH_CALLBACK_URL, getApiUrl } from '../../../config.ts';
import * as DatabaseModule from '../../../services/database/database';
import {
    integrationStorage,
    Integration as LocalIntegration,
} from '../../../services/integrations/IntegrationStorage';
import {
    getIntegrationMetadata,
    isServer,
    getServerIntegrations,
    INTEGRATION_REGISTRY,
} from '../../../services/integrations/registry';
import {
    refreshBackgroundTasks,
    registerSystemEventListeners,
    initializeSystemEventListeners,
} from '../../../services/integrations/BackgroundTaskManager';
import { pluginChatStorage } from '../../../services/plugins/PluginChatStorage';

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

const ConnectorsContext = createContext<ConnectorContextType | undefined>(
    undefined,
);

export function useConnectors() {
    const context = useContext(ConnectorsContext);
    if (!context) {
        throw new Error(
            'useConnectors must be used within a ConnectorsProvider',
        );
    }
    return context;
}

export function ConnectorsProvider({ children }: { children: ReactNode }) {
    const { user } = useAuth();
    const [tools, setTools] = useState<Tool[]>([]);
    const [configs, setConfigs] = useState<Integration[]>([]);
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
                console.error(
                    '[ConnectorsProvider] Failed to initialize database:',
                    e,
                );
            });
    }, []);

    // Initialize system event listeners once database is ready.
    // Background tasks are initialized by getIntegrations() → refreshBackgroundTasks() below.
    useEffect(() => {
        if (dbReady) {
            initializeSystemEventListeners();
        }
    }, [dbReady]);

    // Load integrations once database is ready AND user is authenticated.
    // Both conditions needed: db may be ready before auth loads from AsyncStorage.
    useEffect(() => {
        if (dbReady && user?.id) {
            getIntegrations();
        }
    }, [dbReady, user?.id]);

    async function getTools() {
        await getIntegrations();
    }

    const syncFromBackend = React.useCallback(async () => {
        try {
            const apiUrl = getApiUrl();
            const token = authStore.getToken();
            if (!token) return;

            const response = await fetch(`${apiUrl}/integrations`, {
                headers: { Authorization: `Bearer ${token}` },
            });

            if (!response.ok) return;

            const data = await response.json();
            const items: any[] = data.items || data || [];

            // Smart sync: only sync server integrations
            // Client integrations are loaded only from local SQLite
            for (const item of items) {
                const provider = item.provider || item.Provider;
                if (!item || !provider) {
                    console.warn(
                        '[ConnectorsProvider] Skipping invalid integration item:',
                        item,
                    );
                    continue;
                }
                // Check via registry if this is a server integration
                if (!isServer(provider)) {
                    console.log(
                        `[ConnectorsProvider] Skipping client-only integration: ${provider} (stored locally)`,
                    );
                    continue;
                }

                // Server integrations are synced for metadata display
                // But tokens are not synced (they stay on the server)
                console.log(
                    `[ConnectorsProvider] Server integration found: ${provider} (metadata only)`,
                );

                // Can add logic for syncing server integration metadata
                // if needed for UI
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
            const localIntegrations =
                await integrationStorage.getIntegrations();

            const normalized: Integration[] = [];
            const toolsList: Tool[] = [];

            for (const p of localIntegrations) {
                // Get metadata from registry
                const metadata = getIntegrationMetadata(p.provider);

                // Fetch credentials
                const creds = await integrationStorage.getCredentials(p.id);
                const params: any = { account_email: p.accountEmail };

                // Always include access token if available locally (client-side safety check)
                if (creds) {
                    params.access_token = creds.accessToken;
                    // Also include refresh token and expiry if available
                    if (creds.refreshToken)
                        params.refresh_token = creds.refreshToken;
                    if (creds.tokenExpiry)
                        params.token_expiry = Math.floor(
                            creds.tokenExpiry.getTime() / 1000,
                        );
                }

                // Add metadata from registry
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
                    provider: p.provider, // Ensure provider is always present
                    enabled: p.enabled,
                    params: params,
                });
            }

            setConfigs(normalized);
            setTools(toolsList);

            console.log(
                `[ConnectorsProvider] Loaded ${normalized.length} integrations from local storage`,
                normalized.map(n => ({
                    id: n.id,
                    provider: n.provider,
                    hasParams: !!n.params,
                    accessTokenLen: n.params?.access_token?.length,
                })),
            );

            // Register system event handlers for each integration
            for (const integration of localIntegrations) {
                if (integration.enabled) {
                    const metadata = getIntegrationMetadata(
                        integration.provider,
                    );
                    if (metadata?.supportsBackgroundTasks) {
                        registerSystemEventListeners(
                            integration.id,
                            integration.provider,
                        ).catch(e => {
                            console.error(
                                `[ConnectorsProvider] Failed to register system listeners for ${integration.provider}:`,
                                e,
                            );
                        });
                    }
                }
            }
        } catch (e) {
            console.warn('Failed to load integrations', e);
            setConfigs([]);
            setTools([]);
        } finally {
            // Defer background task refresh until after all UIKit animations complete.
            // Calling TaskManager/BackgroundFetch native APIs while a navigation transition
            // or sheet dismissal is animating causes a dispatch_semaphore deadlock on the
            // UIKit animation manager thread, freezing the UI.
            InteractionManager.runAfterInteractions(() => {
                refreshBackgroundTasks().catch(e => {
                    console.error(
                        '[ConnectorsProvider] Failed to refresh background tasks:',
                        e,
                    );
                });
            });
        }
    }, [dbReady]);

    const handleOAuthUrl = React.useCallback(
        async (url: string) => {
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

                if (
                    provider &&
                    pendingProvider &&
                    provider !== pendingProvider
                ) {
                    return;
                }

                // If we got a code, exchange it for tokens using mobile endpoint
                if (code && provider) {
                    await exchangeCodeForTokens(provider, code);
                    return;
                }

                // GitHub App install (no code exchange): backend already saved the
                // installation and the server-side integration row via the
                // signed-state callback. The UI's connected state is driven by
                // LOCAL SQLite, so persist a metadata-only record here too (mirrors
                // exchangeCodeForTokens for server integrations).
                if (status === 'cancelled') {
                    setAuthStatus('Connection cancelled');
                } else if (
                    (status === 'ok' || status === 'installed') &&
                    provider
                ) {
                    if (status === 'installed') {
                        try {
                            const existing =
                                await integrationStorage.getIntegrationByEmail(
                                    provider,
                                    '',
                                );
                            if (!existing) {
                                const metadata =
                                    getIntegrationMetadata(provider);
                                await integrationStorage.createIntegration(
                                    {
                                        provider:
                                            provider as LocalIntegration['provider'],
                                        name: metadata?.displayName || provider,
                                        enabled: true,
                                        accountEmail: '',
                                        storageType: metadata?.storageType,
                                        supportsBackgroundTasks: false,
                                        systemEventListeners: [],
                                    },
                                    { accessToken: '' },
                                );
                            }
                        } catch (persistErr) {
                            console.warn(
                                '[ConnectorsProvider] Failed to persist installed integration locally',
                                persistErr,
                            );
                        }
                    }
                    const labelEmail = accountEmail || email;
                    setAuthStatus(
                        `Connected ${provider}${
                            labelEmail ? ` (${labelEmail})` : ''
                        }`,
                    );
                    await getIntegrations();
                } else {
                    setAuthStatus(
                        `OAuth failed${provider ? ` for ${provider}` : ''}`,
                    );
                }
            } finally {
                setPendingProvider(null);
                setPendingCode(null);
                await getIntegrations();
            }
        },
        [pendingProvider, getIntegrations],
    );

    /**
     * Exchange OAuth code for tokens and save locally
     */
    const exchangeCodeForTokens = async (provider: string, code: string) => {
        try {
            console.log(
                `[ConnectorsProvider] Exchanging code for tokens (${provider})...`,
            );

            const apiUrl = getApiUrl();
            const token = authStore.getToken();
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
            };
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }

            const response = await fetch(
                `${apiUrl}/oauth/${provider}/callback-mobile`,
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ code }),
                },
            );

            if (!response.ok) {
                const error = await response.json().catch(() => ({}));
                throw new Error(error.error || 'Token exchange failed');
            }

            const data = await response.json();

            console.log(
                `[ConnectorsProvider] Token exchange successful for ${provider}`,
            );

            // Get metadata from registry
            const metadata = getIntegrationMetadata(data.provider);
            const displayName =
                metadata?.displayName ||
                data.provider.charAt(0).toUpperCase() + data.provider.slice(1);

            // For server-side integrations, tokens are stored on the server — don't save locally
            // For client-only integrations, tokens may still be present (future enhancement)
            if (metadata?.storageType === 'server') {
                // Server-side: save only metadata without tokens
                await integrationStorage.createIntegration({
                    provider: data.provider as LocalIntegration['provider'],
                    name: `${displayName} (${data.account_email})`,
                    enabled: true,
                    accountEmail: data.account_email,
                    storageType: metadata?.storageType,
                    // Server-side integrations don't support background tasks on the client
                    supportsBackgroundTasks: false,
                    systemEventListeners: [],
                });
            } else {
                // Client-only: save with tokens (if present in response)
                await integrationStorage.createIntegration(
                    {
                        provider: data.provider as LocalIntegration['provider'],
                        name: `${displayName} (${data.account_email})`,
                        enabled: true,
                        accountEmail: data.account_email,
                        storageType: metadata?.storageType,
                        supportsBackgroundTasks:
                            metadata?.supportsBackgroundTasks,
                        systemEventListeners: metadata?.systemEventListeners,
                    },
                    {
                        accessToken: data.access_token,
                        refreshToken: data.refresh_token,
                        tokenExpiry: data.token_expiry
                            ? new Date(data.token_expiry * 1000)
                            : undefined,
                    },
                );
            }

            console.log(
                `[ConnectorsProvider] Integration saved locally: ${data.account_email}`,
            );
            setAuthStatus(`Connected ${provider} (${data.account_email})`);

            await getIntegrations();

            // Register background tasks only for client-only integrations
            if (
                metadata?.storageType === 'client' &&
                metadata?.supportsBackgroundTasks
            ) {
                const localIntegration =
                    await integrationStorage.getIntegrationByEmail(
                        provider,
                        data.account_email,
                    );
                if (localIntegration) {
                    await refreshBackgroundTasks();
                    await registerSystemEventListeners(
                        localIntegration.id,
                        provider,
                    );
                }
            }
        } catch (e) {
            console.error('[ConnectorsProvider] Token exchange failed:', e);
            setAuthStatus(`Failed to connect ${provider}`);
            throw e;
        }
    };

    useEffect(() => {
        const subscription = Linking.addEventListener('url', ({ url }) =>
            handleOAuthUrl(url),
        );
        Linking.getInitialURL()
            .then(initialUrl => {
                if (initialUrl) {
                    handleOAuthUrl(initialUrl);
                }
            })
            .catch(() => {});

        return () => {
            subscription.remove();
        };
    }, [handleOAuthUrl]);

    const openOAuthFlow = React.useCallback(
        async (authUrl: string) => {
            console.log('Opening OAuth flow', authUrl);
            try {
                const isAvailable = await InAppBrowser.isAvailable();
                console.log('InAppBrowser available:', isAvailable);
                if (isAvailable) {
                    const result = await InAppBrowser.openAuth(
                        authUrl,
                        OAUTH_CALLBACK_URL,
                        {
                            ephemeralWebSession: false,
                            dismissButtonStyle: 'close',
                            showTitle: false,
                            enableDefaultShare: false,
                        },
                    );
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
        },
        [handleOAuthUrl],
    );

    const startOAuth = React.useCallback(
        async (provider: string) => {
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
        },
        [openOAuthFlow],
    );

    // GitHub uses a GitHub App installation flow (not plain OAuth): fetch the
    // install URL, open it, and let handleOAuthUrl handle the post-install return.
    const startGitHubApp = React.useCallback(async () => {
        try {
            setPendingProvider('github');
            const apiUrl = getApiUrl();
            const token = authStore.getToken();
            const headers: Record<string, string> = {};
            if (token) headers['Authorization'] = `Bearer ${token}`;
            const res = await fetch(
                `${apiUrl}/integrations/github/app/install`,
                { headers },
            );
            if (!res.ok) {
                throw new Error('Failed to get GitHub App install URL');
            }
            const data = await res.json();
            if (data.install_url) {
                await openOAuthFlow(data.install_url);
            }
        } catch (err) {
            console.warn('Failed to start GitHub App installation', err);
            setPendingProvider(null);
            setAuthStatus('Failed to start GitHub App installation');
            throw err;
        }
    }, [openOAuthFlow]);

    async function toggleTool(configID: string, enabled: boolean) {
        const integration = configs.find(
            c => c.id === configID || c.provider === configID,
        );
        if (!integration) {
            // For client-only integrations (authType === 'none'), create the record if it doesn't exist
            const metadata = getIntegrationMetadata(configID);
            if (metadata?.authType === 'none') {
                try {
                    await integrationStorage.createIntegration(
                        {
                            provider: configID as any,
                            name: metadata.displayName,
                            enabled: enabled,
                            storageType: metadata.storageType,
                            supportsBackgroundTasks:
                                metadata.supportsBackgroundTasks,
                            systemEventListeners: metadata.systemEventListeners,
                        },
                        { accessToken: '' },
                    );
                    await getIntegrations();
                    console.log(
                        `[ConnectorsProvider] Created client-only integration: ${configID}`,
                    );
                    return;
                } catch (e) {
                    console.warn(
                        `Failed to create client-only integration ${configID}:`,
                        e,
                    );
                }
            } else {
                console.warn(`Integration not found for ID: ${configID}`);
            }
            return;
        }

        try {
            // Update in local storage
            await integrationStorage.updateIntegration(integration.id, {
                enabled,
            });
            await getIntegrations();

            // Update background tasks when integration state changes
            await refreshBackgroundTasks();
        } catch (e) {
            console.warn('Failed to update integration', e);
        }
    }

    const deleteIntegration = React.useCallback(
        async (id: string) => {
            try {
                // Delete from backend first if it's synced
                const apiUrl = getApiUrl();
                const token = authStore.getToken();

                if (token) {
                    const integration = configs.find(c => c.id === id);

                    if (integration?.provider === 'telegram') {
                        // Telegram is stored in plugin_data, not integrations table
                        await fetch(`${apiUrl}/telegram/unlink`, {
                            method: 'DELETE',
                            headers: { Authorization: `Bearer ${token}` },
                        });
                    } else if (
                        integration &&
                        integration.params?.account_email
                    ) {
                        const response = await fetch(`${apiUrl}/integrations`, {
                            headers: { Authorization: `Bearer ${token}` },
                        });
                        if (response.ok) {
                            const data = await response.json();
                            const items: any[] = data.items || [];
                            const backendInt = items.find(
                                (i: any) =>
                                    i.provider === integration.provider &&
                                    JSON.parse(i.params).account_email ===
                                        integration.params!.account_email,
                            );

                            if (backendInt) {
                                await fetch(
                                    `${apiUrl}/integrations/${backendInt.id}`,
                                    {
                                        method: 'DELETE',
                                        headers: {
                                            Authorization: `Bearer ${token}`,
                                        },
                                    },
                                );
                            }
                        }
                    }
                }

                // Clean up plugin chats for this integration's provider
                const integration = configs.find(c => c.id === id);
                if (integration?.provider) {
                    await pluginChatStorage.deletePluginChatsByPlugin(
                        integration.provider,
                    );
                }

                // Delete from local storage (also cleans up events, tasks, credentials, emails)
                await integrationStorage.deleteIntegration(id);

                // Update background tasks after removing integration
                await refreshBackgroundTasks();
                await getIntegrations();
            } catch (e) {
                console.warn('Failed to delete integration', e);
            }
        },
        [getIntegrations, configs],
    );

    const connectTelegram = React.useCallback(
        async (code: string) => {
            try {
                const apiUrl = getApiUrl();
                const token = authStore.getToken();
                if (!token) {
                    throw new Error('Not authenticated');
                }

                const response = await fetch(`${apiUrl}/telegram/link`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({ code }),
                });

                if (!response.ok) {
                    const error = await response.json().catch(() => ({}));
                    throw new Error(error.error || 'Failed to link Telegram');
                }

                const data = await response.json();
                console.log(
                    `[ConnectorsProvider] Telegram linked: ${data.display_name}`,
                );

                // Save as a local integration so it shows in sidebar
                const metadata = getIntegrationMetadata('telegram');
                const displayName = data.display_name || 'Telegram';

                await integrationStorage.createIntegration(
                    {
                        provider: 'telegram' as any,
                        name: `Telegram (${displayName})`,
                        enabled: true,
                        accountEmail: displayName,
                        storageType: metadata?.storageType,
                        supportsBackgroundTasks:
                            metadata?.supportsBackgroundTasks,
                        systemEventListeners: metadata?.systemEventListeners,
                    },
                    {
                        accessToken: code,
                        refreshToken: '',
                        tokenExpiry: new Date(
                            Date.now() + 365 * 24 * 60 * 60 * 1000,
                        ),
                    },
                );

                setAuthStatus(`Connected Telegram (${displayName})`);
                await getIntegrations();
            } catch (e) {
                console.error('[ConnectorsProvider] Telegram link failed:', e);
                setAuthStatus(
                    e instanceof Error
                        ? e.message
                        : 'Failed to connect Telegram',
                );
                throw e;
            }
        },
        [getIntegrations],
    );

    const connectImap = React.useCallback(
        async (email: string, password: string) => {
            const { IMAPEmailClient } = await import(
                '../../../services/integrations/clients/IMAPEmailClient'
            );
            const config = IMAPEmailClient.autoDetectConfig(email, password);
            const fullConfig = {
                imapHost: config.imapHost || `imap.${email.split('@')[1]}`,
                imapPort: config.imapPort || 993,
                imapUseTLS: config.imapUseTLS ?? true,
                smtpHost: config.smtpHost || `smtp.${email.split('@')[1]}`,
                smtpPort: config.smtpPort || 465,
                smtpUseTLS: config.smtpUseTLS ?? true,
                username: email,
                password,
                displayName: email,
            };

            const client = new IMAPEmailClient();
            const test = await client.testConnection(fullConfig);
            if (!test.success) {
                throw new Error(test.message || 'Connection failed');
            }

            const metadata = getIntegrationMetadata('imap');
            await integrationStorage.createIntegration(
                {
                    provider: 'imap' as any,
                    name: `Email (${email})`,
                    enabled: true,
                    accountEmail: email,
                    storageType: metadata?.storageType,
                    supportsBackgroundTasks: metadata?.supportsBackgroundTasks,
                    systemEventListeners: metadata?.systemEventListeners,
                },
                {
                    accessToken: JSON.stringify(fullConfig),
                    refreshToken: '',
                    tokenExpiry: new Date(
                        Date.now() + 10 * 365 * 24 * 60 * 60 * 1000,
                    ),
                },
            );

            // Push credentials to the server so the brain can run email tools
            // server-side (creds are encrypted at rest by the API).
            try {
                await integrationsApi.storeImapCredentials({
                    account_email: email,
                    display_name: fullConfig.displayName,
                    username: fullConfig.username,
                    password: fullConfig.password,
                    imap_host: fullConfig.imapHost,
                    imap_port: fullConfig.imapPort,
                    imap_use_tls: fullConfig.imapUseTLS,
                    smtp_host: fullConfig.smtpHost,
                    smtp_port: fullConfig.smtpPort,
                    smtp_use_tls: fullConfig.smtpUseTLS,
                });
            } catch (e) {
                console.error(
                    '[ConnectorsProvider] Failed to store IMAP credentials server-side:',
                    e,
                );
            }

            await getIntegrations();
        },
        [getIntegrations],
    );

    const value: ConnectorContextType = {
        tools,
        integrations: configs,
        getTools,
        getIntegrations,
        toggleTool,
        startOAuth,
        startGitHubApp,
        deleteIntegration,
        connectTelegram,
        connectImap,
    };

    return (
        <ConnectorsContext.Provider value={value}>
            {children}
        </ConnectorsContext.Provider>
    );
}
