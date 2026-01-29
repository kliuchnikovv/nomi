import { Message } from '../../screens/main/models';
import { MessageHandler } from './types';

export const handleTextPayload: MessageHandler = (payload, prevMessages, messageIdx) => {
    const newMessages = [...prevMessages];
    const newText = payload.delta || payload.message || '';
    
    if (!newText || !newMessages[messageIdx]) {
        return newMessages;
    }

    const msg = newMessages[messageIdx];
    const ix = payload.ix;
    // Deduplicate by stream index: same frame can arrive from both chat and user channels
    if (typeof ix === 'number' && typeof msg._stream_ix === 'number' && msg._stream_ix >= ix) {
        return prevMessages;
    }

    const currentText = msg.text === " " ? "" : msg.text;
    // Deduplicate: same delta can arrive from both user and chat sockets
    if (currentText.endsWith(newText)) {
        return prevMessages;
    }

    const existingParts = msg.content_parts || [];
    const updatedParts = [...existingParts, { type: 'text' as const, text: newText }];

    newMessages[messageIdx] = {
        ...msg,
        text: currentText + newText,
        content_parts: updatedParts,
        _stream_ix: typeof ix === 'number' ? ix : msg._stream_ix,
    };

    return newMessages;
};
