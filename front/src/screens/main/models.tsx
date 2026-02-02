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
    createNewChatWithMode: (mode: 'agent' | 'team', teamId: string | null) => void;
    renameChat: (chatId: string, newTitle: string) => Promise<void>;
    deleteChat: (chatId: string) => void;
    setActiveChatID: (id: string | null) => void;
    sidebarFilter: string;
    setSidebarFilter: (filter: string) => void;
    pendingChatMode?: { mode: 'agent' | 'team'; teamId: string | null; initialMessage?: string } | null;
    clearPendingChatMode?: () => void;
}

export type Chat = {
    id: string
    model: string
    title: string
    mode: 'agent' | 'team'     // 'agent' or 'team'
    team_id: string | null     // null for agent mode
    created_at: number
    updated_at: number
    archived_at: number | null
    deleted_at: number | null
    list_id?: string | null
    messages: Message[]
    icon?: string
}

export type Attachment = {
    id: string
    file_name: string
    file_type: string
    size: number
    content?: string
    uri?: string
}

export type MessageAction = {
    label: string
    command: string
    url?: string | null
    prompt?: string | null
    agent?: string
    why?: string
}

// Content part types for inline tool call rendering
export type TextPart = {
    type: 'text';
    text: string;
};

export type ToolCallPart = {
    type: 'tool_call';
    tool_call: any;
};

export type ReasoningPart = {
    type: 'reasoning';
    reasoning: string;
};

export type ContentPart = TextPart | ToolCallPart | ReasoningPart;

export type Message = {
    id: string
    chat_id: string
    sender: string
    role: string
    text: string
    agent_id?: string // For multi-agent teams
    created_at: number
    actions?: MessageAction[]
    importance?: string
    metadata?: Record<string, any>
    tool_calls?: any[]
    reasoning_steps?: string[]  // Reasoning/thinking content
    content_parts?: ContentPart[] // For inline tool call rendering
    model?: string
    attachments?: Attachment[]
    /** Last processed stream chunk index (ix); used for dedup when same frame arrives from multiple channels. */
    _stream_ix?: number
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
