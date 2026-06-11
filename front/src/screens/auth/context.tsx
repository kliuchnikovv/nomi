import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';

import { AppState, AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

import { apiClient, authApi, setupApiClient } from '../../apiClient';
import { getApiUrl } from '../../config';
import { AuthContextType, User, alertError } from './models';
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
                '294499144277-249g8bd226pd5fqaledtgjnl56lnsvbg.apps.googleusercontent.com',
            iosClientId:
                '294499144277-u8gr39urgpdott3sheeqk3977h2486tm.apps.googleusercontent.com',
            // Login only — identity scopes (email/profile) are requested by
            // default. Gmail/Calendar access goes through the server-side plugin
            // OAuth flow (separate Google Cloud projects), NOT the login token.
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

    // Re-fetch the user from /auth/me and persist it. The backend self-heals a
    // deleted/dangling Updates chat on this call (EnsureUpdatesChat) and returns
    // a fresh updates_chat_id, so the client's Updates inbox target stays valid.
    // Non-fatal: a transient failure keeps the cached user; a 401 is handled by
    // the apiClient refresh/logout flow.
    const refreshUser = useCallback(async () => {
        try {
            const data = await authApi.getMe();
            if (data?.id) {
                setUser(data);
                await AsyncStorage.setItem('user', JSON.stringify(data));
            }
        } catch (e) {
            console.warn('[Auth] refreshUser failed', e);
        }
    }, []);

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

    // Refresh the user from the server on login and whenever the app returns to
    // the foreground, so the backend recreates a deleted Updates chat and the
    // cached updates_chat_id never goes stale during normal use.
    useEffect(() => {
        if (!isAuthenticated) return;
        refreshUser();
        const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
            if (s === 'active') refreshUser();
        });
        return () => sub.remove();
    }, [isAuthenticated, refreshUser]);

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
        refreshUser,
    };

    return (
        <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
    );
}
