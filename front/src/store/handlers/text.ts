import { Message } from '../../screens/main/models';
import { MessageHandler } from './types';

export const handleTextPayload: MessageHandler = (payload, prevMessages, messageIdx) => {
    const newMessages = [...prevMessages];
    const newText = payload.delta || payload.message || '';
    
    if (newText && newMessages[messageIdx]) {
        const existingParts = newMessages[messageIdx].content_parts || [];
        let updatedParts = [...existingParts];
        
        updatedParts.push({ type: 'text', text: newText });

        // Append text to main message text for backward compatibility
        const currentText = newMessages[messageIdx].text === " " ? "" : newMessages[messageIdx].text;
        
        newMessages[messageIdx] = {
            ...newMessages[messageIdx],
            text: currentText + newText,
            content_parts: updatedParts,
        };
    }
    
    return newMessages;
};
