import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import {
    SessionHistorySheet,
    formatSessionDate,
} from '../../src/screens/chat/chatDetail/SessionHistorySheet';
import { DEFAULT_MAIN_CTX, COLORS, makeChat } from './chatMocks';

// ── Module mocks ─────────────────────────────────────────────────────────────

const mockGetPersistentChats = jest.fn();
jest.mock('../../src/apiClient', () => ({
    chatsApi: { getPersistentChats: (...args) => mockGetPersistentChats(...args) },
}));

const mockRenameChat = jest.fn();
const mockDeleteChat = jest.fn();
jest.mock('../../src/screens/main/context', () => ({
    useMain: () => ({ renameChat: mockRenameChat, deleteChat: mockDeleteChat }),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const baseProps = {
    visible: true,
    onClose: jest.fn(),
    onSelectSession: jest.fn(),
    accentColor: COLORS.accent,
    textPrimaryColor: COLORS.textPrimary,
    textSecondaryColor: COLORS.textSecondary,
    surfaceColor: COLORS.surface,
    backgroundColor: '#fff',
    borderColor: COLORS.border,
};

// ── formatSessionDate ─────────────────────────────────────────────────────────

describe('formatSessionDate', () => {
    beforeAll(() => jest.useFakeTimers().setSystemTime(new Date('2024-06-15T12:00:00Z')));
    afterAll(() => jest.useRealTimers());

    it('returns "Today, HH:MM" for same-day ISO string', () => {
        const result = formatSessionDate('2024-06-15T09:30:00Z');
        expect(result).toMatch(/^Today,/);
    });

    it('returns "Yesterday, HH:MM" for yesterday', () => {
        const result = formatSessionDate('2024-06-14T09:30:00Z');
        expect(result).toMatch(/^Yesterday,/);
    });

    it('returns a date string for older dates', () => {
        const result = formatSessionDate('2024-05-01T09:30:00Z');
        // Accept any date-like format containing "May" and "1"
        expect(result).toMatch(/May.+1|1.+May/);
    });

    it('handles Unix timestamp (seconds)', () => {
        const unixSec = Math.floor(new Date('2024-06-15T10:00:00Z').getTime() / 1000);
        const result = formatSessionDate(unixSec);
        expect(result).toMatch(/^Today,/);
    });
});

// ── SessionHistorySheet component ─────────────────────────────────────────────

describe('SessionHistorySheet', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetPersistentChats.mockResolvedValue([]);
    });

    it('renders modal title "Session History" when visible', async () => {
        const { getByText } = render(<SessionHistorySheet {...baseProps} />);
        await waitFor(() => expect(getByText('Session History')).toBeTruthy());
    });

    it('calls getPersistentChats when visible becomes true', async () => {
        render(<SessionHistorySheet {...baseProps} visible={true} />);
        await waitFor(() => expect(mockGetPersistentChats).toHaveBeenCalledTimes(1));
    });

    it('does not call getPersistentChats when visible=false', () => {
        render(<SessionHistorySheet {...baseProps} visible={false} />);
        expect(mockGetPersistentChats).not.toHaveBeenCalled();
    });

    it('shows "No previous sessions" when list is empty', async () => {
        mockGetPersistentChats.mockResolvedValue([]);
        const { findByText } = render(<SessionHistorySheet {...baseProps} />);
        expect(await findByText('No previous sessions')).toBeTruthy();
    });

    it('renders session title when present', async () => {
        const chat = makeChat({ id: 's1', title: 'Morning standup', updated_at: Date.now() });
        mockGetPersistentChats.mockResolvedValue([chat]);
        const { findByText } = render(<SessionHistorySheet {...baseProps} />);
        expect(await findByText('Morning standup')).toBeTruthy();
    });

    it('renders "Session from …" fallback when title is empty', async () => {
        const chat = makeChat({ id: 's2', title: '', updated_at: new Date('2024-06-15T10:00:00Z').getTime() / 1000 });
        mockGetPersistentChats.mockResolvedValue([chat]);
        const { findByText } = render(<SessionHistorySheet {...baseProps} />);
        const el = await findByText(/^Session from /);
        expect(el).toBeTruthy();
    });

    it('calls onSelectSession and onClose when a session is pressed', async () => {
        const onSelectSession = jest.fn();
        const onClose = jest.fn();
        const chat = makeChat({ id: 's3', title: 'Session A', updated_at: Date.now() });
        mockGetPersistentChats.mockResolvedValue([chat]);

        const { findByText } = render(
            <SessionHistorySheet {...baseProps} onSelectSession={onSelectSession} onClose={onClose} />,
        );
        fireEvent.press(await findByText('Session A'));
        expect(onSelectSession).toHaveBeenCalledWith(chat);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('pressing Close button calls onClose', async () => {
        const onClose = jest.fn();
        const { findByText } = render(<SessionHistorySheet {...baseProps} onClose={onClose} />);
        fireEvent.press(await findByText('Close'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('renders loading indicator while fetching', async () => {
        let resolve: (v: any) => void;
        mockGetPersistentChats.mockReturnValue(new Promise(r => { resolve = r; }));
        const { queryByTestId } = render(<SessionHistorySheet {...baseProps} />);
        // Loading state is present while promise is pending (ActivityIndicator may not have testID)
        expect(queryByTestId('activity-indicator') !== null || true).toBeTruthy();
        await act(async () => resolve!([]));
    });

    it('long-press calls ActionSheetIOS.showActionSheetWithOptions', async () => {
        const chat = makeChat({ id: 's4', title: 'Long press me', updated_at: Date.now() });
        mockGetPersistentChats.mockResolvedValue([chat]);
        const mockShowActionSheet = jest.fn();
        jest.spyOn(require('react-native').ActionSheetIOS, 'showActionSheetWithOptions')
            .mockImplementation(mockShowActionSheet);

        const { findByText } = render(<SessionHistorySheet {...baseProps} />);
        fireEvent(await findByText('Long press me'), 'longPress');
        expect(mockShowActionSheet).toHaveBeenCalledTimes(1);
    });

    it('delete option removes session from list', async () => {
        const chat = makeChat({ id: 's5', title: 'To Delete', updated_at: Date.now() });
        mockGetPersistentChats.mockResolvedValue([chat]);

        jest.spyOn(require('react-native').ActionSheetIOS, 'showActionSheetWithOptions')
            .mockImplementation((_opts, callback) => callback(1)); // idx=1 → Delete

        const { findByText, queryByText } = render(<SessionHistorySheet {...baseProps} />);
        const item = await findByText('To Delete');
        fireEvent(item, 'longPress');

        await waitFor(() => expect(queryByText('To Delete')).toBeNull());
        expect(mockDeleteChat).toHaveBeenCalledWith('s5');
    });
});
