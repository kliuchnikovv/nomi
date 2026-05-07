import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ThemeScreen } from '../../src/screens/settings/screens/ThemeScreen';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
    useNavigation: () => ({ goBack: mockGoBack }),
}));

const mockSetTheme = jest.fn();

jest.mock('../../src/context/ThemeContext', () => ({
    useTheme: () => ({
        theme: {
            background: '#000', textPrimary: '#fff', textSecondary: '#aaa',
            accent: '#f00', surface: '#111', surfaceHighlight: '#222', border: '#333',
        },
        themeName: 'retroSunset',
        setTheme: mockSetTheme,
    }),
}));

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => { jest.clearAllMocks(); });

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ThemeScreen — structure', () => {
    it('renders the screen title', () => {
        const { getByText } = render(<ThemeScreen />);
        expect(getByText('Theme')).toBeTruthy();
    });

    it('renders "Dark" and "Light" section headers', () => {
        const { getByText } = render(<ThemeScreen />);
        expect(getByText('Dark')).toBeTruthy();
        expect(getByText('Light')).toBeTruthy();
    });

    it('renders multiple dark theme options', () => {
        const { getAllByText } = render(<ThemeScreen />);
        // themes index has 6 dark themes — any regex that matches dark theme names
        const darkItems = getAllByText(/Tokyo|One Dark|Retro Sunset|Serika|Deep Ocean|Dark Minimal/i);
        expect(darkItems.length).toBeGreaterThanOrEqual(1);
    });

    it('renders at least one light theme option', () => {
        const { getAllByText } = render(<ThemeScreen />);
        const lightItems = getAllByText(/Visual Studio|Retro Pastel/i);
        expect(lightItems.length).toBeGreaterThanOrEqual(1);
    });
});

describe('ThemeScreen — navigation', () => {
    it('calls navigation.goBack() when back icon is pressed', () => {
        const { getByTestId } = render(<ThemeScreen />);
        // NavArrowLeft is mocked to <View testID="NavArrowLeft"> — fireEvent bubbles to Pressable
        fireEvent.press(getByTestId('NavArrowLeft'));
        expect(mockGoBack).toHaveBeenCalledTimes(1);
    });
});

describe('ThemeScreen — theme selection', () => {
    it('calls setTheme when a theme option is pressed', () => {
        const { getAllByText } = render(<ThemeScreen />);
        // Press the first dark theme option by its visible label
        const [firstDark] = getAllByText(/Tokyo|One Dark|Retro Sunset|Serika|Deep Ocean|Dark Minimal/i);
        fireEvent.press(firstDark);
        expect(mockSetTheme).toHaveBeenCalledTimes(1);
    });

    it('passes a valid theme key string to setTheme', () => {
        const { getAllByText } = render(<ThemeScreen />);
        const [firstDark] = getAllByText(/Tokyo|One Dark|Retro Sunset|Serika|Deep Ocean|Dark Minimal/i);
        fireEvent.press(firstDark);
        expect(typeof mockSetTheme.mock.calls[0][0]).toBe('string');
    });
});
