export interface InboxAction {
    label: string;
    command: string;
    agent?: string;
    url?: string;
    prompt?: string;
    why?: string;
}

export interface InboxImportance {
    level: 'low' | 'medium' | 'high';
    reason: string;
}

export interface InboxUrgency {
    level: 'urgent' | 'soon' | 'can_wait';
    reason: string;
}

export interface InboxResponseData {
    title: string;
    importance: InboxImportance;
    urgency: InboxUrgency;
    summary: string;
    actions: InboxAction[];
    missing_info?: string;
}

export interface InboxMessage {
    id: string;
    source: string;
    sender: string;
    subject: string;
    snippet: string;
    body: string;
    response?: string | InboxResponseData;
    status: 'pending' | 'processed' | 'archived' | 'read';
    received_at: string;
    created_at?: string;
    updated_at?: string;
}

export interface InboxPaginatedResponse {
    messages: InboxMessage[];
    page: number;
    limit: number;
    total_count: number;
    total_pages: number;
}

// Модели для чатов плагинов
export interface PluginChat {
    id: string;
    pluginId: string;
    title: string;
    lastMessage?: string;
    lastMessageAt?: number;
    unreadCount: number;
    metadata?: Record<string, any>;
}

export interface Plugin {
    id: string;
    provider: string;
    name: string;
    icon?: string;
    color?: string;
    chats: PluginChat[];
}

export interface PluginChatMessage {
    id: string;
    thread_id?: string | number;
    title?: string;
    summary?: string;
    content?: string;
    actions?: InboxAction[];
    importance?: string;
    status?: string;
    received_at?: string;
}

export interface SidebarEntry {
    id: string;
    thread_id: number;
    title: string;
    preview: string;
}

export interface SidebarItem {
    integration_id: string;
    name: string;
    provider: string;
    entries: SidebarEntry[];
}

export interface SidebarResponse {
    items: SidebarItem[];
}

export interface SidebarChat {
    chat_id: string | number;
    title: string;
    last_received?: string;
    count?: number;
}

export interface SidebarChatsResponse {
    provider: string;
    chats: SidebarChat[];
}

export interface SidebarChatMessagesResponse {
    provider: string;
    chat_id: string | number;
    messages: PluginChatMessage[];
}
