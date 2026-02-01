/**
 * Integration and connector types
 */

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
    supports_thinking?: boolean;
}

export interface ModelsResponse {
    models: ModelDetail[];
}

// Connectors and integrations
export interface Connector {
    id: string;
    name: string;
    description: string;
    type: string;
    icon?: string;
    auth_url?: string;
    status: OAuthStatus;
    connected: boolean;
}

export type StorageType = 'client' | 'server' | 'hybrid';

export interface Integration {
    id: string;
    type: string;
    name: string;
    email?: string;
    status: 'connected' | 'disconnected' | 'error';
    created_at: string;
    updated_at: string;
    storageType?: StorageType; // Тип хранения данных
    supportsBackgroundTasks?: boolean; // Поддерживает ли фоновые процессы
    systemEventListeners?: string[]; // Список системных событий
}

export interface Tool {
    id: string;
    name: string;
    description: string;
    enabled: boolean;
    integration_id?: string;
}

export type OAuthStatus = 'not_connected' | 'connecting' | 'connected' | 'error';

// Connector context
export interface ConnectorContextType {
    connectors: Connector[];
    integrations: Integration[];
    tools: Tool[];
    loading: boolean;
    error: string | null;
    refreshConnectors: () => Promise<void>;
    refreshIntegrations: () => Promise<void>;
    refreshTools: () => Promise<void>;
    connect: (connectorId: string) => Promise<void>;
    disconnect: (connectorId: string) => Promise<void>;
}

// Client tool executor
export interface ClientToolAction {
    type: string;
    payload: Record<string, any>;
    toolName: string;
}

// Gmail client types
export interface GmailMessage {
    id: string;
    threadId: string;
    labelIds: string[];
    snippet: string;
    payload: {
        headers: Array<{
            name: string;
            value: string;
        }>;
        body?: {
            size: number;
            data?: string;
        };
        parts?: any[];
    };
    sizeEstimate: number;
    historyId: string;
    internalDate: string;
}

export interface GmailListResponse {
    messages: Array<{
        id: string;
        threadId: string;
    }>;
    nextPageToken?: string;
    resultSizeEstimate: number;
}

// Calendar client types
export interface CalendarEvent {
    id: string;
    summary: string;
    description?: string;
    start: {
        dateTime?: string;
        date?: string;
        timeZone?: string;
    };
    end: {
        dateTime?: string;
        date?: string;
        timeZone?: string;
    };
    location?: string;
    attendees?: Array<{
        email: string;
        displayName?: string;
        responseStatus: string;
    }>;
    status: string;
    created: string;
    updated: string;
}

export interface CalendarListResponse {
    items: CalendarEvent[];
}

// Database and vector store
export interface VectorDocument {
    id: string;
    content: string;
    metadata: Record<string, any>;
    embedding?: number[];
}

export interface SearchResult {
    document: VectorDocument;
    score: number;
}

// Integration storage types
export interface IntegrationCredentials {
    access_token: string;
    refresh_token?: string;
    expires_at?: number;
    scope?: string;
}

export interface Email {
    id: string;
    subject: string;
    from: string;
    to: string[];
    date: string;
    body: string;
    thread_id?: string;
}

export interface GeneratedContent {
    type: string;
    content: string;
    metadata?: Record<string, any>;
}

export interface ExtractedEvent {
    id: string;
    title: string;
    description?: string;
    start_time: string;
    end_time?: string;
    location?: string;
    attendees?: string[];
}

export interface ExtractedTask {
    id: string;
    title: string;
    description?: string;
    due_date?: string;
    priority: 'low' | 'medium' | 'high' | 'urgent';
}

export interface AnalyzedEmail {
    id: string;
    importance: 'low' | 'medium' | 'high';
    urgency: 'low' | 'medium' | 'high';
    category: string;
    summary: string;
    action_required: boolean;
    suggested_response?: string;
}

export interface Briefing {
    id: string;
    date: string;
    user_id: string;
    items: BriefingItem[];
    created_at: string;
}

export interface BriefingItem {
    id: string;
    type: 'event' | 'task' | 'email' | 'meeting';
    title: string;
    description?: string;
    priority: 'asap' | 'today' | 'this_week' | 'later';
    source_type: 'email' | 'calendar' | 'task' | 'manual';
    source_id: string;
    due_date?: string;
    completed: boolean;
    completed_at?: string;
    suggested_actions?: SuggestedAction[];
}

export interface SuggestedAction {
    id: string;
    type: 'reply' | 'schedule' | 'task' | 'ignore';
    title: string;
    description?: string;
    parameters?: Record<string, any>;
}