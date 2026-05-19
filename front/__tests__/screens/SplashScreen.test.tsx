import React from 'react';
import { render } from '@testing-library/react-native';
import { SplashScreen } from '../../src/screens/splash/SplashScreen';

describe('SplashScreen', () => {
    it('renders the app name', () => {
        const { getByText } = render(<SplashScreen initStatus="Starting…" />);
        expect(getByText('Nomi')).toBeTruthy();
    });

    it('renders the tagline', () => {
        const { getByText } = render(<SplashScreen initStatus="Starting…" />);
        expect(getByText('Your AI Assistant')).toBeTruthy();
    });

    it('renders the initStatus text', () => {
        const { getByText } = render(<SplashScreen initStatus="Loading config…" />);
        expect(getByText('Loading config…')).toBeTruthy();
    });

    it('updates when initStatus changes', () => {
        const { getByText, rerender } = render(<SplashScreen initStatus="Step 1" />);
        expect(getByText('Step 1')).toBeTruthy();
        rerender(<SplashScreen initStatus="Step 2" />);
        expect(getByText('Step 2')).toBeTruthy();
    });

    it('renders the version footer', () => {
        const { getByText } = render(<SplashScreen initStatus="" />);
        expect(getByText('v0.0.1')).toBeTruthy();
    });

    it('renders the powered-by footer', () => {
        const { getByText } = render(<SplashScreen initStatus="" />);
        expect(getByText('Powered by Anthropic')).toBeTruthy();
    });

    it('renders an ActivityIndicator', () => {
        const { UNSAFE_getByType } = render(<SplashScreen initStatus="" />);
        const { ActivityIndicator } = require('react-native');
        expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
    });
});
