import { useMemo } from 'react';
import { IMessage } from 'react-native-gifted-chat';
import { Message as GenieMessage, Attachment } from '../../main/models';

export interface ExtendedIMessage extends IMessage {
    tool_calls?: any[];
    model?: string;
    attachments?: Attachment[];
}

const getTimestamp = (value?: number | string | null) => {
    if (!value) {
        return 0;
    }
    if (typeof value === 'number') {
        return value;
    }
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
};

export function useGiftedMessages(messages: GenieMessage[], userId?: string) {
    return useMemo(() => {
        const sorted = [...messages].sort((a, b) => getTimestamp(b.created_at) - getTimestamp(a.created_at));

        return sorted.map((msg): ExtendedIMessage => {
            const isUserMessage = msg.role === 'user';

            return {
                _id: String(msg.id || `${msg.created_at} -${msg.role} `),
                text: msg.text.trimEnd() || '',
                createdAt: new Date(msg.created_at || Date.now()),
                user: {
                    _id: isUserMessage ? (userId || 'user') : 'assistant',
                    name: isUserMessage ? 'You' : 'Assistant',
                },
                tool_calls: msg.tool_calls,
                model: msg.model,
                attachments: msg.attachments,
            };
        });
    }, [messages, userId]);
}
