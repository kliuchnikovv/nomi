import { Message } from '../../screens/main/models';
import { MessageHandler } from './types';

export const handleTextPayload: MessageHandler = (payload, prevMessages, messageIdx) => {
    const newMessages = [...prevMessages];
    const newText = payload.delta || payload.message || '';
    
    if (!newText || !newMessages[messageIdx]) {
        return newMessages;
    }

    const currentText = newMessages[messageIdx].text === " " ? "" : newMessages[messageIdx].text;
    // Deduplicate: same delta can arrive from both user and chat sockets
    if (currentText.endsWith(newText)) {
        return prevMessages;
    }

    const existingParts = newMessages[messageIdx].content_parts || [];
    const updatedParts = [...existingParts, { type: 'text' as const, text: newText }];

    newMessages[messageIdx] = {
        ...newMessages[messageIdx],
        text: currentText + newText,
        content_parts: updatedParts,
    };

    return newMessages;
};
