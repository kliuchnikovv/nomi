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

        // Filter out empty messages (e.g. initial meta frames from backend)
        const filtered = sorted.filter(msg => {
            const hasText = msg.text && msg.text.trim().length > 0;
            const hasAttachments = msg.attachments && msg.attachments.length > 0;
            const hasToolCalls = msg.tool_calls && msg.tool_calls.length > 0;
            const hasActions = msg.actions && msg.actions.length > 0;
            const hasContentParts = msg.content_parts && msg.content_parts.length > 0;

            // Should show if contains any meaningful content
            return hasText || hasAttachments || hasToolCalls || hasActions || hasContentParts;
        });

        return filtered.map((msg): ExtendedIMessage => {
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
            };
        });
    }, [messages, userId]);
}
