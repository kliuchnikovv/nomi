import { Chat, GetChatsOptions, Message } from '../main/models';
import { ReactNode } from 'react';
import { PluginChatMessage } from '../integrationsSidebar/models';

export type DetailLevel = 'hide' | 'tool_calls' | 'think' | 'all';

export type Props = {
    children: ReactNode;
    activeChatID: string;
    setActiveChatID: (id: string) => void;
    /** When set, new chats created in this context will be assigned to this project. */
    initialProjectId?: string;
    /** When set, pre-populates the message input when the screen mounts. */
    initialPendingText?: string;
    /** When true, the provider treats the current chat as a brand-new session (no history). */
    isNewSession?: boolean;
    /** Called once the persistent chat has been created for a new session. */
    onSessionStarted?: () => void;
};

export interface MainContextType {
    chats: Chat[];
    activeChatID: string | null;
    activeChat: Chat | null;
    getChats: (options?: GetChatsOptions) => Promise<void>;
    createNewChat: () => void;
    deleteChat: (chatId: string) => void;
    setActiveChatID: (id: string | null) => void;
}

export interface ChatContextType {
    messages: Message[];
    messagesLoading: boolean;
    getMessages: (chatId: string, opts?: { isRefresh?: boolean }) => void;
    refreshing: boolean;
    sendMessage: (
        text: string,
        attachments?: any[],
        webSearch?: boolean,
        thinking?: string,
        role?: string,
        contextItems?: any[],
    ) => void;
    executeMessageAction: (
        action: {
            command: string;
            url?: string | null;
            prompt?: string | null;
            agent?: string | null;
        },
        messageId: string,
    ) => Promise<void>;
    assistantWorking: boolean;
    externalTitle?: string | null;
    startPluginThread: (args: {
        provider: string;
        chatId: string | number;
        title?: string | null;
        integrationId?: string;
        integrationName?: string | null;
        messages?: PluginChatMessage[];
    }) => Promise<void>;
    isPluginThread: boolean;
    pluginThreadMeta?: {
        provider: string;
        chatId: string | number;
        integrationId?: string;
        integrationName?: string | null;
    } | null;
    clearPluginThread: () => void;
    selectedModel: string | null;
    setSelectedModel: (model: string, isManual?: boolean) => void;
    availableModels: Model[];
    chatMode: 'agent' | 'team';
    setChatMode: (mode: 'agent' | 'team') => void;
    teamCommand: any;
    setTeamCommand: (command: any) => void;
    selectedTeamId: string | null;
    selectTeam: (teamId: string) => void;
    error: string | null;
    setError: (error: string | null) => void;
    retryLastMessage: () => void;
    isRateLimited: boolean;
    setIsRateLimited: (value: boolean) => void;
    thinkingLevel: string;
    setThinkingLevel: (level: string) => void;
    stopGeneration: () => void;
    // Display settings
    showToolCalls: boolean;
    setShowToolCalls: (show: boolean) => void;
    showReasoning: boolean;
    setShowReasoning: (show: boolean) => void;
    showMemberResponses: boolean;
    setShowMemberResponses: (show: boolean) => void;
    detailLevel: DetailLevel;
    setDetailLevel: (level: DetailLevel) => void;
    activeAgentsCount?: number;
    pendingInputText: string | null;
    setPendingInputText: (text: string | null) => void;
    lastFailedMessage: {
        text: string;
        attachments?: any[];
        messageId?: string;
        webSearch?: boolean;
        thinking?: string;
        contextItems?: any[];
    } | null;
    setLastFailedMessage: (
        msg: {
            text: string;
            attachments?: any[];
            messageId?: string;
            webSearch?: boolean;
            thinking?: string;
            contextItems?: any[];
        } | null,
    ) => void;
    generationStatus: string | null;
    // Project suggestion (shown after first message in a new chat)
    suggestedProjectId: string | null;
    classifiedText: string | null;
    clearProjectSuggestion: () => void;
    // Slash-command execution
    runCommand: (
        name: string,
        args: object,
    ) => Promise<import('../../commands/types').CommandResult>;
}

export interface Model {
    id: string;
    name: string;
    description?: string;
    provider?: string;
    supports_thinking?: boolean;
    supports_vision?: boolean;
    endpoint?: string;
}

export interface ModelDetail {
    id: string;
    name: string;
    provider: string;
    description: string;
    context_window: number;
    supports_streaming: boolean;
    supports_tools: boolean;
}

export interface ModelsResponse {
    models: ModelDetail[];
}
