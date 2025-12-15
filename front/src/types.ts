export type Message = {
    id: string;
    chat_id: string;
    sender: string;
    role: 'user' | 'assistant' | 'system';
    text: string;
    tool_calls?: ToolCall[];
    model?: string;
};

export type ToolCall = {
    name: string;
    arguments?: any;
    result?: any;
};

export type Chat = {
    id: string;
    title: string;
    created_at: number;
    messages?: Message[];
};
