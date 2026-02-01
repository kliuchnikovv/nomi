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

    // Handle cumulative stream: backend may send full text-so-far instead of delta.
    // Append only the new suffix to avoid "ПрПриветивет"-style duplication.
    let effectiveDelta = newText;
    if (currentText.length > 0) {
        if (newText.startsWith(currentText) && newText.length > currentText.length) {
            effectiveDelta = newText.slice(currentText.length);
        } else {
            // Overlap: newText may start with suffix of currentText (e.g. "Привет" + "ивет!!").
            // Append only the non-overlapping tail.
            const maxOverlap = Math.min(currentText.length, newText.length);
            for (let k = maxOverlap; k >= 1; k--) {
                if (currentText.endsWith(newText.slice(0, k))) {
                    effectiveDelta = newText.slice(k);
                    break;
                }
            }
        }
        if (!effectiveDelta) return prevMessages;
    }

    const existingParts = msg.content_parts || [];
    const updatedParts = [...existingParts, { type: 'text' as const, text: effectiveDelta }];

    newMessages[messageIdx] = {
        ...msg,
        text: currentText + effectiveDelta,
        content_parts: updatedParts,
        _stream_ix: typeof ix === 'number' ? ix : msg._stream_ix,
    };

    return newMessages;
};
