/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import React, { useEffect, useMemo, useState } from 'react';
import { StatusBar, StyleSheet, useColorScheme, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import ChatLayout from './src/screens/main/screen.tsx';
import {
    SafeAreaProvider,
    useSafeAreaInsets,
} from 'react-native-safe-area-context';

import { MainProvider } from './src/screens/main/context';
import * as PCPModel from './src/screens/rightsidebar/PluginChatsProviderImpl';
console.log('DEBUG: PluginChatsProviderImpl Module exports:', Object.keys(PCPModel));
console.log('DEBUG: PluginChatsProviderImpl value:', PCPModel.PluginChatsProvider);
const { PluginChatsProvider } = PCPModel;

import { AuthScreen } from './src/screens/auth/screen.tsx';
import { AuthProvider, useAuth } from './src/screens/auth/context.tsx';

import { KeyboardProvider } from 'react-native-keyboard-controller';
import { ThemeProvider, useTheme } from './src/context/ThemeContext.tsx';
import { initApiUrl } from './src/config';
import { initDatabase } from './src/services/database/database';
import { registerBackgroundSync } from './src/services/background/backgroundSyncService';

function App() {
    const isDarkMode = useColorScheme() === 'dark';
    const [configReady, setConfigReady] = useState(false);

    // Initialize API URL and Database before rendering
    useEffect(() => {
        const init = async () => {
            try {
                await initApiUrl();
                await initDatabase();
                await registerBackgroundSync();
            } catch (e) {
                console.error("Failed to initialize app:", e);
            } finally {
                setConfigReady(true);
            }
        };
        init();
    }, []);

    if (!configReady) {
        return null; // Wait for config to load
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
                                <MainProvider>
                                    <AppContent />
                                </MainProvider>
                            </PluginChatsProvider>
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
