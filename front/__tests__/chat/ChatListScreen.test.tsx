import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ChatListScreen } from '../../src/screens/chat/chatList/ChatListScreen';
import { DEFAULT_MAIN_CTX, DEFAULT_AUTH_CTX, MOCK_THEME, MOCK_INSETS, makeChat } from './chatMocks';

// ── Module mocks ─────────────────────────────────────────────────────────────

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
    useNavigation: () => ({ navigate: mockNavigate }),
    useFocusEffect: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
    SafeAreaProvider: ({ children }) => children,
    SafeAreaView: ({ children }) => children,
    SafeAreaInsetsContext: require('react').createContext({ top: 44, bottom: 34, left: 0, right: 0 }),
    SafeAreaFrameContext: require('react').createContext({ x: 0, y: 0, width: 375, height: 812 }),
    initialWindowMetrics: null,
}));

jest.mock('../../src/context/ThemeContext', () => ({
    useTheme: () => MOCK_THEME,
}));

let mockMain = { ...DEFAULT_MAIN_CTX };
jest.mock('../../src/screens/main/context', () => ({
    useMain: () => mockMain,
    emptyChatID: '00000000-0000-0000-0000-000000000000',
}));

let mockAuth = { ...DEFAULT_AUTH_CTX };
jest.mock('../../src/screens/auth/context', () => ({
    useAuth: () => mockAuth,
}));

jest.mock('../../src/navigation/MainTabs', () => ({
    TAB_BAR_ICON_HEIGHT: 60,
}));

