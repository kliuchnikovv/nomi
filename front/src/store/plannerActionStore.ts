/**
 * Per-chatId event store for planner client_action frames.
 * Mirrors the generationDoneStore pattern.
 *
 * Only one subscriber per chatId is supported (Map, last-writer-wins).
 * This is intentional: a single usePlannerChat instance owns each chatId.
 */

type Handler = (payload: any) => void;

const listeners = new Map<string, Handler>();

export function subscribePlannerAction(chatId: string, fn: Handler): () => void {
  listeners.set(chatId, fn);
  return () => {
    listeners.delete(chatId);
  };
}

export function emitPlannerAction(chatId: string, payload: any): void {
  try {
    listeners.get(chatId)?.(payload);
  } catch (e) {
    console.warn('[plannerActionStore] listener error:', e);
  }
}
