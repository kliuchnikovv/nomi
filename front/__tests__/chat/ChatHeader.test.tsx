import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ChatHeader } from '../../src/screens/chat/components/ChatHeader';
import { MOCK_THEME, MOCK_INSETS } from './chatMocks';

jest.mock('../../src/context/ThemeContext', () => ({
    useTheme: () => MOCK_THEME,
}));

jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => MOCK_INSETS,
    SafeAreaProvider: ({ children }) => children,
    SafeAreaView: ({ children }) => children,
    SafeAreaInsetsContext: require('react').createContext({ top: 44, bottom: 34, left: 0, right: 0 }),
    SafeAreaFrameContext: require('react').createContext({ x: 0, y: 0, width: 375, height: 812 }),
    initialWindowMetrics: null,
}));

// Mock heavy animated components
jest.mock('../../src/screens/chat/components/TypingIndicator', () => ({
    TypingIndicator: () => null,
}));
jest.mock('../../src/screens/chat/components/SoupAnimation', () => ({
    SoupAnimation: () => null,
}));
jest.mock('../../src/screens/chat/styles', () => ({
    createStyles: () => ({
        header: {},
        menuButton: {},
        headerAvatar: {},
        headerAvatarText: {},
        headerBody: {},
        headerTitle: { fontSize: 17, fontWeight: '600' },
        headerSubtitle: { fontSize: 13 },
    }),
}));

const baseProps = {
    title: 'My Chat',
    subtitle: '',
    showMenu: true,
    showInbox: true,
    isInboxMode: false,
    chatMode: 'agent' as const,
    onMenuPress: jest.fn(),
    onInboxPress: jest.fn(),
};

describe('ChatHeader', () => {
    beforeEach(() => jest.clearAllMocks());

    it('renders title', () => {
        const { getByText } = render(<ChatHeader {...baseProps} />);
        expect(getByText('My Chat')).toBeTruthy();
    });

    it('renders subtitle when provided', () => {
        const { getByText } = render(<ChatHeader {...baseProps} subtitle="Team Nomi" />);
        expect(getByText('Team Nomi')).toBeTruthy();
    });

    it('does not render subtitle when empty', () => {
        const { queryByText } = render(<ChatHeader {...baseProps} subtitle="" />);
        expect(queryByText('Team Nomi')).toBeNull();
    });

    it('renders menu button when showMenu=true', () => {
        const { UNSAFE_getByProps } = render(<ChatHeader {...baseProps} showMenu={true} />);
        // Menu button wraps the Menu icon — assert it's in the tree via testID on mock
        expect(UNSAFE_getByProps({ testID: 'Menu' })).toBeTruthy();
    });

    it('does not render menu button when showMenu=false', () => {
        const { UNSAFE_queryByProps } = render(<ChatHeader {...baseProps} showMenu={false} />);
        expect(UNSAFE_queryByProps({ testID: 'Menu' })).toBeNull();
    });

    it('pressing menu button calls onMenuPress', () => {
        const onMenuPress = jest.fn();
        const { UNSAFE_getByProps } = render(
            <ChatHeader {...baseProps} onMenuPress={onMenuPress} showMenu={true} />,
        );
        const menuIcon = UNSAFE_getByProps({ testID: 'Menu' });
        fireEvent.press(menuIcon.parent);
        expect(onMenuPress).toHaveBeenCalledTimes(1);
    });

    it('renders inbox button when showInbox=true and onInboxPress provided', () => {
        const { UNSAFE_getByProps } = render(
            <ChatHeader {...baseProps} showInbox={true} onInboxPress={jest.fn()} />,
        );
        expect(UNSAFE_getByProps({ testID: 'Mail' })).toBeTruthy();
    });

    it('does not render inbox button when showInbox=false', () => {
        const { UNSAFE_queryByProps } = render(<ChatHeader {...baseProps} showInbox={false} />);
        expect(UNSAFE_queryByProps({ testID: 'Mail' })).toBeNull();
    });

    it('pressing inbox button calls onInboxPress', () => {
        const onInboxPress = jest.fn();
        const { UNSAFE_getByProps } = render(
            <ChatHeader {...baseProps} showInbox={true} onInboxPress={onInboxPress} />,
        );
        const mailIcon = UNSAFE_getByProps({ testID: 'Mail' });
        fireEvent.press(mailIcon.parent);
        expect(onInboxPress).toHaveBeenCalledTimes(1);
    });

    it('renders active agents badge when activeAgentsCount > 0', () => {
        const { getByText } = render(<ChatHeader {...baseProps} activeAgentsCount={3} />);
        expect(getByText('3')).toBeTruthy();
    });

    it('does not render agents badge when activeAgentsCount=0', () => {
        const { queryByText } = render(<ChatHeader {...baseProps} activeAgentsCount={0} />);
        expect(queryByText('0')).toBeNull();
    });

    it('renders emoji icon in avatar when icon is "sparkles" keyword', () => {
        const { UNSAFE_getByProps } = render(<ChatHeader {...baseProps} icon="sparkles" />);
        expect(UNSAFE_getByProps({ testID: 'MagicWand' })).toBeTruthy();
    });

    it('renders code icon when icon="code"', () => {
        const { UNSAFE_getByProps } = render(<ChatHeader {...baseProps} icon="code" />);
        expect(UNSAFE_getByProps({ testID: 'Code' })).toBeTruthy();
    });
});
