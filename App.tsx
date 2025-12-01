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

import { AuthScreen } from './src/screens/auth/screen.tsx';
import { AuthProvider, useAuth } from './src/screens/auth/context.tsx';

import { KeyboardProvider } from 'react-native-keyboard-controller';

function App() {
    const isDarkMode = useColorScheme() === 'dark';

    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
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
            </KeyboardProvider>
        </GestureHandlerRootView>
    );
}

function AppContent() {
    const insets = useSafeAreaInsets();
    // COMMENTED OUT: Authentication check - will restore later
    // const { isAuthenticated, isLoading } = useAuth();
    const paddingStyle = useMemo(
        () => ({ paddingTop: insets.top, paddingBottom: insets.bottom }),
        [insets.top, insets.bottom],
    );

    // COMMENTED OUT: Loading state
    // if (isLoading) {
    //     return <View style={styles.container} />;
    // }

    // SIMPLIFIED: Always show ChatLayout for now
    return (
        <View style={[styles.container, paddingStyle]}>
            <ChatLayout />
            {/* COMMENTED OUT: Auth screen conditional
            {isAuthenticated ? <ChatLayout /> : <AuthScreen />}
            */}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#111118',
    },
});

export default App;
