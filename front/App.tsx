/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import React, { useEffect, useState } from 'react';
import { StatusBar, useColorScheme, AppState, AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { MainProvider } from './src/screens/main/context';
import * as PCPModel from './src/screens/integrationsSidebar/PluginChatsProviderImpl';
const { PluginChatsProvider } = PCPModel;

import { AuthProvider, useAuth } from './src/screens/auth/context.tsx';

import { KeyboardProvider } from 'react-native-keyboard-controller';
import { ThemeProvider, useTheme } from './src/context/ThemeContext.tsx';
import { initApiUrl } from './src/config';
import { initDatabase } from './src/services/database/database';
import { defineAllBackgroundTasks } from './src/services/integrations/BackgroundTaskManager';
import { registerClientPlugins } from './src/plugins/registerClientPlugins';
import { updateLocationFromGPS } from './src/services/location/locationService';
import { socket } from './src/socket';
import { initDebugUtils } from './src/debug/DebugUtils';
import { AppNavigator } from './src/navigation/AppNavigator';
import { ConnectorsProvider } from './src/screens/settings/connectors/context';
import { SplashScreen } from './src/screens/splash/SplashScreen';
import { useShareExtension } from './src/share-extension/useShareExtension';

// Initialize debug utilities
initDebugUtils();

function ThemedNavigationContainer({ children }: { children: React.ReactNode }) {
    const { theme } = useTheme();
    const navTheme = {
        ...DarkTheme,
        colors: {
            ...DarkTheme.colors,
            background: theme.background,
            card: theme.surface,
            text: theme.text,
            border: theme.border,
            primary: theme.accent,
        },
    };
    return <NavigationContainer theme={navTheme}>{children}</NavigationContainer>;
}

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
                console.log('[App] Local RAG logging enabled. You will see [Local RAG Search] and [Client Tool Executor] when the agent runs a local search (e.g. "search my emails" or "find in my notes").');

                // IMPORTANT: wait for all plugins to register BEFORE defining background tasks.
                // defineAllBackgroundTasks() reads the plugin handler map synchronously;
                // if called before plugins load the map is empty and no tasks get defined.
                setInitStatus('Registering plugins...');
                await registerClientPlugins();
                defineAllBackgroundTasks();
                console.log('[App] Background tasks defined after plugin registration');

                // Auto-detect location on launch (best-effort, does not block startup)
                updateLocationFromGPS().catch(e =>
                    console.warn('[App] Location auto-detect failed:', e)
                );

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
                console.log('[App] Active: Checking socket connection');
                // Only reconnect if not already connected
                if (!socket.isReady()) {
                    socket.connect();
                }
                socket.processOutbox(); // Push queue
            }
        };
        const sub = AppState.addEventListener('change', handleAppStateChange);

        // 2. NetInfo: Reconnect when internet becomes reachable
        const unsubscribeNet = NetInfo.addEventListener(state => {
            if (state.isConnected && state.isInternetReachable) {
                console.log('[App] Network Online: Checking socket connection');
                // Only reconnect if not already connected
                if (!socket.isReady()) {
                    socket.connect();
                }
                socket.processOutbox();
            }
        });

        return () => {
            sub.remove();
            unsubscribeNet();
        };
    }, []);

    if (!configReady) {
        return <SplashScreen initStatus={initStatus} />;
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
                            <PluginChatsProvider>
                                <ConnectorsProvider>
                                    <MainProvider>
                                        <ThemedNavigationContainer>
                                            <AppContent />
                                        </ThemedNavigationContainer>
                                    </MainProvider>
                                </ConnectorsProvider>
                            </PluginChatsProvider>
                        </AuthProvider>
                    </ThemeProvider>
                </SafeAreaProvider>
            </KeyboardProvider>
        </GestureHandlerRootView>
    );
}

function AppContent() {
    const { isAuthenticated, isLoading, token } = useAuth();
    useShareExtension();

    // Global Socket Lifecycle - Auth Token Management
    useEffect(() => {
        console.log('[App] Auth state changed. Token present:', !!token);
        if (token) {
            socket.setToken(token);
            // IMPORTANT: do not auto-connect here.
            // Chat sockets must include chat_id; notification sockets are handled by NotificationProvider.
        } else {
            console.log('[App] Token cleared. Closing global socket.');
            socket.close();
            socket.setToken(null);
        }
    }, [token]);

    if (isLoading) {
        return null;
    }

    return <AppNavigator />;
}

export default App;
