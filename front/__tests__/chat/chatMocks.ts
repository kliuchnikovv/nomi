import type { Chat } from '../../src/screens/main/models';

export const MOCK_THEME = {
    theme: {
        background: '#fff', surface: '#f5f5f5', text: '#000', textPrimary: '#000',
        textSecondary: '#888', accent: '#7c3aed', border: '#e5e5ea',
        success: '#4caf50', info: '#2196f3', icon: '#888',
    },
    palette: { orange: '#ff9800' },
};

export const MOCK_INSETS = { top: 44, bottom: 34, left: 0, right: 0 };

export const DEFAULT_CHAT_CTX = {
    messages: [], messagesLoading: false, refreshing: false, assistantWorking: false,
    sendMessage: jest.fn(), retryLastMessage: jest.fn(), error: null, setError: jest.fn(),
    chatMode: 'agent' as const, setChatMode: jest.fn(), selectedModel: null, availableModels: [],
    setSelectedModel: jest.fn(), thinkingLevel: 'off', setThinkingLevel: jest.fn(),
    detailLevel: 'hide' as const, setDetailLevel: jest.fn(),
    showToolCalls: false, showReasoning: false, showMemberResponses: false,
    activeAgentsCount: 0, pendingInputText: null, setPendingInputText: jest.fn(),
    lastFailedMessage: null, suggestedProjectId: null, classifiedText: null,
    clearProjectSuggestion: jest.fn(), pendingMessage: null, suggestedProjectForSession: null,
    clearProjectSuggestionForSession: jest.fn(), confirmProjectSuggestionForSession: jest.fn(),
    isPluginThread: false, externalTitle: null, clearPluginThread: jest.fn(),
    selectedTeamId: null, selectTeam: jest.fn(), isNewSession: false,
    getMessages: jest.fn(), startPluginThread: jest.fn(),
};

export const DEFAULT_MAIN_CTX = {
    chats: [] as Chat[], chatsLoading: false, activeChatID: 'chat-1',
    setActiveChatID: jest.fn(), createNewChat: jest.fn(), createNewChatWithMode: jest.fn(),
    deleteChat: jest.fn(), renameChat: jest.fn(), getChats: jest.fn(),
    activeChat: null, sidebarFilter: 'agent', setSidebarFilter: jest.fn(),
    setChatIcon: jest.fn(), emptyChatID: '00000000-0000-0000-0000-000000000000',
    isNewSession: false, setIsNewSession: jest.fn(), pendingChatMode: null, setPendingChatMode: jest.fn(),
};

export const DEFAULT_AUTH_CTX = {
    user: { id: 'u1', name: 'Alice Smith', first_name: 'Alice', single_chat_mode: false },
    token: 'tok',
    refreshToken: jest.fn(),
    logout: jest.fn(),
};

export const DEFAULT_ASK_USER_CTX = {
    showDialog: jest.fn(() => Promise.resolve('option-1')),
    dialogState: null,
    submitResponse: jest.fn(),
    cancelDialog: jest.fn(),
};

export function makeChat(overrides: Partial<Chat> = {}): Chat {
    return {
        id: 'chat-1', title: 'Test Chat', mode: 'agent',
        created_at: Date.now() - 3600_000, updated_at: Date.now() - 60_000,
        ...overrides,
    };
}

export const COLORS = {
    accent: '#7c3aed', surface: '#f5f5f5', textPrimary: '#000',
    textSecondary: '#888', border: '#e5e5ea',
};
