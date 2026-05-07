import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { PersistentChatEmptyState } from '../../src/screens/chat/chatDetail/PersistentChatEmptyState';
import { COLORS } from './chatMocks';

jest.mock('../../src/screens/auth/context', () => ({
    useAuth: () => ({ user: { name: 'Alice Smith' } }),
}));

// Default: Gmail + Calendar connected
const mockIntegrations = [
    { id: 'gmail', connected: true },
    { id: 'calendar', connected: true },
];

jest.mock('../../src/screens/settings/connectors/context', () => ({
    useConnectors: () => ({ integrations: mockIntegrations }),
}));

const baseProps = {
    onChipPress: jest.fn(),
    accentColor: COLORS.accent,
    textPrimaryColor: COLORS.textPrimary,
    textSecondaryColor: COLORS.textSecondary,
    surfaceColor: COLORS.surface,
    showChips: true,
};

describe('PersistentChatEmptyState', () => {
    beforeEach(() => jest.clearAllMocks());

    it('renders Genie emoji', () => {
        const { getByText } = render(<PersistentChatEmptyState {...baseProps} />);
        expect(getByText('🧞')).toBeTruthy();
    });

    it('renders greeting using first name', () => {
        const { getByText } = render(<PersistentChatEmptyState {...baseProps} />);
        expect(getByText('Hello, Alice!')).toBeTruthy();
    });

    it('renders subtitle', () => {
        const { getByText } = render(<PersistentChatEmptyState {...baseProps} />);
        expect(getByText('How can I help you today?')).toBeTruthy();
    });

    it('renders Gmail chip when Gmail is connected', () => {
        const { getByText } = render(<PersistentChatEmptyState {...baseProps} />);
        expect(getByText('📧 Check email')).toBeTruthy();
    });

    it('renders Calendar chip when Calendar is connected', () => {
        const { getByText } = render(<PersistentChatEmptyState {...baseProps} />);
        expect(getByText('📅 Meetings')).toBeTruthy();
    });

    it('always renders Write code chip', () => {
        const { getByText } = render(<PersistentChatEmptyState {...baseProps} />);
        expect(getByText('💻 Write code')).toBeTruthy();
    });

    it('always renders Find info chip', () => {
        const { getByText } = render(<PersistentChatEmptyState {...baseProps} />);
        expect(getByText('🔍 Find info')).toBeTruthy();
    });

    it('caps chips at 4 even with many integrations', () => {
        const { getAllByText } = render(<PersistentChatEmptyState {...baseProps} />);
        // With Gmail + Calendar + 2 always-on = exactly 4
        const chips = getAllByText(/📧|📅|💻|🔍/);
        expect(chips.length).toBeLessThanOrEqual(4);
    });

    it('calls onChipPress with correct text when chip is pressed', () => {
        const onChipPress = jest.fn();
        const { getByText } = render(
            <PersistentChatEmptyState {...baseProps} onChipPress={onChipPress} />,
        );
        fireEvent.press(getByText('💻 Write code'));
        expect(onChipPress).toHaveBeenCalledWith('Help me write code');
    });

    it('does not render chips when showChips=false', () => {
        const { queryByText } = render(
            <PersistentChatEmptyState {...baseProps} showChips={false} />,
        );
        expect(queryByText('💻 Write code')).toBeNull();
    });

    it('renders greeting when user has a name', () => {
        const { getByText } = render(<PersistentChatEmptyState {...baseProps} />);
        expect(getByText(/Hello,/)).toBeTruthy();
    });
});
