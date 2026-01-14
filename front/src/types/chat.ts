/**
 * Chat-specific types and interfaces
 */

export type DetailLevel = 'hide' | 'tool_calls' | 'think' | 'all';

export interface ChatContextType {
    // Messages and state
    messages: Message[];
    messagesLoading: boolean;
    currentMessageID: string | null;
    assistantWorking: boolean;

    // Chat settings
    chatMode: 'agent' | 'team';
    teamCommand: any;
    activeAgentsCount: number;

    // Model selection
    availableModels: Model[];
    selectedModel: string | null;
    setSelectedModel: (model: string, isManual?: boolean) => void;

    // Error handling
    error: string | null;
    lastFailedMessage: {
        text: string;
        attachments?: any[];
        messageId?: string;
        webSearch?: boolean;
        thinking?: string;
    } | null;

    // Display settings
    thinkingLevel: string;
    showToolCalls: boolean;
    showReasoning: boolean;
    showMemberResponses: boolean;
    detailLevel: DetailLevel;
    setDetailLevel: (level: DetailLevel) => void;

    // Plugin integration
    externalTitle: string | null;
    pluginThreadMeta: {
        provider: string;
        chatId: string | number;
        integrationId?: string;
        integrationName?: string | null;
    } | null;

    // Teams
    selectedTeamId: string | null;
    selectTeam: (teamId: string) => void;

    // Actions
    sendMessage: (text: string, options?: {
        attachments?: any[];
        webSearch?: boolean;
        thinking?: string;
        model?: string;
        tools?: any[];
        mode?: 'agent' | 'team';
        teamId?: string;
    }) => void;
    retryMessage: (messageId: string) => void;
    editMessage: (messageId: string, newText: string) => void;
    stopGeneration: () => void;

    // Utility
    mapPluginMessage: (msg: any, provider: string, fallbackRole?: 'assistant' | 'user') => Message;
}

export interface MainContextType {
    chats: Chat[];
    chatsLoading: boolean;
    activeChatID: string | null;
    activeChat: Chat | null;
    getChats: (options?: GetChatsOptions) => Promise<void>;
    createNewChat: () => void;
    createNewChatWithMode: (mode: 'agent' | 'team', teamId: string | null) => void;
    renameChat: (chatId: string, newTitle: string) => Promise<void>;
    deleteChat: (chatId: string) => void;
    setActiveChatID: (id: string | null) => void;
    sidebarFilter: string;
    setSidebarFilter: (filter: string) => void;
    pendingChatMode?: { mode: 'agent' | 'team'; teamId: string | null; initialMessage?: string } | null;
    clearPendingChatMode?: () => void;
    newTaskModalVisible: boolean;
    setNewTaskModalVisible: (visible: boolean) => void;
}

export type GetChatsOptions = {
    preserveActiveChat?: boolean;
};

export interface TeamDetails {
    id: string;
    name: string;
    description: string;
    members: string[];
}

// Props types
export interface ChatProviderProps {
    children: React.ReactNode;
    activeChatID: string | null;
    setActiveChatID: (id: string | null) => void;
}

// Import Message, Chat, Model from api types
import { Message, Chat, Frame, ContentPart, TextPart, ToolCallPart, ReasoningPart, MemberResponsePart } from './api';
import { Model } from './integrations';