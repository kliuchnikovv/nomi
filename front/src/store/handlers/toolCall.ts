import { MessageHandler } from './types';

export const handleToolCallPayload: MessageHandler = (payload, prevMessages, messageIdx) => {
    const newMessages = [...prevMessages];
    
    if (payload.tool && newMessages[messageIdx]) {
        const existingParts = newMessages[messageIdx].content_parts || [];
        const incomingToolCall = payload.tool;
        
        // Check if we already have a tool call with this ID
        let updatedParts = [...existingParts];
        let foundExisting = false;

        if (incomingToolCall.id) {
            updatedParts = updatedParts.map(part => {
                if (part.type === 'tool_call' && part.tool_call.id === incomingToolCall.id) {
                    foundExisting = true;
                    // Merge existing tool call with new data (e.g. result, status)
                    return {
                        ...part,
                        tool_call: {
                            ...part.tool_call,
                            ...incomingToolCall
                        }
                    };
                }
                return part;
            });
        }
        
        // If not found, append it
        if (!foundExisting) {
            updatedParts.push({ type: 'tool_call', tool_call: incomingToolCall });
        }

        // Also update top-level tool_calls array for backward compatibility
        const currentToolCalls = newMessages[messageIdx].tool_calls || [];
        let updatedToolCalls = [...currentToolCalls];
        
        if (foundExisting && incomingToolCall.id) {
             updatedToolCalls = updatedToolCalls.map(tc => {
                 if (tc.id === incomingToolCall.id) {
                     return { ...tc, ...incomingToolCall };
                 }
                 return tc;
             });
        } else {
             updatedToolCalls.push(incomingToolCall);
        }
        
        newMessages[messageIdx] = {
            ...newMessages[messageIdx],
            content_parts: updatedParts,
            tool_calls: updatedToolCalls
        };
    }
    
    return newMessages;
};
