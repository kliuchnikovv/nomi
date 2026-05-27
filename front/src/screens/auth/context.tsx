import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

import { apiClient, setupApiClient } from '../../apiClient';
import { getApiUrl } from '../../config';
import { AuthContextType, User, alertError } from './models';
import { secureTokenStorage } from '../../services/auth/SecureTokenStorage';
import { integrationStorage } from '../../services/integrations/IntegrationStorage';
import { pluginChatStorage } from '../../services/plugins/PluginChatStorage';
import {
    requestPermissionAndRegister,
    deregisterDevice,
} from '../../services/notifications/NotificationHandler';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [refreshTokenValue, setRefreshTokenValue] = useState<string | null>(
        null,
    );
    const [isLoading, setIsLoading] = useState(true);

    // API base URL is defined in src/config.ts

    const isAuthenticated = useMemo(() => !!token, [token]);

    useEffect(() => {
        const loadAuthData = async () => {
            try {
                const storedUser = await AsyncStorage.getItem('user');
                const storedToken = await AsyncStorage.getItem('token');
                const storedRefreshToken = await AsyncStorage.getItem(
                    'refreshToken',
                );
                if (storedToken && storedUser && storedRefreshToken) {
                    const parsedUser = JSON.parse(storedUser);
                    // Set synchronously so storage singletons have the correct user
                    // before any effects fire on the subsequent re-render.
                    integrationStorage.setCurrentUserId(parsedUser?.id ?? null);
                    pluginChatStorage.setCurrentUserId(parsedUser?.id ?? null);
                    setUser(parsedUser);
                    setToken(storedToken);
                    setRefreshTokenValue(storedRefreshToken);
                }
                console.log(
                    `data loaded`,
                    storedUser,
                    storedToken,
                    storedRefreshToken,
                );
            } catch (e) {
                console.error('Failed to load auth data', e);
            } finally {
                setIsLoading(false);
            }
        };

        loadAuthData();
    }, []);

    // Configure Google Sign-In
    useEffect(() => {
        GoogleSignin.configure({
            webClientId:
                '174083236719-itfjiur5c404ndjjhj3rukinl85sug66.apps.googleusercontent.com',
            iosClientId:
                '174083236719-ume8kgknccr5drb5qbjfrap6t4kgg88p.apps.googleusercontent.com',
            offlineAccess: true,
            scopes: [
                'https://www.googleapis.com/auth/gmail.readonly',
                'https://www.googleapis.com/auth/gmail.send',
                'https://www.googleapis.com/auth/gmail.compose',
                'https://www.googleapis.com/auth/calendar',
                'https://www.googleapis.com/auth/calendar.events',
            ],
        });
    }, []);

    async function setAuthData(
        userData: any,
        tokenData: string | null,
        refreshTokenData: string | null,
    ) {
        // Set user ID immediately (synchronously) so storage calls after
        // setAuthData() in the same tick see the correct user context.
        // The useEffect on `user` is a safety net for the initial load.
        const userId = userData?.id ?? null;
        integrationStorage.setCurrentUserId(userId);
        pluginChatStorage.setCurrentUserId(userId);

        setUser(userData);
        setToken(tokenData);
        setRefreshTokenValue(refreshTokenData);

        if (userData) {
            await AsyncStorage.setItem('user', JSON.stringify(userData));
        } else {
            await AsyncStorage.removeItem('user');
        }

        if (tokenData) {
            await AsyncStorage.setItem('token', tokenData);
        }

        if (refreshTokenData) {
            await AsyncStorage.setItem('refreshToken', refreshTokenData);
        } else {
            await AsyncStorage.removeItem('refreshToken');
        }

        console.log(`data updated`, userData, tokenData, refreshTokenData);
    }

    async function register(email: string, password: string, name: string) {
        if (email.length === 0) {
            alertError('Email cannot be empty');
            return;
        }
        if (password.length === 0) {
            alertError('Password cannot be empty');
            return;
        }
        if (name.length === 0) {
            alertError('Name cannot be empty');
            return;
        }

        try {
            const data = await apiClient.post<any>(
                `${getApiUrl()}/auth/register`,
                {
                    name,
                    email,
                    password,
                },
            );
            await setAuthData(data.user, data.token, data.refresh_token);
        } catch (error) {
            alertError(`Error creating user: ${error}`);
            console.error(`error while creating user: ${error}`);
        }
    }

    async function login(email: string, password: string) {
        if (email.length === 0) {
            alertError('Email cannot be empty');
            return;
        }
        if (password.length === 0) {
            alertError('Password cannot be empty');
            return;
        }

        try {
            const data = await apiClient.post<any>(
                `${getApiUrl()}/auth/login`,
                {
                    email,
                    password,
                },
            );
            console.log(data);
            await setAuthData(data.user, data.token, data.refresh_token);
        } catch (error) {
            alertError(`Error logging in: ${error}`);
            console.error(`error while logging in: ${error}`);
        }
    }

    const logout = useCallback(async () => {
        await setAuthData(null, null, null);
    }, []);

    // Latch to prevent multiple concurrent refresh requests
    const refreshPromiseRef = useRef<Promise<boolean> | null>(null);

    const refreshToken = useCallback(async (): Promise<boolean> => {
        if (refreshPromiseRef.current) {
            return refreshPromiseRef.current;
        }

        refreshPromiseRef.current = (async () => {
            const currentRefreshToken =
                refreshTokenValue ||
                (await AsyncStorage.getItem('refreshToken'));

            if (!currentRefreshToken) {
                await logout();
                refreshPromiseRef.current = null;
                return false;
            }

            try {
                const response = await fetch(`${getApiUrl()}/auth/refresh`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        refresh_token: currentRefreshToken,
                    }),
                });

                if (!response.ok) {
                    // Only logout on permanent auth errors (invalid/expired refresh token)
                    if (response.status === 401 || response.status === 403) {
                        console.warn(
                            '[Auth] Refresh failed: invalid refresh token, logging out',
                        );
                        await logout();
                    } else {
                        // Server errors (5xx) or other issues - temporary, do not logout
                        console.warn(
                            `[Auth] Refresh failed: HTTP ${response.status}, will retry on next request`,
                        );
                    }
                    return false;
                }

                const data = await response.json();
                await setAuthData(data.user, data.token, data.refresh_token);

                return true;
            } catch (error) {
                // Network errors (timeout, no connection, app backgrounded) - temporary, do not logout
                console.warn('[Auth] Refresh failed (network error):', error);
                return false;
            } finally {
                refreshPromiseRef.current = null;
            }
        })();

        return refreshPromiseRef.current;
    }, [refreshTokenValue, logout]);

    async function signInWithGoogle() {
        try {
            await GoogleSignin.hasPlayServices();
            const userInfo = await GoogleSignin.signIn();

            // Exchange Google token with backend
            const data = await apiClient.post<any>(
                `${getApiUrl()}/auth/google`,
                {
                    id_token: userInfo.data?.idToken,
                },
            );

            await setAuthData(data.user, data.token, data.refresh_token);

            // Store Google Access Token locally for Client-Side Tools (Local Hands)
            try {
                const tokens = await GoogleSignin.getTokens();
                // We use 'gmail-default' and 'calendar-default' as placeholders or linked to user.id?
                // For simplicity in this architecture, we associate the main google login with the 'gmail' tool.
                // In a perfect world, we'd map this to a specific integration ID returned by the backend or similar.
                // But the backend integration is "dummy" now.
                // Let's store it under a stable ID that ClientToolExecutor looks for.
                // GmailClient.ts uses `integrations.find(i => i.provider === 'gmail')`.
                // We need to ensure we have an integration entry for this.
                // The backend /auth/google might return the integration ID or we create one?
                // For now, let's assume one main integration ID 'gmail_primary' and 'calendar_primary'.

                // IMPORTANT: The backend user session (Agno) is separate from the Google OAuth session on the client.
                // But we need to enable the tools.
                // We'll store these tokens for specific providers.

                // Since this is the main login, we can assume these are the "default" credentials.
                // We might need to look up the integration IDs.
                // For now, let's store them generically or iterate?
                // Let's store for 'gmail' and 'calendar' if we don't have IDs yet.
                // Actually, ClientToolExecutor looks up integration by provider type from storage.
                // We need to UPDATE integration credentials in SecureStore for the integration IDs found in DB.

                // Wait, if authenticating with Google logs us in, we should check if we have integrations.
                // If not, we might need to "create" them locally or fetch from backend (which is empty).
                // "Local Hands" means we might not even need an integration record in the backend DB?
                // But `IntegrationStorage` is used.
                // Let's save to SecureTokenStorage under a known key for now, or fetch integrations.

                // Re-fetch integrations after login to get the IDs
                // (Note: AuthProvider doesn't know about IntegrationStorage directly to avoid circular dependency loop if not careful)
                // But we can import it dynamically or just use a placeholder for now if IntegrationStorage handles it.

                // Better approach: Just store it as 'google_oauth_tokens' and let GmailClient look it up?
                // GmailClient looks up integrationId.
                // Let's try to update *all* google-based integration tokens that we can find?
                // Or simply: The user just logged in. We can assume we want to use these tokens for future calls.
                // We will create/update the "Primary" integration.

                // Ensure we have a local integration record for Gmail and Calendar
                // If not, create them locally.

                // Check for Gmail integration
                console.log('[Auth] Fetching existing integrations...');
                const integrations = await integrationStorage.getIntegrations();
                console.log(
                    `[Auth] Found ${integrations.length} existing integrations`,
                );

                let gmailInteg = integrations.find(i => i.provider === 'gmail');
                if (!gmailInteg) {
                    console.log('[Auth] Creating new Gmail integration...');
                    gmailInteg = await integrationStorage.createIntegration(
                        {
                            provider: 'gmail',
                            name: userInfo.data?.user.email || 'Gmail',
                            enabled: true,
                            accountEmail: userInfo.data?.user.email,
                        },
                        {
                            accessToken: tokens.accessToken,
                            refreshToken: 'google-signin-managed',
                            tokenExpiry: new Date(Date.now() + 3500 * 1000),
                        },
                    );
                    console.log(
                        '[Auth] Gmail integration created:',
                        gmailInteg.id,
                    );
                } else {
                    console.log(
                        '[Auth] Gmail integration already exists:',
                        gmailInteg.id,
                    );
                }

                let calendarInteg = integrations.find(
                    i => i.provider === 'calendar',
                );
                if (!calendarInteg) {
                    console.log('[Auth] Creating new Calendar integration...');
                    calendarInteg = await integrationStorage.createIntegration(
                        {
                            provider: 'calendar',
                            name: userInfo.data?.user.email || 'Calendar',
                            enabled: true,
                            accountEmail: userInfo.data?.user.email,
                        },
                        {
                            accessToken: tokens.accessToken,
                            refreshToken: 'google-signin-managed',
                            tokenExpiry: new Date(Date.now() + 3500 * 1000),
                        },
                    );
                    console.log(
                        '[Auth] Calendar integration created:',
                        calendarInteg.id,
                    );
                } else {
                    console.log(
                        '[Auth] Calendar integration already exists:',
                        calendarInteg.id,
                    );
                }

                const tokenData = {
                    accessToken: tokens.accessToken,
                    refreshToken: 'google-signin-managed', // GoogleSignin SDK manages refresh internally on Android/iOS usually, but we store what we have.
                    // Actually, on iOS `getTokens` might returns a fresh access token.
                    // We'll trust `getTokens` to give us a valid one, and `GoogleSignin.signInSilently()` to refresh.
                    expiry: Date.now() + 3500 * 1000,
                };

                console.log('[Auth] Saving Gmail tokens...');
                await secureTokenStorage.saveToken(gmailInteg!.id, tokenData);
                console.log('[Auth] Saving Calendar tokens...');
                await secureTokenStorage.saveToken(
                    calendarInteg!.id,
                    tokenData,
                );

                console.log(
                    '[Auth] Google tokens saved locally for Remote Brain usage',
                );
            } catch (tokenError: any) {
                console.error(
                    '[Auth] Failed to save Google tokens locally:',
                    tokenError,
                );
                alertError(
                    `Error saving Google tokens: ${
                        tokenError.message || 'Unknown error'
                    }`,
                );
                // Continue anyway - the user is logged in, just local token storage failed
            }
        } catch (error: any) {
            console.error('[Auth] Google Sign-In error:', error);

            if (error.code === 'SIGN_IN_CANCELLED') {
                console.log('[Auth] User cancelled Google Sign-In');
            } else if (error.code === 'IN_PROGRESS') {
                console.log('[Auth] Google Sign-In already in progress');
            } else if (error.code === 'PLAY_SERVICES_NOT_AVAILABLE') {
                alertError('Google Play Services not available');
            } else {
                const errorMsg = error.message || error.toString();
                alertError(`Error signing in with Google: ${errorMsg}`);
                console.error('[Auth] Google Sign-In full error:', {
                    code: error.code,
                    message: error.message,
                    stack: error.stack,
                    details: error,
                });
            }
        }
    }

    const updateUser = async (updatedUser: User) => {
        setUser(updatedUser);
        await AsyncStorage.setItem('user', JSON.stringify(updatedUser));
    };

    // Sync current user ID into storage singletons for user-space isolation
    useEffect(() => {
        const userId = user?.id ?? null;
        integrationStorage.setCurrentUserId(userId);
        pluginChatStorage.setCurrentUserId(userId);
    }, [user]);

    // Update apiClient whenever token changes to fix race condition with initial load
    useEffect(() => {
        setupApiClient({
            getToken: () => token,
            refreshToken: () => refreshToken(),
            logout: () => logout(),
        });
    }, [token, refreshToken, logout]);

    // Register/deregister push notification device token with auth state
    useEffect(() => {
        if (isAuthenticated) {
            requestPermissionAndRegister().catch(e =>
                console.warn('[Auth] Failed to register push token:', e),
            );
        } else {
            deregisterDevice().catch(() => {
                /* best-effort on logout */
            });
        }
    }, [isAuthenticated]);

    const value: AuthContextType = {
        user,
        token,
        isAuthenticated,
        isLoading,
        login,
        register,
        logout,
        refreshToken,
        signInWithGoogle,
        updateUser,
    };

    return (
        <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
    );
}
