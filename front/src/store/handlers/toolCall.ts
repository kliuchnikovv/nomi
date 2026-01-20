import { MessageHandler } from './types';

export const handleToolCallPayload: MessageHandler = (payload, prevMessages, messageIdx) => {
    const newMessages = [...prevMessages];
    
    if (payload.tool && newMessages[messageIdx]) {
        const existingParts = newMessages[messageIdx].content_parts || [];
        const updatedParts = [...existingParts];
        
        updatedParts.push({ type: 'tool_call', tool_call: payload.tool });

        // Also update top-level tool_calls array for backward compatibility
        const currentToolCalls = newMessages[messageIdx].tool_calls || [];
        
        newMessages[messageIdx] = {
            ...newMessages[messageIdx],
            content_parts: updatedParts,
            tool_calls: [...currentToolCalls, payload.tool]
        };
    }
    
    return newMessages;
};
