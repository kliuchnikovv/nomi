export type Props = {
    message: Message
    actions: Action[] | null
    header?: string | null
    importance?: string | null
    onActionPress?: (action: Action) => Promise<void>
}

export type Role = 'user' | 'assistant' | 'daemon' | 'system';

// Content part types for inline rendering
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
    agent_name: string;
    text: string;
};

export type ContentPart = TextPart | ToolCallPart | ReasoningPart | MemberResponsePart;

export type Message = {
    id: string
    chat_id: string
    sender: string
    role: Role
    text: string
    agent_id?: string
    created_at: number
    actions?: Action[]
    importance?: string
    metadata?: Record<string, any>
    tool_calls?: ToolCall[]
    content_parts?: ContentPart[] // For inline tool call rendering
    model?: string
    attachments?: Attachment[]
}

export type Attachment = {
    id: string
    file_name: string
    file_type: string
    size: number
    content?: string
    uri?: string
}

export type ToolCall = {
    name: string
    arguments?: any
    result?: any
}

export type Action = {
    message_id: string
    command: string
    label: string
    url?: string | null
    prompt?: string | null
    agent?: string | null
    why?: string
}

