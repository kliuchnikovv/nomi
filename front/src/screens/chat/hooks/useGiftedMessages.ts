import { useMemo, useRef } from 'react';
import { IMessage } from 'react-native-gifted-chat';
import { Message as GenieMessage, Attachment } from '../../main/models';

export interface ExtendedIMessage extends IMessage {
    tool_calls?: any[];
    model?: string;
    attachments?: Attachment[];
    actions?: any[];
    content_parts?: any[];
    context_items?: any[];
}

const getTimestamp = (value?: number | string | null): number => {
    if (!value) return 0;
    if (typeof value === 'number') return value;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
};

// Fast check if array is sorted in ascending order by timestamp
const isSortedAscending = (messages: GenieMessage[]): boolean => {
    if (messages.length < 2) return true;
    for (let i = 1; i < messages.length; i++) {
        const prev = getTimestamp(messages[i - 1].created_at);
        const curr = getTimestamp(messages[i].created_at);
        if (curr < prev) return false;
    }
    return true;
};

// Fast message filter - inlined for performance
const shouldShowMessage = (msg: GenieMessage): boolean => {
    const text = msg.text;
    if (text && text.length > 0 && text.trim().length > 0) return true;
    if (msg.attachments?.length) return true;
    if (msg.tool_calls?.length) return true;
    if (msg.actions?.length) return true;
    if (msg.content_parts?.length) return true;
    if (msg.context_items?.length) return true;
    return false;
};

export function useGiftedMessages(messages: GenieMessage[], userId?: string) {
    // Cache last result to avoid re-computation when messages reference is stable
    const lastMessagesRef = useRef<GenieMessage[]>([]);
    const lastResultRef = useRef<ExtendedIMessage[]>([]);

    return useMemo(() => {
        // Fast path: same reference and same length
        if (
            messages === lastMessagesRef.current &&
            messages.length === lastResultRef.current.length
        ) {
            return lastResultRef.current;
        }

        // Optimization: if messages are already sorted chronologically (common case),
        // just reverse them instead of full sort O(n log n)
        let sorted: GenieMessage[];
        if (isSortedAscending(messages)) {
            // Fast reverse: create new array in reverse order
            sorted = new Array(messages.length);
            for (let i = 0, j = messages.length - 1; i < messages.length; i++, j--) {
                sorted[i] = messages[j];
            }
        } else {
            // Fallback to full sort only when needed
            sorted = [...messages].sort(
                (a, b) => getTimestamp(b.created_at) - getTimestamp(a.created_at)
            );
        }

        // Filter and map in single pass for better cache locality
        const result: ExtendedIMessage[] = [];
        const effectiveUserId = userId || 'user';

        for (let i = 0; i < sorted.length; i++) {
            const msg = sorted[i];

            // Skip empty messages
            if (!shouldShowMessage(msg)) continue;

            const isUserMessage = msg.role === 'user';
            const isSystemMessage = msg.role === 'system';

            let userIdMapped: string;
            let userName: string;

            if (isUserMessage) {
                userIdMapped = effectiveUserId;
                userName = 'You';
            } else if (isSystemMessage) {
                userIdMapped = 'system';
                userName = 'System';
            } else {
                userIdMapped = 'assistant';
                userName = 'Assistant';
            }

            result.push({
                _id: String(msg.id || `${msg.created_at}-${msg.role}`),
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
                context_items: msg.context_items,
            });
        }

        // Cache result
        lastMessagesRef.current = messages;
        lastResultRef.current = result;

        return result;
    }, [messages, userId]);
}
