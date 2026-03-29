import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '../../../apiClient';
import { getApiUrl } from '../../../config';
import { PlanChip, PlanDocument, PlanItem } from '../types';

// ---------------------------------------------------------------------------
// PatchOp — AI patch operations applied to a PlanDocument
// ---------------------------------------------------------------------------

export type PatchOp =
  | { op: 'add_chip'; item_id: string; chip: PlanChip }
  | { op: 'remove_chip'; item_id: string; chip_id: string }
  | { op: 'update_chip'; item_id: string; chip: PlanChip }
  | { op: 'add_item'; item: PlanItem; after_id?: string }
  | { op: 'remove_item'; item_id: string }
  | { op: 'update_item'; item_id: string; changes: Partial<PlanItem> };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
}

function clampDepth(depth: number): 0 | 1 | 2 {
  if (depth <= 0) return 0;
  if (depth >= 2) return 2;
  return depth as 0 | 1 | 2;
}

function insertAfter(items: PlanItem[], newItem: PlanItem, afterId?: string): PlanItem[] {
  if (!afterId) {
    return [...items, newItem];
  }
  const idx = items.findIndex(i => i.id === afterId);
  if (idx === -1) {
    return [...items, newItem];
  }
  const next = [...items];
  next.splice(idx + 1, 0, newItem);
  return next;
}

// ---------------------------------------------------------------------------
// Hook return type
// ---------------------------------------------------------------------------

export interface UsePlanDocumentResult {
  document: PlanDocument | null;
  items: PlanItem[];
  loading: boolean;
  addItem: (afterId?: string) => string;
  removeItem: (id: string) => void;
  updateItem: (id: string, changes: Partial<PlanItem>) => void;
  moveItem: (fromIndex: number, toIndex: number) => void;
  indentItem: (id: string, delta: -1 | 1) => void;
  toggleChecked: (id: string) => void;
  applyPatches: (patches: PatchOp[], bannerText?: string) => void;
  bannerMessage: string | null;
  clearBanner: () => void;
  setBannerMessage: (msg: string | null) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePlanDocument(date: string): UsePlanDocumentResult {
  const [document, setDocument] = useState<PlanDocument | null>(null);
  const [items, setItems] = useState<PlanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);

  // Persist the document id in a ref so debounce callbacks can always read it
  const documentIdRef = useRef<string | null>(null);

  // Debounce timer ref for server sync
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------------------------------------------------------------------------
  // Server sync (debounced, 500 ms)
  // ---------------------------------------------------------------------------

