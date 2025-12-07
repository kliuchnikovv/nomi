export type Props = {
    message: Message
    actions: Action[] | null
    header?: string | null
    importance?: string | null
    onActionPress?: (action: Action) => Promise<void>
}

export type Role = 'user' | 'assistant' | 'daemon';

export type Message = {
    id: string
    chat_id: string
    sender: string
    role: Role
    text: string
    created_at: number
    actions?: Action[]
    importance?: string
    metadata?: Record<string, any>
    tool_calls?: ToolCall[]
    model?: string
    attachments?: Attachment[]
}

export type Attachment = {
    id: string
    file_name: string
    file_type: string
    size: number
    content?: string
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