// AVAILABLE_TEAMS returns a predictable list
jest.mock('../../src/screens/chat/teams', () => ({
    AVAILABLE_TEAMS: [
        { id: 'genie_team', name: 'Genie Team', isAgent: false },
    ],
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function renderScreen() {
    return render(<ChatListScreen />);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ChatListScreen', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockMain = { ...DEFAULT_MAIN_CTX };
        mockAuth = { ...DEFAULT_AUTH_CTX };
    });

    describe('header', () => {
        it('renders "Chats" title', () => {
            const { getByText } = renderScreen();
            expect(getByText('Chats')).toBeTruthy();
        });

        it('renders "+" new-chat button when single_chat_mode=false', () => {
            mockAuth = { ...DEFAULT_AUTH_CTX, user: { ...DEFAULT_AUTH_CTX.user, single_chat_mode: false } };
            const { UNSAFE_getByProps } = renderScreen();
            expect(UNSAFE_getByProps({ name: 'add' })).toBeTruthy();
        });

        it('hides "+" new-chat button when single_chat_mode=true', () => {
            mockAuth = { ...DEFAULT_AUTH_CTX, user: { ...DEFAULT_AUTH_CTX.user, single_chat_mode: true } };
            const { UNSAFE_queryByProps } = renderScreen();
            expect(UNSAFE_queryByProps({ name: 'add' })).toBeNull();
        });
    });

    describe('search', () => {
        it('renders search input', () => {
            const { getByPlaceholderText } = renderScreen();
            expect(getByPlaceholderText('Search chats')).toBeTruthy();
        });

        it('filters chats by search query', () => {
            mockMain = {
                ...DEFAULT_MAIN_CTX,
                chats: [
                    makeChat({ id: 'a', title: 'Alpha chat', updated_at: 2000 }),
                    makeChat({ id: 'b', title: 'Beta chat', updated_at: 1000 }),
                ],
            };
            const { getByPlaceholderText, getByText, queryByText } = renderScreen();
            fireEvent.changeText(getByPlaceholderText('Search chats'), 'alpha');
            expect(getByText('Alpha chat')).toBeTruthy();
            expect(queryByText('Beta chat')).toBeNull();
        });

        it('shows clear button when query is non-empty', () => {
            const { getByPlaceholderText, UNSAFE_getByProps } = renderScreen();
            fireEvent.changeText(getByPlaceholderText('Search chats'), 'hello');
            expect(UNSAFE_getByProps({ name: 'close-circle' })).toBeTruthy();
        });

        it('clearing resets query', () => {
            const { getByPlaceholderText, UNSAFE_getByProps, queryByText } = renderScreen();
            mockMain = { ...DEFAULT_MAIN_CTX, chats: [makeChat({ id: 'a', title: 'Alpha chat', updated_at: 1 })] };
            const input = getByPlaceholderText('Search chats');
            fireEvent.changeText(input, 'z');
            const closeBtn = UNSAFE_getByProps({ name: 'close-circle' });
            fireEvent.press(closeBtn.parent);
            expect(input.props.value).toBe('');
        });
    });

    describe('filter chips', () => {
        it('renders "Genie" chip', () => {
            const { getByText } = renderScreen();
            expect(getByText('Genie')).toBeTruthy();
        });

        it('renders "Planner" chip', () => {
            const { getByText } = renderScreen();
            expect(getByText('Planner')).toBeTruthy();
        });

        it('renders "All" chip', () => {
            const { getByText } = renderScreen();
            expect(getByText('All')).toBeTruthy();
        });

        it('renders team chip from AVAILABLE_TEAMS', () => {
            const { getByText } = renderScreen();
            expect(getByText('Genie Team')).toBeTruthy();
        });

        it('pressing "All" chip calls setSidebarFilter("all")', () => {
            const setSidebarFilter = jest.fn();
            mockMain = { ...DEFAULT_MAIN_CTX, setSidebarFilter };
            const { getByText } = renderScreen();
            fireEvent.press(getByText('All'));
            expect(setSidebarFilter).toHaveBeenCalledWith('all');
        });

        it('pressing "Planner" chip calls setSidebarFilter("planner")', () => {
            const setSidebarFilter = jest.fn();
            mockMain = { ...DEFAULT_MAIN_CTX, setSidebarFilter };
            const { getByText } = renderScreen();
            fireEvent.press(getByText('Planner'));
            expect(setSidebarFilter).toHaveBeenCalledWith('planner');
        });
    });

    describe('chat list', () => {
        it('shows "No chats yet" when list is empty', () => {
            mockMain = { ...DEFAULT_MAIN_CTX, chats: [], chatsLoading: false };
            const { getByText } = renderScreen();
            expect(getByText('No chats yet')).toBeTruthy();
        });

        it('shows "Loading..." when chatsLoading=true', () => {
            mockMain = { ...DEFAULT_MAIN_CTX, chats: [], chatsLoading: true };
            const { getByText } = renderScreen();
            expect(getByText('Loading...')).toBeTruthy();
        });

        it('renders chat title', () => {
            mockMain = { ...DEFAULT_MAIN_CTX, chats: [makeChat({ id: 'c1', title: 'My First Chat', updated_at: 1 })] };
            const { getByText } = renderScreen();
            expect(getByText('My First Chat')).toBeTruthy();
        });

        it('renders badge "Genie" when sidebarFilter="all" for agent chat', () => {
            mockMain = {
                ...DEFAULT_MAIN_CTX,
                chats: [makeChat({ id: 'c1', title: 'Agent chat', mode: 'agent', updated_at: 1 })],
                sidebarFilter: 'all',
            };
            const { getAllByText } = renderScreen();
            // "Genie" appears in both filter chip and badge — expect at least 2
            expect(getAllByText('Genie').length).toBeGreaterThanOrEqual(2);
        });

        it('renders badge "Team" for team chats when sidebarFilter="all"', () => {
            mockMain = {
                ...DEFAULT_MAIN_CTX,
                chats: [makeChat({ id: 'c2', title: 'Team chat', mode: 'team', team_id: 'genie_team', updated_at: 1 })],
                sidebarFilter: 'all',
            };
            const { getAllByText } = renderScreen();
            // "Genie Team" appears in both filter chip and badge — expect at least 2
            expect(getAllByText('Genie Team').length).toBeGreaterThanOrEqual(2);
        });

        it('renders people icon for team chat', () => {
            mockMain = {
                ...DEFAULT_MAIN_CTX,
                chats: [makeChat({ id: 'c3', title: 'Team', mode: 'team', updated_at: 1 })],
                sidebarFilter: 'all',
            };
            const { UNSAFE_getByProps } = renderScreen();
            expect(UNSAFE_getByProps({ name: 'people' })).toBeTruthy();
        });

        it('renders sparkles icon for agent chat with no custom icon', () => {
            mockMain = {
                ...DEFAULT_MAIN_CTX,
                chats: [makeChat({ id: 'c4', title: 'Agent', mode: 'agent', icon: undefined, updated_at: 1 })],
            };
            const { UNSAFE_getByProps } = renderScreen();
            expect(UNSAFE_getByProps({ name: 'sparkles' })).toBeTruthy();
        });
    });

    describe('navigation', () => {
        it('pressing a chat navigates to ChatDetail', () => {
            mockMain = { ...DEFAULT_MAIN_CTX, chats: [makeChat({ id: 'c5', title: 'Nav Chat', updated_at: 1 })] };
            const { getByText } = renderScreen();
            fireEvent.press(getByText('Nav Chat'));
            expect(mockNavigate).toHaveBeenCalledWith('ChatDetail', { chatId: 'c5' });
        });

        it('pressing "+" navigates to ChatDetail with emptyChatID', () => {
            mockAuth = { ...DEFAULT_AUTH_CTX, user: { ...DEFAULT_AUTH_CTX.user, single_chat_mode: false } };
            const { UNSAFE_getByProps } = renderScreen();
            fireEvent.press(UNSAFE_getByProps({ name: 'add' }).parent);
            expect(mockNavigate).toHaveBeenCalledWith('ChatDetail', {
                chatId: '00000000-0000-0000-0000-000000000000',
            });
        });
    });

    describe('long-press actions', () => {
        it('long-pressing calls ActionSheetIOS.showActionSheetWithOptions', () => {
            const mockShowActionSheet = jest.fn();
            jest.spyOn(require('react-native').ActionSheetIOS, 'showActionSheetWithOptions')
                .mockImplementation(mockShowActionSheet);
            mockMain = { ...DEFAULT_MAIN_CTX, chats: [makeChat({ id: 'c6', title: 'Long Chat', updated_at: 1 })] };
            const { getByText } = renderScreen();
            fireEvent(getByText('Long Chat'), 'longPress');
            expect(mockShowActionSheet).toHaveBeenCalledTimes(1);
        });

        it('delete option calls deleteChat', () => {
            const deleteChat = jest.fn();
            jest.spyOn(require('react-native').ActionSheetIOS, 'showActionSheetWithOptions')
                .mockImplementation((_opts, cb) => cb(1)); // idx=1 → Delete
            mockMain = {
                ...DEFAULT_MAIN_CTX, deleteChat,
                chats: [makeChat({ id: 'c7', title: 'Delete Me', updated_at: 1 })],
            };
            const { getByText } = renderScreen();
            fireEvent(getByText('Delete Me'), 'longPress');
            expect(deleteChat).toHaveBeenCalledWith('c7');
        });
    });
});
