/**
 * Shared RAG indexing scaffold for iOS native clients.
 *
 * The shape repeated across iOS clients (Calendar, Reminders, Contacts):
 *  - Platform check (iOS only)
 *  - Fetch a homogeneous list of items
 *  - Build (id, content, metadata) per item and POST to ragApi.index
 *  - Log indexed count; swallow errors via console.error
 *
 * IOSHealthClient does NOT use this helper — it iterates dates with per-day
 * fetch + try/continue and has a different control flow.
 */

import { Platform } from 'react-native';
import { ragApi } from '../../../apiClient';

export interface RAGIndexEntry {
    id: string;
    sourceType: string;
    content: string;
    metadata?: Record<string, any>;
}

export async function indexItemsForRAG<T>(
    label: string,
    fetchItems: () => Promise<T[]>,
    toEntry: (item: T, index: number) => RAGIndexEntry | null,
): Promise<void> {
    if (Platform.OS !== 'ios') {
        console.warn(`[${label}] RAG indexing is iOS only`);
        return;
    }
    try {
        const items = await fetchItems();
        for (let i = 0; i < items.length; i++) {
            const entry = toEntry(items[i], i);
            if (!entry) continue;
            await ragApi.index({
                id: entry.id,
                source_type: entry.sourceType,
                content: entry.content,
                metadata: entry.metadata,
            });
        }
        console.log(`[${label}] Indexed ${items.length} items for RAG`);
    } catch (error) {
        console.error(`[${label}] indexForRAG error:`, error);
    }
}
