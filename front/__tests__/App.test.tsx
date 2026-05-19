/**
 * @format
 *
 * Smoke test: verifies the App component mounts without crashing, including
 * the async init phase (API URL, database, plugins). All heavy native deps
 * are mocked; we let the full async init settle before asserting.
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import App from '../App';

// ── Async init mocks ──────────────────────────────────────────────────────────

jest.mock('../src/config', () => ({
    getApiUrl: () => 'http://test',
    initApiUrl: jest.fn(() => Promise.resolve()),
}));

jest.mock('../src/services/database/database', () => ({
    initDatabase: jest.fn(() => Promise.resolve()),
    getDatabase: jest.fn(),
}));

jest.mock('../src/services/integrations/BackgroundTaskManager', () => ({
    defineAllBackgroundTasks: jest.fn(),
    initializeSystemEventListeners: jest.fn(),
    initializeBackgroundTasks: jest.fn(() => Promise.resolve()),
    refreshBackgroundTasks: jest.fn(() => Promise.resolve()),
    registerBackgroundTask: jest.fn(() => Promise.resolve()),
    unregisterBackgroundTask: jest.fn(() => Promise.resolve()),
    stopAllBackgroundTasks: jest.fn(() => Promise.resolve()),
    manuallyTriggerBackgroundTask: jest.fn(() => Promise.resolve()),
    getActiveTaskConfig: jest.fn(() => undefined),
    isActive: jest.fn(() => false),
}));

jest.mock('../src/services/location/locationService', () => ({
    updateLocationFromGPS: jest.fn(() => Promise.resolve()),
    getStoredLocation: jest.fn(() => Promise.resolve({ lat: 0, lon: 0 })),
}));

jest.mock('../src/socket', () => ({
    socket: {
        connect: jest.fn(),
        close: jest.fn(),
        isReady: jest.fn(() => false),
        setToken: jest.fn(),
        processOutbox: jest.fn(),
    },
}));

// ── Navigation mock ───────────────────────────────────────────────────────────
// NavigationContainer calls window.dispatchEvent which doesn't exist in the
// react-native test environment.
jest.mock('@react-navigation/native', () => {
    const React = require('react');
    return {
        NavigationContainer: ({ children }: any) => React.createElement(React.Fragment, null, children),
        DarkTheme: { colors: {} },
        useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn(), replace: jest.fn() }),
        useRoute: () => ({ params: {} }),
        useFocusEffect: (cb: any) => { require('react').useEffect(cb, []); },
    };
});

jest.mock('@react-navigation/native-stack', () => ({
    createNativeStackNavigator: () => ({
        Navigator: ({ children }: any) => children,
        Screen: () => null,
    }),
}));

jest.mock('@react-navigation/bottom-tabs', () => ({
    createBottomTabNavigator: () => ({
        Navigator: ({ children }: any) => children,
        Screen: () => null,
    }),
}));

jest.mock('../src/debug/DebugUtils', () => ({
    initDebugUtils: jest.fn(),
}));

// ConnectorsProvider does async DB + integration loading that produces
// act() warnings in a smoke test. Stub it as a pass-through.
jest.mock('../src/screens/settings/connectors/context', () => ({
    ConnectorsProvider: ({ children }: any) => children,
    useConnectors: () => ({
        tools: [], configs: [], pendingProvider: null, pendingCode: null,
        authStatus: null, getIntegrations: jest.fn(), addIntegration: jest.fn(),
        updateIntegration: jest.fn(), removeIntegration: jest.fn(),
    }),
}));

// ── Test ──────────────────────────────────────────────────────────────────────

test('renders without crashing and completes async init', async () => {
    const { getByText } = render(<App />);

    // Initially shows the splash screen while configReady=false
    expect(getByText('Nomi')).toBeTruthy();

    // Wait for the async init to complete (configReady flips to true)
    // After init, the auth gate is shown (loading=true → null, or login screen)
    await waitFor(() => {
        expect(require('../src/services/database/database').initDatabase).toHaveBeenCalled();
    });
});
