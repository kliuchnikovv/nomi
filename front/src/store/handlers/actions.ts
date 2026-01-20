import { MessageHandler } from './types';

export const handleActionsPayload: MessageHandler = (payload, prevMessages, messageIdx) => {
    const newMessages = [...prevMessages];
    const actions = payload.actions || [];
    
    if (actions.length > 0 && newMessages[messageIdx]) {
        // Set actions on the message for button rendering
        newMessages[messageIdx] = {
            ...newMessages[messageIdx],
            actions: actions.map((a: any) => ({
                ...a,
                message_id: payload.message_id
            })),
        };
    }
    
    return newMessages;
};
