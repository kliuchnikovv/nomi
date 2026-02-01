import { MessageHandler } from './types';

export const handleClientActionPayload: MessageHandler = (payload, prevMessages, messageIdx) => {
    const newMessages = [...prevMessages];
    const { tool, method, params } = payload;

    if (newMessages[messageIdx]) {
        const existingParts = newMessages[messageIdx].content_parts || [];
        const updatedParts = [...existingParts];

        updatedParts.push({
            type: 'tool_call',
            tool_call: {
                name: `${tool}:${method}`,
                arguments: params,
                result: "Executed on client"
            }
        });
        
        newMessages[messageIdx] = {
            ...newMessages[messageIdx],
            content_parts: updatedParts
        };
    }
    
    return newMessages;
};
