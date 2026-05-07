import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { ChatDetailScreen } from '../../src/screens/chat/chatDetail/ChatDetailScreen';
import {
    DEFAULT_CHAT_CTX, DEFAULT_MAIN_CTX, DEFAULT_AUTH_CTX, MOCK_THEME, MOCK_INSETS, makeChat,
} from './chatMocks';

// ── Heavy dependency mocks ────────────────────────────────────────────────────

jest.mock('react-native-keyboard-controller', () => ({
    KeyboardProvider: ({ children }) => children,
    useKeyboardHandler: jest.fn(),
    useKeyboardController: jest.fn(),
    useReanimatedKeyboardAnimation: () => ({ height: { value: 0 } }),
}));

jest.mock('react-native-reanimated', () => {
    const Reanimated = require('react-native-reanimated/mock');
    Reanimated.default.call = () => {};
    return Reanimated;
});

jest.mock('../../src/screens/chat/theme', () => ({
    ASSISTANT_BUBBLE_WIDTH_RATIO: 0.75,
    createChatTheme: () => ({}),
}));

jest.mock('../../src/screens/chat/styles', () => ({
    createStyles: () => ({
        container: {}, header: {}, menuButton: {}, headerAvatar: {},
        headerAvatarText: {}, headerBody: {}, headerTitle: {}, headerSubtitle: {},
    }),
}));

jest.mock('../../src/screens/chat/hooks/useGiftedChatRenderers', () => ({
    useGiftedChatRenderers: () => ({
        renderBubble: () => null, renderFooter: () => null,
        renderInputToolbar: () => null, renderMessage: () => null,
        renderMessageText: () => null, onLongPressMessage: jest.fn(),
    }),
}));

jest.mock('../../src/screens/chat/chatDetail/ProjectSuggestionBanner', () => ({
    ProjectSuggestionBanner: ({ project, onAccept, onDismiss, showNoButton }) => {
        const { View, Text, TouchableOpacity } = require('react-native');
        return (
            <View testID="project-suggestion-banner">
                <Text testID="project-name">{project.name}</Text>
                <TouchableOpacity testID="accept-btn" onPress={onAccept}><Text>Add</Text></TouchableOpacity>
                <TouchableOpacity testID="dismiss-btn" onPress={onDismiss}>
                    <Text>{showNoButton ? 'No' : 'Dismiss'}</Text>
                </TouchableOpacity>
            </View>
        );
    },
}));

jest.mock('../../src/screens/chat/chatDetail/PersistentChatEmptyState', () => ({
    PersistentChatEmptyState: () => {
        const { View, Text } = require('react-native');
        return <View testID="empty-state"><Text>Hello!</Text></View>;
    },
    useChips: () => [],
}));

jest.mock('../../src/screens/chat/chatDetail/SessionHistorySheet', () => ({
    SessionHistorySheet: ({ visible, onClose }) => {
        const { View, Text, TouchableOpacity } = require('react-native');
        if (!visible) return null;
        return (
            <View testID="history-sheet">
                <TouchableOpacity onPress={onClose}><Text>Close</Text></TouchableOpacity>
            </View>
        );
    },
    formatSessionDate: (ts) => `date-${ts}`,
}));

jest.mock('../../src/screens/chat/components/DiceRollOverlay', () => ({
    DiceRollOverlay: () => null,
}));

jest.mock('../../src/screens/chat/components/AskUserDialog', () => ({
    AskUserDialog: () => null,
}));

jest.mock('../../src/utils/ToastContainer', () => ({ ToastContainer: () => null }));

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockReplace = jest.fn();

