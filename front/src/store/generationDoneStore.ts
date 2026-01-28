/**
 * Emits when a generation completes (DONE frame) for a chat.
 * Used so both chat and user sockets can clear "Assistant is thinking" when
 * DONE is received (e.g. user channel only, or after room mismatch reroute).
 */

type Listener = (chatId: string) => void;
const listeners = new Set<Listener>();

export function emitGenerationDone(chatId: string): void {
    listeners.forEach((fn) => {
        try {
            fn(chatId);
        } catch (e) {
            console.warn('[generationDoneStore] listener error:', e);
        }
    });
}

export function subscribeGenerationDone(fn: Listener): () => void {
    listeners.add(fn);
    return () => {
        listeners.delete(fn);
    };
}
