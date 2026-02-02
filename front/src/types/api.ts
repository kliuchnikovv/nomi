/**
 * Core API types shared across the application
 */

export interface Message {
    id: string;
    chat_id: string;
    sender: string;
    role: 'user' | 'assistant' | 'system' | 'daemon';
    text: string;
    created_at: number;
    tool_calls?: ToolCall[];
    model?: string;
    attachments?: Attachment[];
    actions?: Action[];
    importance?: string;
    metadata?: Record<string, any>;
}

export interface ToolCall {
    id?: string;
    name: string;
    arguments?: any;
    result?: any;
    status?: string;
}

export interface Action {
    label: string;
    action: string;
    parameters?: Record<string, any>;
}

export interface Attachment {
    id: string;
    file_name: string;
    file_type: string;
    size: number;
    content?: string;
    uri?: string;
}

export interface Chat {
    id: string;
    model: string;
    title: string;
    mode: 'agent' | 'team';
    team_id: string | null;
    created_at: number;
    updated_at: number;
    archived_at: number | null;
    deleted_at: number | null;
    messages: Message[];
    icon?: string;
}

// WebSocket Frame types
export interface Frame {
    id: number;
    chat_id?: string;
    kind: 'data' | 'meta' | 'signal' | 'error';
    op: 'message' | 'ping' | 'done' | 'tools' | 'history' | 'stop';
    payload: any;
}

// Content parts for rich messages
export type TextPart = {
    type: 'text';
    text: string;
};

export type ToolCallPart = {
    type: 'tool_call';
    tool_call: ToolCall;
};

export type ReasoningPart = {
    type: 'reasoning';
    reasoning: string;
};

export type MemberResponsePart = {
    type: 'member_response';
    member_name: string;
    content: string;
};

export type ContentPart = TextPart | ToolCallPart | ReasoningPart | MemberResponsePart;