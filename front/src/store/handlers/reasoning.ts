import { MessageHandler } from './types';

export const handleReasoningPayload: MessageHandler = (payload, prevMessages, messageIdx) => {
    const newMessages = [...prevMessages];
    const reasoningText = payload.delta || payload.content || payload.message || '';
    
    if (!reasoningText || !newMessages[messageIdx]) {
        return newMessages;
    }

    const msg = newMessages[messageIdx];
    const ix = payload.ix;
    // Deduplicate by stream index: same frame can arrive from both chat and user channels
    if (typeof ix === 'number' && typeof msg._stream_ix === 'number' && msg._stream_ix >= ix) {
        return prevMessages;
    }

    const existingParts = msg.content_parts || [];
    const updatedParts = [...existingParts];

    // Append to last reasoning part or create new one
    if (updatedParts.length > 0 && updatedParts[updatedParts.length - 1].type === 'reasoning') {
        const lastPart = updatedParts[updatedParts.length - 1] as { type: 'reasoning', reasoning: string };
        updatedParts[updatedParts.length - 1] = { type: 'reasoning', reasoning: lastPart.reasoning + reasoningText };
    } else {
        updatedParts.push({ type: 'reasoning', reasoning: reasoningText });
    }

    const currentSteps = msg.reasoning_steps || [];
    const updatedSteps = [...currentSteps];
    if (updatedSteps.length > 0) {
        updatedSteps[updatedSteps.length - 1] += reasoningText;
    } else {
        updatedSteps.push(reasoningText);
    }

    newMessages[messageIdx] = {
        ...msg,
        content_parts: updatedParts,
        reasoning_steps: updatedSteps,
        _stream_ix: typeof ix === 'number' ? ix : msg._stream_ix,
    };

    return newMessages;
};
