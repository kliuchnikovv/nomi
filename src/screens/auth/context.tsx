import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

import AsyncStorage from '@react-native-async-storage/async-storage';

import { apiClient, setupApiClient } from '../../apiClient';
import { API_URL } from '../../config';
import { AuthContextType, User, alertError } from "./models";


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
    const [refreshTokenValue, setRefreshTokenValue] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // API base URL is defined in src/config.ts

    const isAuthenticated = useMemo(() => !!token, [token]);

    useEffect(() => {
        const loadAuthData = async () => {
            let currentToken: string | null = null;
            let currentRefreshToken: string | null = null;
            try {
                const storedUser = await AsyncStorage.getItem('user');
                const storedToken = await AsyncStorage.getItem('token');
                const storedRefreshToken = await AsyncStorage.getItem('refreshToken');
                if (storedToken && storedUser && storedRefreshToken) {
                    setUser(JSON.parse(storedUser));
                    setToken(storedToken);
                    setRefreshTokenValue(storedRefreshToken);
                    currentToken = storedToken;
                    currentRefreshToken = storedRefreshToken;
                }
                console.log(`data loaded`, storedUser, storedToken, storedRefreshToken);
            } catch (e) {
                console.error("Failed to load auth data", e);
            } finally {
                setIsLoading(false);
                // Initialize apiClient with tokens loaded from storage to avoid race conditions
                setupApiClient({
                    getToken: () => currentToken,
                    refreshToken: () => refreshToken(),
                    logout: () => logout(),
                });
            }
        };

        loadAuthData();
    }, []);

    async function setAuthData(
        userData: any,
        tokenData: string | null,
        refreshTokenData: string | null,
    ) {
        setUser(userData);
        setToken(tokenData);
        setRefreshTokenValue(refreshTokenData);

        // Immediately rebind apiClient with the freshest token to avoid one-request gap
        setupApiClient({
            getToken: () => tokenData,
            refreshToken: () => refreshToken(),
            logout: () => logout(),
        });

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
            const data = await apiClient.post<any>(`${API_URL}/auth/register`, {
                name,
                email,
                password,
            });
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
            const data = await apiClient.post<any>(`${API_URL}/auth/login`, {
                email,
                password,
            });
            console.log(data)
            await setAuthData(data.user, data.token, data.refresh_token);
        } catch (error) {
            alertError(`Error logging in: ${error}`);
            console.error(`error while logging in: ${error}`);
        }
    }

    async function logout() {
        await setAuthData(null, null, null);
    }

    async function refreshToken(): Promise<boolean> {
        const currentRefreshToken = refreshTokenValue || (await AsyncStorage.getItem('refreshToken'));

        if (!currentRefreshToken) {
            await logout();
            return false;
        }

        try {
            const response = await fetch(`${API_URL}/auth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    refresh_token: currentRefreshToken,
                }),
            });

            if (!response.ok) {
                await logout();
                return false;
            }

            const data = await response.json();
            await setAuthData(data.user, data.token, data.refresh_token);

            return true;
        } catch (error) {
            console.error(`error while refreshing token: ${error}`);
            await logout();
            return false;
        }
    }

    const value: AuthContextType = {
        user,
        token,
        isAuthenticated,
        isLoading,
        login,
        register,
        logout,
        refreshToken,
    };

    return (
        <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
    );
}
