/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import React, { useEffect, useMemo, useState } from 'react';
import { StatusBar, StyleSheet, useColorScheme, View, Text, AppState, AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import ChatLayout from './src/screens/main/screen.tsx';
import {
    SafeAreaProvider,
    useSafeAreaInsets,
} from 'react-native-safe-area-context';

import { MainProvider } from './src/screens/main/context';
import * as PCPModel from './src/screens/integrationsSidebar/PluginChatsProviderImpl';
const { PluginChatsProvider } = PCPModel;

import { AuthScreen } from './src/screens/auth/screen.tsx';
import { ConnectorsProvider } from './src/screens/settings/connectors/context';
import { AuthProvider, useAuth } from './src/screens/auth/context.tsx';
import { NotificationProvider } from './src/context/NotificationContext'; // Added import

import { KeyboardProvider } from 'react-native-keyboard-controller';
import { ThemeProvider, useTheme } from './src/context/ThemeContext.tsx';
import { initApiUrl } from './src/config';
import { initDatabase } from './src/services/database/database';
import { registerBackgroundSync } from './src/services/background/backgroundSyncService';
import { socket } from './src/socket';

function App() {
    const isDarkMode = useColorScheme() === 'dark';
    const [configReady, setConfigReady] = useState(false);
    const [initStatus, setInitStatus] = useState('Initializing...');

    // Initialize API URL and Database before rendering
    useEffect(() => {
        const init = async () => {
            try {
                // Timeout promise
                const timeout = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Initialization timed out')), 5000)
                );

                setInitStatus('Initializing API...');
                await Promise.race([initApiUrl(), timeout]);
                console.log('[App] API URL initialized');

                setInitStatus('Initializing Database...');
                await Promise.race([initDatabase(), timeout]);
                console.log('[App] Database initialized');

                setInitStatus('Registering Background Sync...');
                // Don't let background sync block app load
                registerBackgroundSync().catch(e => console.error('[App] Background sync failed:', e));
                console.log('[App] Background sync registered (async)');

            } catch (e) {
                console.error("Failed to initialize app:", e);
                setInitStatus('Initialization completed with errors');
            } finally {
                setConfigReady(true);
            }
        };
        init();
    }, []);

    // Socket Lifecycle Listeners (AppState & NetInfo)
    useEffect(() => {
        // 1. AppState: Reconnect when returning from background
        const handleAppStateChange = (nextAppState: AppStateStatus) => {
            if (nextAppState === 'active') {
                console.log('[App] Active: Force Reconnect');
                socket.connect();
                socket.processOutbox(); // Push queue
            }
        };
        const sub = AppState.addEventListener('change', handleAppStateChange);

        // 2. NetInfo: Reconnect when internet becomes reachable
        const unsubscribeNet = NetInfo.addEventListener(state => {
            if (state.isConnected && state.isInternetReachable) {
                console.log('[App] Network Online: Force Reconnect');
                socket.connect();
                socket.processOutbox();
            }
        });

        return () => {
            sub.remove();
            unsubscribeNet();
        };
    }, []);

    if (!configReady) {
        return (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: isDarkMode ? '#000' : '#fff' }}>
                <Text style={{ color: isDarkMode ? '#fff' : '#000', fontSize: 20 }}>{initStatus}</Text>
                <Text style={{ color: isDarkMode ? '#888' : '#666', marginTop: 10 }}>Genie App v0.0.1</Text>
            </View>
        );
    }

    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
                <SafeAreaProvider>
                    <ThemeProvider>
                        <AuthProvider>
                            <StatusBar
                                barStyle={isDarkMode ? 'light-content' : 'dark-content'}
                            />
                            <NotificationProvider>
                                <PluginChatsProvider>
                                    <ConnectorsProvider>
                                        <MainProvider>
                                            <AppContent />
                                        </MainProvider>
                                    </ConnectorsProvider>
                                </PluginChatsProvider>
                            </NotificationProvider>
                        </AuthProvider>
                    </ThemeProvider>
                </SafeAreaProvider>
            </KeyboardProvider>
        </GestureHandlerRootView>
    );
}

function AppContent() {
    const insets = useSafeAreaInsets();
    const { isAuthenticated, isLoading, token } = useAuth();
    const { theme } = useTheme();

    const containerStyle = useMemo(() => ({
        flex: 1,
        backgroundColor: theme.background,
    }), [theme.background]);

    // Global Socket Lifecycle - Auth Token Management
    useEffect(() => {
        console.log('[App] Auth state changed. Token present:', !!token);
        if (token) {
            socket.setToken(token);
            if (!socket.isReady()) {
                console.log('[App] Connecting global socket...');
                socket.open();
            }
        } else {
            console.log('[App] Token cleared. Closing global socket.');
            socket.close();
            socket.setToken(null);
        }
    }, [token]);

    if (isLoading) {
        return <View style={containerStyle} />;
    }

    return (
        <View style={containerStyle}>
            {isAuthenticated ? <ChatLayout /> : <AuthScreen />}
        </View>
    );
}

export default App;
