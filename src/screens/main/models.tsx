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
