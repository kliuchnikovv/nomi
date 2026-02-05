import { Message } from '../../screens/main/models';
import { MessageHandler } from './types';

export const handleTextPayload: MessageHandler = (payload, prevMessages, messageIdx) => {
    const newMessages = [...prevMessages];
    const newText = payload.delta || payload.message || '';
    console.log('[handleTextPayload 📝]', {
        messageIdx,
        message_id: prevMessages[messageIdx]?.id,
        newTextLength: newText.length,
        newTextPreview: newText.substring(0, 50),
        ix: payload.ix,
        currentTextLength: prevMessages[messageIdx]?.text?.length
    });
    
    if (!newText || !newMessages[messageIdx]) {
        console.log('[handleTextPayload ⏭️  Skip] No text or message not found');
        return newMessages;
    }

    const msg = newMessages[messageIdx];
    const ix = payload.ix;
    // Deduplicate by stream index: same frame can arrive from both chat and user channels
    if (typeof ix === 'number' && typeof msg._stream_ix === 'number' && msg._stream_ix >= ix) {
        console.log('[handleTextPayload ⏭️  Duplicate stream index] Current:', msg._stream_ix, 'New:', ix);
        return prevMessages;
    }

    const currentText = msg.text === " " ? "" : msg.text;
    // Deduplicate: same delta can arrive from both user and chat sockets
    if (currentText.endsWith(newText)) {
        console.log('[handleTextPayload ⏭️  Duplicate text] Current already ends with new text');
        return prevMessages;
    }

    // Handle cumulative stream: backend may send full text-so-far instead of delta.
    // Append only the new suffix to avoid "ПрПриветивет"-style duplication.
    let effectiveDelta = newText;
    if (currentText.length > 0) {
        if (newText.startsWith(currentText) && newText.length > currentText.length) {
            effectiveDelta = newText.slice(currentText.length);
            console.log('[handleTextPayload 🔍 Cumulative stream] Extracted delta:', effectiveDelta.substring(0, 30));
        } else {
            // Overlap: newText may start with suffix of currentText (e.g. "Привет" + "ивет!!").
            // Append only the non-overlapping tail.
            const maxOverlap = Math.min(currentText.length, newText.length);
            for (let k = maxOverlap; k >= 1; k--) {
                if (currentText.endsWith(newText.slice(0, k))) {
                    effectiveDelta = newText.slice(k);
                    console.log('[handleTextPayload 🔍 Overlap detected] k:', k, 'effectiveDelta:', effectiveDelta.substring(0, 30));
                    break;
                }
            }
        }
        if (!effectiveDelta) {
            console.log('[handleTextPayload ⏭️  Empty effective delta]');
            return prevMessages;
        }
    }

    const existingParts = msg.content_parts || [];
    const updatedParts = [...existingParts];
    const lastPart = updatedParts.length > 0 ? updatedParts[updatedParts.length - 1] : null;

    if (lastPart && lastPart.type === 'text') {
        updatedParts[updatedParts.length - 1] = {
            ...lastPart,
            text: lastPart.text + effectiveDelta
        };
    } else {
        updatedParts.push({ type: 'text' as const, text: effectiveDelta });
    }

    console.log('[handleTextPayload ✅ Updating message]', {
        message_id: msg.id,
        oldTextLength: currentText.length,
        newTextLength: (currentText + effectiveDelta).length,
        effectiveDeltaLength: effectiveDelta.length,
        partsCount: updatedParts.length
    });
    newMessages[messageIdx] = {
        ...msg,
        text: currentText + effectiveDelta,
        content_parts: updatedParts,
        _stream_ix: typeof ix === 'number' ? ix : msg._stream_ix,
    };

    return newMessages;
};
