export interface InboxAction {
    label: string;
    why: string;
    command: string;
    agent: string;
    url?: string;
    prompt?: string;
}

export interface InboxImportance {
    level: 'low' | 'medium' | 'high';
    reason: string;
}

export interface InboxUrgency {
    level: 'can_wait' | 'soon' | 'immediate';
    reason: string;
}

export interface InboxResponseData {
    title: string;
    importance: InboxImportance;
    urgency: InboxUrgency;
    summary: string;
    actions: InboxAction[];
    missing_info: string;
}

export interface InboxMessage {
    id: string;
    sender: string;
    subject: string;
    snippet: string;
    body: string;
    response?: string | InboxResponseData;
    status: string;
    received_at: string;
    created_at: string;
    updated_at: string;
}

export interface InboxPaginatedResponse {
    messages: InboxMessage[];
    page: number;
    limit: number;
    total_count: number;
    total_pages: number;
}
