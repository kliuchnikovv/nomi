import { Chat, Message } from '../main/models';
import { ReactNode } from 'react';

export type Props = {
    children: ReactNode;
    activeChatID: string;
    setActiveChatID: (id: string) => void;
};

export interface MainContextType {
    chats: Chat[];
    activeChatID: string | null;
    activeChat: Chat | null;
    getChats: () => void;
    getMessages: (chatId: string) => void;
    sendMessage: (text: string) => void;
    createNewChat: () => void;
    deleteChat: (chatId: string) => void;
    setActiveChatID: (id: string) => void;
}

export interface ChatContextType {
    messages: Message[];
    getMessages: (chatId: string) => void;
    sendMessage: (text: string) => void;
    assistantWorking: boolean;
    selectedModel: string | null;
    setSelectedModel: (model: string) => void;
    availableModels: Model[];
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