  const scheduleSync = useCallback((nextItems: PlanItem[]) => {
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
    }
    syncTimerRef.current = setTimeout(async () => {
      const docId = documentIdRef.current;
      if (!docId) return;
      try {
        const updated = await apiClient.patch<PlanDocument>(
          `${getApiUrl()}/plan-documents/${docId}`,
          { items: nextItems },
        );
        if (updated) {
          setDocument(updated);
          // Do NOT replace local items — server items are the source of truth only
          // after a full reload, not after a debounced sync.
        }
      } catch (err) {
        console.warn('[usePlanDocument] sync error:', err);
      }
    }, 500);
  }, []);

  // ---------------------------------------------------------------------------
  // Load or create document on mount / date change
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        // Try GET first
        let doc: PlanDocument | null = null;
        try {
          doc = await apiClient.get<PlanDocument>(
            `${getApiUrl()}/plan-documents?date=${date}`,
          );
        } catch (err: any) {
          // If 404, we create a new document below
          const is404 =
            err?.message?.includes('404') ||
            err?.message?.includes('not found') ||
            err?.message?.toLowerCase?.().includes('not found');
          if (!is404) {
            throw err;
          }
        }

        if (!doc) {
          // Create new document
          doc = await apiClient.post<PlanDocument>(
            `${getApiUrl()}/plan-documents`,
            { date, items: [] },
          );
        }

        if (cancelled || !doc) return;

        documentIdRef.current = doc.id;
        setDocument(doc);
        setItems(doc.items ?? []);
      } catch (err) {
        console.error('[usePlanDocument] load error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
      }
    };
  }, [date]);

  // ---------------------------------------------------------------------------
  // Mutation helpers — update local state immediately then schedule server sync
  // ---------------------------------------------------------------------------

  const mutate = useCallback(
    (updater: (prev: PlanItem[]) => PlanItem[]) => {
      setItems(prev => {
        const next = updater(prev);
        scheduleSync(next);
        return next;
      });
    },
    [scheduleSync],
  );

  // ---------------------------------------------------------------------------
  // Public mutations
  // ---------------------------------------------------------------------------

  const addItem = useCallback(
    (afterId?: string): string => {
      const newItem: PlanItem = {
        id: generateId(),
        text: '',
        depth: 0,
        checked: false,
        chips: [],
      };
      mutate(prev => insertAfter(prev, newItem, afterId));
      return newItem.id;
    },
    [mutate],
  );

  const removeItem = useCallback(
    (id: string) => {
      mutate(prev => prev.filter(item => item.id !== id));
    },
    [mutate],
  );

  const updateItem = useCallback(
    (id: string, changes: Partial<PlanItem>) => {
      mutate(prev =>
        prev.map(item => (item.id === id ? { ...item, ...changes } : item)),
      );
    },
    [mutate],
  );

  const moveItem = useCallback(
    (fromIndex: number, toIndex: number) => {
      mutate(prev => {
        if (
          fromIndex < 0 ||
          toIndex < 0 ||
          fromIndex >= prev.length ||
          toIndex >= prev.length
        ) {
          return prev;
        }
        const next = [...prev];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        return next;
      });
    },
    [mutate],
  );

  const indentItem = useCallback(
    (id: string, delta: -1 | 1) => {
      mutate(prev =>
        prev.map(item =>
          item.id === id
            ? { ...item, depth: clampDepth(item.depth + delta) }
            : item,
        ),
      );
    },
    [mutate],
  );

  const toggleChecked = useCallback(
    (id: string) => {
      mutate(prev =>
        prev.map(item =>
          item.id === id ? { ...item, checked: !item.checked } : item,
        ),
      );
    },
    [mutate],
  );

  // ---------------------------------------------------------------------------
  // applyPatches — apply AI patch operations to local state
  // ---------------------------------------------------------------------------

  const applyPatches = useCallback(
    (patches: PatchOp[], bannerText?: string) => {
      mutate(prev => {
        let next = [...prev];

        for (const patch of patches) {
          switch (patch.op) {
            case 'add_item': {
              const newItem: PlanItem = { ...patch.item, isNew: true };
              next = insertAfter(next, newItem, patch.after_id);
              break;
            }
            case 'remove_item': {
              next = next.filter(i => i.id !== patch.item_id);
              break;
            }
            case 'update_item': {
              next = next.map(i =>
                i.id === patch.item_id
                  ? { ...i, ...patch.changes, isNew: true }
                  : i,
              );
              break;
            }
            case 'add_chip': {
              next = next.map(i =>
                i.id === patch.item_id
                  ? {
                      ...i,
                      chips: [...i.chips, { ...patch.chip, isNew: true }],
                      isNew: true,
                    }
                  : i,
              );
              break;
            }
            case 'remove_chip': {
              next = next.map(i =>
                i.id === patch.item_id
                  ? {
                      ...i,
                      chips: i.chips.filter(c => c.id !== patch.chip_id),
                    }
                  : i,
              );
              break;
            }
            case 'update_chip': {
              next = next.map(i =>
                i.id === patch.item_id
                  ? {
                      ...i,
                      chips: i.chips.map(c =>
                        c.id === patch.chip.id
                          ? { ...patch.chip, isNew: true }
                          : c,
                      ),
                      isNew: true,
                    }
                  : i,
              );
              break;
            }
          }
        }

        return next;
      });

      if (bannerText !== undefined) {
        setBannerMessage(bannerText);
      }
    },
    [mutate],
  );

  // ---------------------------------------------------------------------------
  // Banner helpers
  // ---------------------------------------------------------------------------

  const clearBanner = useCallback(() => setBannerMessage(null), []);

  return {
    document,
    items,
    loading,
    addItem,
    removeItem,
    updateItem,
    moveItem,
    indentItem,
    toggleChecked,
    applyPatches,
    bannerMessage,
    clearBanner,
    setBannerMessage,
  };
}
