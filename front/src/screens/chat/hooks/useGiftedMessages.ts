import { useMemo } from 'react';
import { IMessage } from 'react-native-gifted-chat';
import { Message as GenieMessage, Attachment } from '../../main/models';

export interface ExtendedIMessage extends IMessage {
    tool_calls?: any[];
    model?: string;
    attachments?: Attachment[];
    actions?: any[];
    content_parts?: any[];
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
            const isSystemMessage = msg.role === 'system';

            let userIdMapped = 'assistant';
            let userName = 'Assistant';
            if (isUserMessage) {
                userIdMapped = userId || 'user';
                userName = 'You';
            } else if (isSystemMessage) {
                userIdMapped = 'system';
                userName = 'System';
            }

            return {
                _id: String(msg.id || `${msg.created_at} -${msg.role} `),
                text: msg.text || '',
                createdAt: new Date(msg.created_at || Date.now()),
                user: {
                    _id: userIdMapped,
                    name: userName,
                },
                tool_calls: msg.tool_calls,
                model: msg.model,
                attachments: msg.attachments,
                actions: msg.actions,
                content_parts: msg.content_parts,
                pending: msg.pending,
            };
        });
    }, [messages, userId]);
}
