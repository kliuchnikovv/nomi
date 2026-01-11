/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import React, { useEffect, useMemo, useState } from 'react';
import { StatusBar, StyleSheet, useColorScheme, View, Text } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import ChatLayout from './src/screens/main/screen.tsx';
import {
    SafeAreaProvider,
    useSafeAreaInsets,
} from 'react-native-safe-area-context';

import { MainProvider } from './src/screens/main/context';
import * as PCPModel from './src/screens/rightsidebar/PluginChatsProviderImpl';
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
// import { useChatStore } from './src/store/chatStore'; // Verification import

function App() {
    const isDarkMode = useColorScheme() === 'dark';
    const [configReady, setConfigReady] = useState(false);

    // Verification Code - Uncomment to test store
    /*
    useEffect(() => {
        const testStore = async () => {
             // Wait for hydration
             await new Promise(r => setTimeout(r, 1000));

             const state = useChatStore.getState();
             console.log('Store loaded:', state.chats);

             // Test add message
             const testChatId = 'test-chat-1';
             const testMsg = {
                 _id: Math.random().toString(),
                 text: 'Hello Persistence ' + new Date().toISOString(),
                 createdAt: new Date(),
                 user: { _id: 1, name: 'Test User' }
             };

             state.addMessage(testChatId, testMsg);
             console.log('Message added to', testChatId);
        };
        testStore();
    }, []);
    */
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
    const { isAuthenticated, isLoading } = useAuth();
    const { theme } = useTheme();

    const containerStyle = useMemo(() => ({
        flex: 1,
        backgroundColor: theme.background,
    }), [theme.background]);

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
