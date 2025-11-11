export type Message = {
    id: string;
    chat_id: string;
    sender: string;
    role: 'user' | 'assistant' | 'system';
    text: string;
};

export type Chat = {
    id: string;
    title: string;
    created_at: number;
    messages?: Message[];
};
