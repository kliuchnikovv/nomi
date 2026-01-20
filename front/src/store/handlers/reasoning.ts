import { MessageHandler } from './types';

export const handleReasoningPayload: MessageHandler = (payload, prevMessages, messageIdx) => {
    const newMessages = [...prevMessages];
    const reasoningText = payload.delta || payload.content || payload.message || '';
    
    if (reasoningText && newMessages[messageIdx]) {
        const existingParts = newMessages[messageIdx].content_parts || [];
        const updatedParts = [...existingParts];
        
        // Append to last reasoning part or create new one
        if (updatedParts.length > 0 && updatedParts[updatedParts.length - 1].type === 'reasoning') {
            const lastPart = updatedParts[updatedParts.length - 1] as { type: 'reasoning', reasoning: string };
            updatedParts[updatedParts.length - 1] = { type: 'reasoning', reasoning: lastPart.reasoning + reasoningText };
        } else {
            updatedParts.push({ type: 'reasoning', reasoning: reasoningText });
        }

        // Also update reasoning_steps array
        const currentSteps = newMessages[messageIdx].reasoning_steps || [];
        const updatedSteps = [...currentSteps];
        if (updatedSteps.length > 0) {
            updatedSteps[updatedSteps.length - 1] += reasoningText;
        } else {
            updatedSteps.push(reasoningText);
        }

        newMessages[messageIdx] = {
            ...newMessages[messageIdx],
            content_parts: updatedParts,
            reasoning_steps: updatedSteps,
        };
    }
    
    return newMessages;
};
