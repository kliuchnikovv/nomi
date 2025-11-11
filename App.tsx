/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import React, { useMemo } from 'react';
import { StatusBar, StyleSheet, useColorScheme, View } from 'react-native';
import ChatLayout from './src/screens/main/screen.tsx';
import {
    SafeAreaProvider,
    useSafeAreaInsets,
} from 'react-native-safe-area-context';

import { MainProvider } from './src/screens/main/context';

import { AuthScreen } from './src/screens/auth/screen.tsx';
import { AuthProvider, useAuth } from './src/screens/auth/context.tsx';

function App() {
    const isDarkMode = useColorScheme() === 'dark';

    return (
        <SafeAreaProvider>
            <AuthProvider>
                <StatusBar
                    barStyle={isDarkMode ? 'light-content' : 'dark-content'}
                />
                <MainProvider>
                    <AppContent />
                </MainProvider>
            </AuthProvider>
        </SafeAreaProvider>
    );
}

function AppContent() {
    const insets = useSafeAreaInsets();
    const { isAuthenticated, isLoading } = useAuth();
    const paddingStyle = useMemo(
        () => ({ paddingTop: insets.top, paddingBottom: insets.bottom }),
        [insets.top, insets.bottom],
    );

    if (isLoading) {
        return <View style={styles.container} />;
    }

    return (
        <View style={[styles.container, paddingStyle]}>
            {isAuthenticated ? <ChatLayout /> : <AuthScreen />}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#282c34',
    },
});

export default App;
