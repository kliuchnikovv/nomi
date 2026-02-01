import { MessageHandler } from './types';

export const handleToolCallPayload: MessageHandler = (payload, prevMessages, messageIdx) => {
    const newMessages = [...prevMessages];
    
    if (payload.tool && newMessages[messageIdx]) {
        const existingParts = newMessages[messageIdx].content_parts || [];
        const incomingToolCall = payload.tool;
        
        let updatedParts = [...existingParts];
        let foundExisting = false;

        // 1. Try to match by ID (Strong match)
        if (incomingToolCall.id) {
            updatedParts = updatedParts.map(part => {
                if (!foundExisting && part.type === 'tool_call') {
                    if (part.tool_call.id === incomingToolCall.id) {
                        foundExisting = true;
                        return {
                            ...part,
                            tool_call: { ...part.tool_call, ...incomingToolCall }
                        };
                    }
                }
                return part;
            });
        }
        
        // 2. Fallback: Match by Name + Running Status (Heuristic)
        // If we didn't find it by ID, try to find a corresponding "running" tool call by name.
        // We do this for ANY incoming tool call that has a name, to handle both argument updates and completion.
        if (!foundExisting && incomingToolCall.name) {
            updatedParts = updatedParts.map(part => {
                if (!foundExisting && part.type === 'tool_call') {
                    const existingTool = part.tool_call;
                    // Check if names match and existing is running (or has no result yet)
                    // We check !existingTool.status to handle legacy tools without explicit status
                    const isRunning = existingTool.status === 'running' || (!existingTool.result && !existingTool.status);
                    
                    if (existingTool.name === incomingToolCall.name && isRunning) {
                        foundExisting = true;
                        return {
                            ...part,
                            tool_call: { ...existingTool, ...incomingToolCall }
                        };
                    }
                }
                return part;
            });
        }
        
        // If still not found, append it
        if (!foundExisting) {
            updatedParts.push({ type: 'tool_call', tool_call: incomingToolCall });
        }

        // Also update top-level tool_calls array for backward compatibility
        const currentToolCalls = newMessages[messageIdx].tool_calls || [];
        let updatedToolCalls = [...currentToolCalls];
        
        let foundLegacy = false;
        if (foundExisting) {
             updatedToolCalls = updatedToolCalls.map(tc => {
                 if (foundLegacy) return tc;
                 
                 // ID Match
                 if (incomingToolCall.id && tc.id === incomingToolCall.id) {
                     foundLegacy = true;
                     return { ...tc, ...incomingToolCall };
                 }
                 // Heuristic Match
                 const isRunning = tc.status === 'running' || (!tc.result && !tc.status);
                 if (incomingToolCall.name && tc.name === incomingToolCall.name && isRunning) {
                     foundLegacy = true;
                     return { ...tc, ...incomingToolCall };
                 }
                 return tc;
             });
        }
        
        if (!foundLegacy) {
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
