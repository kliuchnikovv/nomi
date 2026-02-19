/**
 * Event Emitter for RAG context events
 *
 * Used to notify UI when items are added to RAG context
 */

type EventListener = (data: any) => void;

class EventEmitter {
    private listeners: Map<string, Set<EventListener>> = new Map();

    on(event: string, listener: EventListener): () => void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(listener);

        // Return unsubscribe function
        return () => {
            const eventListeners = this.listeners.get(event);
            if (eventListeners) {
                eventListeners.delete(listener);
                if (eventListeners.size === 0) {
                    this.listeners.delete(event);
                }
            }
        };
    }

    emit(event: string, data?: any): void {
        console.log(`[EventEmitter] Emitting event "${event}"`, data);
        const eventListeners = this.listeners.get(event);
        console.log(`[EventEmitter] Listeners for "${event}":`, eventListeners?.size || 0);
        if (eventListeners) {
            eventListeners.forEach(listener => {
                try {
                    listener(data);
                } catch (error) {
                    console.error(`[EventEmitter] Error in listener for event "${event}":`, error);
                }
            });
        } else {
            console.warn(`[EventEmitter] No listeners for event "${event}"`);
        }
    }
}

export const eventEmitter = new EventEmitter();

// Event types
export const RAG_EVENTS = {
    DOCUMENT_ADDED: 'rag:document_added',
    DOCUMENT_REMOVED: 'rag:document_removed',
} as const;

export const CHAT_EVENTS = {
    CONTEXT_ITEM_ADDED: 'chat:context_item_added',
    CONTEXT_ITEM_REMOVED: 'chat:context_item_removed',
} as const;
