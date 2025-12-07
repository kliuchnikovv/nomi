export type GetChatsOptions = {
    preserveActiveChat?: boolean;
};

export interface MainContextType {
    chats: Chat[];
    chatsLoading: boolean;
    activeChatID: string | null;
    activeChat: Chat | null;
    getChats: (options?: GetChatsOptions) => Promise<void>;
    createNewChat: () => void;
    renameChat: (chatId: string, newTitle: string) => Promise<void>;
    deleteChat: (chatId: string) => void;
    setActiveChatID: (id: string | null) => void;
}

export type Chat = {
    id: string
    model: string
    title: string
    created_at: number
    updated_at: number
    archived_at: number | null
    deleted_at: number | null
    messages: Message[]
}

export type Message = {
    id: string
    chat_id: string
    sender: string
    role: string
    text: string
    created_at: number
    actions?: any[]
    importance?: string
    metadata?: Record<string, any>
    tool_calls?: any[]
    model?: string
}

export type Frame = {
    id: number
    chat_id: string
    timestamp: number
    channel: string
    kind: string
    op: string
    payload: any
    error: any
}
