import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Keyboard } from 'react-native';
import { AuthScreen } from '../../src/screens/auth/screen';

// ── Mocks ──────────────────────────────────────────────────────────────────────

// KeyboardAvoidingView subscribes to keyboard events and calls .remove() on unmount.
// The RN jest preset's Keyboard.addListener returns undefined, which crashes.
jest.spyOn(Keyboard, 'addListener').mockReturnValue({ remove: jest.fn() } as any);

const mockLogin = jest.fn();
const mockRegister = jest.fn();
const mockSignInWithGoogle = jest.fn();

jest.mock('../../src/screens/auth/context.tsx', () => ({
    useAuth: () => ({
        login: mockLogin,
        register: mockRegister,
        signInWithGoogle: mockSignInWithGoogle,
    }),
}));

jest.mock('../../src/screens/auth/styles.tsx', () => ({
    styles: {
        container: {},
        logo: {},
        subtitle: {},
        formContainer: {},
        inputContainer: {},
        label: {},
        input: {},
        inputFocused: {},
        button: {},
        buttonPressed: {},
        buttonText: {},
        googleButton: {},
        googleButtonPressed: {},
        googleButtonText: {},
        switchButton: {},
        switchButtonText: {},
    },
}));

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
    jest.clearAllMocks();
    mockSignInWithGoogle.mockResolvedValue(undefined);
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('AuthScreen — static content', () => {
    it('renders the app name', () => {
        const { getByText } = render(<AuthScreen />);
        expect(getByText('Nomi')).toBeTruthy();
    });

    it('renders the tagline', () => {
        const { getByText } = render(<AuthScreen />);
        expect(getByText('Your AI Assistant')).toBeTruthy();
    });

    it('renders Email and Password labels', () => {
        const { getByText } = render(<AuthScreen />);
        expect(getByText('Email')).toBeTruthy();
        expect(getByText('Password')).toBeTruthy();
    });

    it('shows Login button in login mode', () => {
        const { getByText } = render(<AuthScreen />);
        expect(getByText('Login')).toBeTruthy();
    });

    it('shows Google sign-in button', () => {
        const { getByText } = render(<AuthScreen />);
        expect(getByText('Continue with Google')).toBeTruthy();
    });

    it('shows register toggle link', () => {
        const { getByText } = render(<AuthScreen />);
        expect(getByText("Don't have an account? Register")).toBeTruthy();
    });
});

describe('AuthScreen — login mode', () => {
    it('does not show Name field in login mode', () => {
        const { queryByText } = render(<AuthScreen />);
        expect(queryByText('Name')).toBeNull();
    });

    it('calls login() with entered email and password', () => {
        const { getByPlaceholderText, getByText } = render(<AuthScreen />);
        fireEvent.changeText(getByPlaceholderText('Enter your email'), 'alice@example.com');
        fireEvent.changeText(getByPlaceholderText('Enter your password'), 'secret123');
        fireEvent.press(getByText('Login'));
        expect(mockLogin).toHaveBeenCalledWith('alice@example.com', 'secret123');
    });

    it('calls login with empty strings if fields are untouched', () => {
        const { getByText } = render(<AuthScreen />);
        fireEvent.press(getByText('Login'));
        expect(mockLogin).toHaveBeenCalledWith('', '');
    });
});

describe('AuthScreen — switch to register mode', () => {
    it('shows Name field after switching to register', () => {
        const { getByText, queryByText } = render(<AuthScreen />);
        fireEvent.press(getByText("Don't have an account? Register"));
        expect(queryByText('Name')).toBeTruthy();
    });

    it('shows Create Account button after switching to register', () => {
        const { getByText } = render(<AuthScreen />);
        fireEvent.press(getByText("Don't have an account? Register"));
        expect(getByText('Create Account')).toBeTruthy();
    });

    it('shows login toggle link in register mode', () => {
        const { getByText } = render(<AuthScreen />);
        fireEvent.press(getByText("Don't have an account? Register"));
        expect(getByText('Already have an account? Login')).toBeTruthy();
    });

    it('calls register() with name, email, password', () => {
        const { getByText, getByPlaceholderText } = render(<AuthScreen />);
        fireEvent.press(getByText("Don't have an account? Register"));
        fireEvent.changeText(getByPlaceholderText('Enter your name'), 'Alice');
        fireEvent.changeText(getByPlaceholderText('Enter your email'), 'alice@example.com');
        fireEvent.changeText(getByPlaceholderText('Enter your password'), 'secret123');
        fireEvent.press(getByText('Create Account'));
        expect(mockRegister).toHaveBeenCalledWith('alice@example.com', 'secret123', 'Alice');
    });

    it('switches back to login mode', () => {
        const { getByText, queryByText } = render(<AuthScreen />);
        fireEvent.press(getByText("Don't have an account? Register"));
        fireEvent.press(getByText('Already have an account? Login'));
        expect(queryByText('Name')).toBeNull();
        expect(getByText('Login')).toBeTruthy();
    });
});

describe('AuthScreen — Google sign-in', () => {
    it('calls signInWithGoogle() when button is pressed', async () => {
        const { getByText } = render(<AuthScreen />);
        fireEvent.press(getByText('Continue with Google'));
        expect(mockSignInWithGoogle).toHaveBeenCalledTimes(1);
    });
});