jest.mock('@react-navigation/native', () => ({
    useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack, replace: mockReplace }),
    useRoute: () => ({ params: { chatId: 'chat-1' } }),
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

jest.mock('../../src/context/ThemeContext', () => ({ useTheme: () => MOCK_THEME }));

let mockChatCtx = { ...DEFAULT_CHAT_CTX };
jest.mock('../../src/screens/chat/context', () => ({ useChat: () => mockChatCtx }));

let mockMainCtx = { ...DEFAULT_MAIN_CTX };
jest.mock('../../src/screens/main/context', () => ({
    useMain: () => mockMainCtx,
    emptyChatID: '00000000-0000-0000-0000-000000000000',
}));

let mockAuthCtx = { ...DEFAULT_AUTH_CTX };
jest.mock('../../src/screens/auth/context', () => ({ useAuth: () => mockAuthCtx }));

jest.mock('../../src/screens/chat/AskUserContext', () => ({
    useAskUser: () => ({
        showDialog: jest.fn(() => Promise.resolve('ok')),
        dialogState: { visible: false, question: '', options: [] },
        submitResponse: jest.fn(),
        cancelDialog: jest.fn(),
    }),
}));

jest.mock('../../src/apiClient', () => ({
    sidebarApi: { executeMessageAction: jest.fn() },
    projectsApi: { list: jest.fn(() => Promise.resolve([])) },
    apiClient: { get: jest.fn(() => Promise.resolve([])) },
    chatsApi: { getPersistentChats: jest.fn(() => Promise.resolve([])) },
}));

jest.mock('../../src/navigation/MainTabs', () => ({ TAB_BAR_ICON_HEIGHT: 60 }));
jest.mock('../../src/screens/chat/teams', () => ({
    AVAILABLE_TEAMS: [{ id: 'genie_team', name: 'Genie Team', isAgent: false }],
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderScreen() {
    return render(<ChatDetailScreen />);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ChatDetailScreen', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockChatCtx = { ...DEFAULT_CHAT_CTX };
        mockMainCtx = { ...DEFAULT_MAIN_CTX, activeChat: makeChat({ id: 'chat-1', title: 'My Chat' }) };
        mockAuthCtx = { ...DEFAULT_AUTH_CTX };
    });

    describe('header', () => {
        it('renders back button (chevron-back icon)', () => {
            const { UNSAFE_getByProps } = renderScreen();
            expect(UNSAFE_getByProps({ name: 'chevron-back' })).toBeTruthy();
        });

        it('pressing back button calls navigation.goBack()', () => {
            const { UNSAFE_getByProps } = renderScreen();
            fireEvent.press(UNSAFE_getByProps({ name: 'chevron-back' }).parent);
            expect(mockGoBack).toHaveBeenCalledTimes(1);
        });

        it('renders chat title from activeChat', () => {
            const { getByText } = renderScreen();
            expect(getByText('My Chat')).toBeTruthy();
        });

        it('renders new-chat button (create-outline) always', () => {
            const { UNSAFE_getByProps } = renderScreen();
            expect(UNSAFE_getByProps({ name: 'create-outline' })).toBeTruthy();
        });

        it('pressing new-chat calls navigation.replace with emptyChatID', () => {
            const { UNSAFE_getByProps } = renderScreen();
            fireEvent.press(UNSAFE_getByProps({ name: 'create-outline' }).parent);
            expect(mockReplace).toHaveBeenCalledWith('ChatDetail', {
                chatId: '00000000-0000-0000-0000-000000000000',
            });
        });
    });

    describe('single_chat_mode=false (default)', () => {
        it('does NOT render history (time-outline) button', () => {
            mockAuthCtx = { ...DEFAULT_AUTH_CTX, user: { ...DEFAULT_AUTH_CTX.user, single_chat_mode: false } };
            const { UNSAFE_queryByProps } = renderScreen();
            expect(UNSAFE_queryByProps({ name: 'time-outline' })).toBeNull();
        });

        it('does NOT render SessionHistorySheet', () => {
            mockAuthCtx = { ...DEFAULT_AUTH_CTX, user: { ...DEFAULT_AUTH_CTX.user, single_chat_mode: false } };
            const { queryByTestId } = renderScreen();
            expect(queryByTestId('history-sheet')).toBeNull();
        });
    });

    describe('single_chat_mode=true', () => {
        beforeEach(() => {
            mockAuthCtx = { ...DEFAULT_AUTH_CTX, user: { ...DEFAULT_AUTH_CTX.user, single_chat_mode: true } };
        });

        it('renders history (time-outline) button', () => {
            const { UNSAFE_getByProps } = renderScreen();
            expect(UNSAFE_getByProps({ name: 'time-outline' })).toBeTruthy();
        });

        it('pressing history button opens SessionHistorySheet', () => {
            const { UNSAFE_getByProps, getByTestId } = renderScreen();
            fireEvent.press(UNSAFE_getByProps({ name: 'time-outline' }).parent);
            expect(getByTestId('history-sheet')).toBeTruthy();
        });

        it('closing history sheet hides it again', () => {
            const { UNSAFE_getByProps, getByText, queryByTestId } = renderScreen();
            fireEvent.press(UNSAFE_getByProps({ name: 'time-outline' }).parent);
            fireEvent.press(getByText('Close'));
            expect(queryByTestId('history-sheet')).toBeNull();
        });
    });

    describe('empty state', () => {
        it('renders PersistentChatEmptyState when isNewSession=true and no messages', () => {
            mockChatCtx = { ...DEFAULT_CHAT_CTX, messages: [], isNewSession: true };
            mockMainCtx = { ...DEFAULT_MAIN_CTX, isNewSession: true, activeChat: null };
            const { getByTestId } = renderScreen();
            expect(getByTestId('empty-state')).toBeTruthy();
        });

        it('does NOT render PersistentChatEmptyState when there are messages', () => {
            mockChatCtx = { ...DEFAULT_CHAT_CTX, messages: [
                { id: 'm1', chat_id: 'chat-1', role: 'user', text: 'hi', created_at: 1 },
            ], isNewSession: true };
            const { queryByTestId } = renderScreen();
            expect(queryByTestId('empty-state')).toBeNull();
        });

        it('does NOT render PersistentChatEmptyState when isNewSession=false', () => {
            mockChatCtx = { ...DEFAULT_CHAT_CTX, messages: [], isNewSession: false };
            mockMainCtx = { ...DEFAULT_MAIN_CTX, isNewSession: false, activeChat: null };
            const { queryByTestId } = renderScreen();
            expect(queryByTestId('empty-state')).toBeNull();
        });
    });

    describe('ProjectSuggestionBanner — non-session', () => {
        it('NOT rendered when suggestedProjectId=null', async () => {
            mockChatCtx = { ...DEFAULT_CHAT_CTX, suggestedProjectId: null };
            const { queryByTestId } = renderScreen();
            await act(async () => {});
            expect(queryByTestId('project-suggestion-banner')).toBeNull();
        });

        it('rendered when suggestedProjectId is set and project resolves', async () => {
            const { projectsApi } = require('../../src/apiClient');
            projectsApi.list.mockResolvedValueOnce([
                { id: 'p1', name: 'Work', icon: '💼', description: 'Work tasks' },
            ]);
            mockChatCtx = {
                ...DEFAULT_CHAT_CTX,
                isNewSession: false,
                suggestedProjectId: 'p1',
                classifiedText: 'hello',
            };
            const { findByTestId } = renderScreen();
            expect(await findByTestId('project-suggestion-banner')).toBeTruthy();
        });

        it('pressing dismiss calls clearProjectSuggestion', async () => {
            const clearProjectSuggestion = jest.fn();
            const { projectsApi } = require('../../src/apiClient');
            projectsApi.list.mockResolvedValueOnce([
                { id: 'p1', name: 'Work', icon: '💼', description: 'x' },
            ]);
            mockChatCtx = {
                ...DEFAULT_CHAT_CTX,
                isNewSession: false,
                suggestedProjectId: 'p1',
                clearProjectSuggestion,
            };
            const { findByTestId } = renderScreen();
            const banner = await findByTestId('dismiss-btn');
            fireEvent.press(banner);
            expect(clearProjectSuggestion).toHaveBeenCalledTimes(1);
        });
    });

    describe('AskUserDialog registration', () => {
        it('sets globalThis.__askUserDialog after mount', () => {
            delete (globalThis as any).__askUserDialog;
            renderScreen();
            expect((globalThis as any).__askUserDialog).toBeDefined();
        });

        it('clears globalThis.__askUserDialog on unmount', () => {
            const { unmount } = renderScreen();
            unmount();
            expect((globalThis as any).__askUserDialog).toBeUndefined();
        });
    });
});
