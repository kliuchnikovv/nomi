import { Message } from '../../screens/main/models';
import { handleTextPayload } from './text';
import { handleToolCallPayload } from './toolCall';
import { handleReasoningPayload } from './reasoning';
import { handleMemberResponsePayload } from './memberResponse';
import { handleActionsPayload } from './actions';
import { handleClientActionPayload } from './clientAction';
import { handleUsagePayload } from './usage';
import { MessageHandler } from './types';

const handlers: Record<string, MessageHandler> = {
    'text': handleTextPayload,
    'tool_call': handleToolCallPayload,
    'reasoning': handleReasoningPayload,
    'member_response': handleMemberResponsePayload,
    'actions': handleActionsPayload,
    'client_action': handleClientActionPayload,
    'usage': handleUsagePayload,
};

export const dispatchPayload = (
    payload: any,
    prevMessages: Message[],
    messageIdx: number
): Message[] => {
    // Special case for text: if type is missing but message/delta exists, treat as text
    const type = payload.type || ((payload.message || payload.delta) ? 'text' : null);
    console.log('[dispatchPayload 🎬]', {
        type,
        hasHandler: !!(type && handlers[type]),
        payload_keys: Object.keys(payload),
        messageIdx
    });

    if (type && handlers[type]) {
        const result = handlers[type](payload, prevMessages, messageIdx);
        console.log('[dispatchPayload ✅ Handler executed]', {
            type,
            changed: result !== prevMessages
        });
        return result;
    }
    console.log('[dispatchPayload ⚠️  No handler] Type:', type);
    
    return prevMessages;
};
