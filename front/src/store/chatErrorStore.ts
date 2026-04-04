/**
 * Per-chatId event store for socket errors.
 * Allows usePlannerChat to clear isThinking on error
 * without using socket.setHandlers (which conflicts with regular chat).
 */

type ErrorHandler = (error: any) => void;

const listeners = new Map<string, ErrorHandler>();

export function subscribeChatError(chatId: string, fn: ErrorHandler): () => void {
  listeners.set(chatId, fn);
  return () => {
    if (listeners.get(chatId) === fn) {
      listeners.delete(chatId);
    }
  };
}

export function emitChatError(chatId: string, error: any): void {
  try {
    listeners.get(chatId)?.(error);
  } catch (e) {
    console.warn('[chatErrorStore] listener error:', e);
  }
}
