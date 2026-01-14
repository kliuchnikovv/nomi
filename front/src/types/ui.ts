/**
 * UI and component types
 */

export interface SidebarProps {
    isVisible?: boolean;
    onClose?: () => void;
    side?: 'left' | 'right';
    children?: React.ReactNode;
}

export type SidebarSide = 'left' | 'right';

export interface ChatSidebarProps extends SidebarProps {
    chatId?: string;
}

export interface RightSidebarProps extends SidebarProps {
    activeTab?: string;
    onTabChange?: (tab: string) => void;
}

export interface DialogAction {
    label: string;
    onPress: () => void;
    style?: 'default' | 'destructive' | 'cancel';
}

export interface DialogProps {
    visible: boolean;
    title: string;
    message?: string;
    actions: DialogAction[];
    onRequestClose?: () => void;
}

export interface ContextMenuItem {
    label: string;
    onPress: () => void;
    destructive?: boolean;
    separator?: boolean;
}

export interface ActiveTask {
    id: string;
    title: string;
    description?: string;
    due_date?: string;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    status: 'pending' | 'in_progress' | 'completed';
    project_id?: string;
}

// Inbox types
export interface InboxAction {
    label: string;
    action: string;
    parameters?: Record<string, any>;
}

export interface InboxImportance {
    level: 'low' | 'medium' | 'high';
    score: number;
}

export interface InboxUrgency {
    level: 'low' | 'medium' | 'high';
    score: number;
}

export interface InboxResponseData {
    messages: InboxMessage[];
    total_count: number;
    unread_count: number;
}

export interface InboxMessage {
    id: string;
    subject: string;
    from: string;
    to: string[];
    date: string;
    snippet: string;
    importance: InboxImportance;
    urgency: InboxUrgency;
    category: string;
    read: boolean;
    actions?: InboxAction[];
    integration_id?: string;
    thread_id?: string;
}

export interface InboxPaginatedResponse {
    data: InboxResponseData;
    next_cursor?: string;
    has_more: boolean;
}

// Plugin chats
export interface PluginChat {
    id: string;
    provider: string;
    name: string;
    description?: string;
    status: 'active' | 'inactive';
    last_message_at?: string;
    created_at: string;
    updated_at: string;
}

export interface Plugin {
    id: string;
    name: string;
    description: string;
    icon?: string;
    type: string;
    enabled: boolean;
    config?: Record<string, any>;
}

export interface PluginChatMessage {
    id: string;
    plugin_chat_id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata?: Record<string, any>;
    created_at: string;
}

// Sidebar types
export interface SidebarEntry {
    id: string;
    type: 'chat' | 'plugin' | 'task';
    title: string;
    subtitle?: string;
    icon?: string;
    unread_count?: number;
    last_message_at?: string;
    metadata?: Record<string, any>;
}

export interface SidebarItem {
    id: string;
    name: string;
    type: string;
    icon?: string;
    unread_count?: number;
}

export interface SidebarResponse {
    items: SidebarItem[];
    total_count: number;
}

export interface SidebarChat {
    id: string;
    title: string;
    last_message?: string;
    unread_count: number;
    created_at: string;
    updated_at: string;
}

export interface SidebarChatsResponse {
    chats: SidebarChat[];
    total_count: number;
}

export interface SidebarChatMessagesResponse {
    messages: any[]; // TODO: Define proper message type
    total_count: number;
}