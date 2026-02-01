import { MessageHandler } from './types';

export const handleUsagePayload: MessageHandler = (payload, prevMessages, messageIdx) => {
    const newMessages = [...prevMessages];
    
    if (newMessages[messageIdx]) {
        newMessages[messageIdx] = {
            ...newMessages[messageIdx],
            metadata: {
                ...newMessages[messageIdx].metadata,
                usage: {
                    prompt_tokens: payload.prompt_tokens,
                    completion_tokens: payload.completion_tokens,
                    elapsed_ms: payload.elapsed_ms
                }
            }
        };
    }
    
    return newMessages;
};
