import { Chat, GetChatsOptions, Message } from '../main/models';
import { ReactNode } from 'react';
import { PluginChatMessage } from '../rightsidebar/models';

export type Props = {
    children: ReactNode;
    activeChatID: string;
    setActiveChatID: (id: string) => void;
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
    getMessages: (chatId: string) => void;
    sendMessage: (text: string) => void;
    executeMessageAction: (action: { command: string; url?: string | null; prompt?: string | null; agent?: string | null }, messageId: string) => Promise<void>;
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
    pluginThreadMeta?: { provider: string; chatId: string | number; integrationId?: string; integrationName?: string | null } | null;
    selectedModel: string | null;
    setSelectedModel: (model: string) => void;
    availableModels: Model[];
    chatMode: 'agent' | 'team';
    setChatMode: (mode: 'agent' | 'team') => void;
    teamCommand: any;
    setTeamCommand: (command: any) => void;
    error: string | null;
    setError: (error: string | null) => void;
    retryLastMessage: () => void;
}

export interface Model {
    id: string;
    name: string;
    description?: string;
    provider?: string;
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
