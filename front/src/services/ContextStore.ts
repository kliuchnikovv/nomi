/**
 * Global Context Store
 * 
 * Stores context items (emails, documents, etc.) globally
 * This allows items to be added from plugins even when ChatInput is not mounted.
 */

import { eventEmitter, CHAT_EVENTS } from './events';
import { ContextItem } from '../screens/chat/components/ContextItemCard';

class ContextStore {
    private items: ContextItem[] = [];
    private listeners: Set<() => void> = new Set();

    add(item: ContextItem) {
        console.log('[ContextStore] Adding item:', item.id, item.title);
        // Remove existing item with same id
        this.items = this.items.filter(i => i.id !== item.id);
        // Add new item
        this.items = [...this.items, item];
        console.log('[ContextStore] Total items:', this.items.length);

        // Emit event for backward compatibility
        eventEmitter.emit(CHAT_EVENTS.CONTEXT_ITEM_ADDED, item);

        // Notify listeners
        this.notify();
    }

    remove(id: string) {
        console.log('[ContextStore] Removing item:', id);
        this.items = this.items.filter(i => i.id !== id);
        console.log('[ContextStore] Total items:', this.items.length);
        this.notify();
    }

    clear() {
        console.log('[ContextStore] Clearing all items');
        this.items = [];
        this.notify();
    }

    getAll(): ContextItem[] {
        return [...this.items];
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        listener();

        return () => {
            this.listeners.delete(listener);
        };
    }

    private notify() {
        this.listeners.forEach(listener => {
            try {
                listener();
            } catch (error) {
                console.error('[ContextStore] Error in listener:', error);
            }
        });
    }
}

export const contextStore = new ContextStore();
