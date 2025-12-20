/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import React, { useMemo } from 'react';
import { StatusBar, StyleSheet, useColorScheme, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import ChatLayout from './src/screens/main/screen.tsx';
import {
    SafeAreaProvider,
    useSafeAreaInsets,
} from 'react-native-safe-area-context';

import { MainProvider } from './src/screens/main/context';
import { PluginChatsProvider } from './src/screens/rightsidebar/context';

import { AuthScreen } from './src/screens/auth/screen.tsx';
import { AuthProvider, useAuth } from './src/screens/auth/context.tsx';

import { KeyboardProvider } from 'react-native-keyboard-controller';
import { ThemeProvider, useTheme } from './src/context/ThemeContext.tsx';

function App() {
    const isDarkMode = useColorScheme() === 'dark';

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
