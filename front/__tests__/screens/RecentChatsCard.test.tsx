import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { RecentChatsCard } from '../../src/screens/dashboard/components/RecentChatsCard';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockTheme = {
    surface: '#fff', border: '#ccc', text: '#000', textSecondary: '#666',
    background: '#f5f5f5', primary: '#007AFF',
};
jest.mock('../../src/context/ThemeContext', () => ({
    useTheme: () => ({ theme: mockTheme }),
}));

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeChat(id: string, title?: string, updated_at?: string) {
    return { id, title, updated_at };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('RecentChatsCard — header', () => {
    it('renders the "Recent Chats" title', () => {
        const { getByText } = render(<RecentChatsCard chats={[]} onChatPress={jest.fn()} />);
        expect(getByText('Recent Chats')).toBeTruthy();
    });
});

describe('RecentChatsCard — empty state', () => {
    it('shows empty-state message when no chats', () => {
        const { getByText } = render(<RecentChatsCard chats={[]} onChatPress={jest.fn()} />);
        expect(getByText(/No chats yet/)).toBeTruthy();
    });

    it('does not show empty-state message when chats exist', () => {
        const chats = [makeChat('c1', 'Hello')];
        const { queryByText } = render(<RecentChatsCard chats={chats} onChatPress={jest.fn()} />);
        expect(queryByText(/No chats yet/)).toBeNull();
    });
});

describe('RecentChatsCard — chat list', () => {
    it('renders chat titles', () => {
        const chats = [makeChat('c1', 'First'), makeChat('c2', 'Second')];
        const { getByText } = render(<RecentChatsCard chats={chats} onChatPress={jest.fn()} />);
        expect(getByText('First')).toBeTruthy();
        expect(getByText('Second')).toBeTruthy();
    });

    it('shows "New Chat" when title is absent', () => {
        const chats = [makeChat('c1')];
        const { getByText } = render(<RecentChatsCard chats={chats} onChatPress={jest.fn()} />);
        expect(getByText('New Chat')).toBeTruthy();
    });

    it('calls onChatPress with the correct id', () => {
        const onPress = jest.fn();
        const chats = [makeChat('c1', 'Alpha'), makeChat('c2', 'Beta')];
        const { getByText } = render(<RecentChatsCard chats={chats} onChatPress={onPress} />);
        fireEvent.press(getByText('Beta'));
        expect(onPress).toHaveBeenCalledWith('c2');
    });
});

describe('RecentChatsCard — time formatting', () => {
    it('shows "Just now" for very recent chats', () => {
        jest.setSystemTime(new Date('2024-06-15T12:00:00Z'));
        const chats = [makeChat('c1', 'A', '2024-06-15T11:55:00Z')];
        const { getByText } = render(<RecentChatsCard chats={chats} onChatPress={jest.fn()} />);
        expect(getByText('Just now')).toBeTruthy();
    });

    it('shows "Xh ago" for chats older than an hour', () => {
        jest.setSystemTime(new Date('2024-06-15T12:00:00Z'));
        const chats = [makeChat('c1', 'A', '2024-06-15T09:00:00Z')];
        const { getByText } = render(<RecentChatsCard chats={chats} onChatPress={jest.fn()} />);
        expect(getByText('3h ago')).toBeTruthy();
    });

    it('shows "Xd ago" for chats older than a day', () => {
        jest.setSystemTime(new Date('2024-06-15T12:00:00Z'));
        const chats = [makeChat('c1', 'A', '2024-06-13T12:00:00Z')];
        const { getByText } = render(<RecentChatsCard chats={chats} onChatPress={jest.fn()} />);
        expect(getByText('2d ago')).toBeTruthy();
    });

    it('shows empty string when updated_at is absent', () => {
        const chats = [makeChat('c1', 'A')];
        // Should not throw
        const { getByText } = render(<RecentChatsCard chats={chats} onChatPress={jest.fn()} />);
        expect(getByText('A')).toBeTruthy();
    });
});

describe('RecentChatsCard — collapse', () => {
    it('hides chat list when header is pressed (collapsed)', () => {
        const chats = [makeChat('c1', 'Visible')];
        const { getByText, queryByText } = render(
            <RecentChatsCard chats={chats} onChatPress={jest.fn()} />
        );
        fireEvent.press(getByText('Recent Chats'));
        expect(queryByText('Visible')).toBeNull();
    });

    it('shows chat list again when header is pressed twice', () => {
        const chats = [makeChat('c1', 'Visible')];
        const { getByText } = render(<RecentChatsCard chats={chats} onChatPress={jest.fn()} />);
        fireEvent.press(getByText('Recent Chats'));
        fireEvent.press(getByText('Recent Chats'));
        expect(getByText('Visible')).toBeTruthy();
    });
});
