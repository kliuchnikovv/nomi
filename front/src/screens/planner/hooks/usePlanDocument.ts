import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
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
  | { op: 'update_item'; item_id: string; changes: Partial<PlanItem> }
  | { op: 'move_to_date'; item_id: string; target_date: string }
  | { op: 'reorder_items'; ids: string[] };

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

// Parse "HH:MM" or "HH:MM-HH:MM" → minutes since midnight (or Infinity if none)
function parseStartMinutes(value: string): number {
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return Infinity;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

function sortByTime(items: PlanItem[]): PlanItem[] {
  return [...items].sort((a, b) => {
    const aTime = a.chips.find(c => c.type === 'time');
    const bTime = b.chips.find(c => c.type === 'time');
    const aMin = aTime ? parseStartMinutes(aTime.value) : Infinity;
    const bMin = bTime ? parseStartMinutes(bTime.value) : Infinity;
    return aMin - bMin;
  });
}

// Strip embedded time ranges like "с 13:50 до 17:30", "21:00 - 00:00",
// "в 15:00" etc. from item text so the title stays clean after time chip is added.
function stripTimeFromText(text: string): string {
  let t = text;
  // "с HH:MM до HH:MM" (Russian "from X to Y")
  t = t.replace(/\s*с\s+\d{1,2}:\d{2}\s+до\s+\d{1,2}:\d{2}/gi, '');
  // "HH:MM - HH:MM" or "HH:MM – HH:MM"
  t = t.replace(/\s*\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}/g, '');
  // standalone "в HH:MM" (Russian "at X")
  t = t.replace(/\s*в\s+\d{1,2}:\d{2}/gi, '');
  // leading/trailing separators left after removal
  t = t.replace(/^[\s\-–,]+|[\s\-–,]+$/g, '').trim();
  return t || text; // never return empty string
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
  /** Immediately flush any pending debounced sync to the server */
  flushSync: () => Promise<void>;
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

  // Latest items waiting to be synced (updated on every mutation)
  const pendingSyncItemsRef = useRef<PlanItem[] | null>(null);

  // ---------------------------------------------------------------------------
  // Core sync function (called by debounce and AppState flush)
  // ---------------------------------------------------------------------------

  const syncNow = useCallback(async (itemsToSync: PlanItem[]) => {
    const docId = documentIdRef.current;
    if (!docId) return;
    try {
      const updated = await apiClient.patch<PlanDocument>(
        `${getApiUrl()}/plan-documents/${docId}`,
        { items: itemsToSync },
      );
      if (updated) {
        setDocument(updated);
      }
    } catch (err) {
      console.warn('[usePlanDocument] sync error:', err);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Server sync (debounced, 500 ms)
  // ---------------------------------------------------------------------------

  const scheduleSync = useCallback((nextItems: PlanItem[]) => {
    pendingSyncItemsRef.current = nextItems;
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
    }
    syncTimerRef.current = setTimeout(() => {
      const items = pendingSyncItemsRef.current;
      if (items) {
        pendingSyncItemsRef.current = null;
        syncNow(items);
      }
      syncTimerRef.current = null;
    }, 500);
  }, [syncNow]);

  // ---------------------------------------------------------------------------
  // AppState listener — flush pending sync when app goes to background
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const subscription = AppState.addEventListener(
      'change',
      (nextState: AppStateStatus) => {
        if (nextState === 'background' || nextState === 'inactive') {
          const items = pendingSyncItemsRef.current;
          if (items && syncTimerRef.current) {
            clearTimeout(syncTimerRef.current);
            syncTimerRef.current = null;
            pendingSyncItemsRef.current = null;
            syncNow(items);
          }
        }
      },
    );
    return () => subscription.remove();
  }, [syncNow]);

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
          // Any GET failure (404, network error, redirect loop) → fall through to create
          console.warn('[usePlanDocument] GET failed, will attempt create:', err?.message);
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
      // Flush any pending sync before unmounting (e.g. date navigation)
      const items = pendingSyncItemsRef.current;
      if (items && syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
        pendingSyncItemsRef.current = null;
        syncNow(items);
      }
    };
  }, [date, syncNow]);

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
        let hadTimeChip = false;

        for (const patch of patches) {
          if (patch.op === 'add_chip' && patch.chip?.type === 'time') hadTimeChip = true;
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
              next = next.map(i => {
                if (i.id !== patch.item_id) return i;
                const existingIdx = i.chips.findIndex(c => c.type === patch.chip.type);
                // Auto-clean text when a time chip is added (strip embedded time ranges)
                const cleanText = patch.chip.type === 'time' ? stripTimeFromText(i.text) : i.text;
                if (existingIdx !== -1) {
                  // Upsert: update existing chip of same type, preserve original id
                  const chips = [...i.chips];
                  chips[existingIdx] = { ...patch.chip, id: i.chips[existingIdx].id, isNew: true };
                  return { ...i, text: cleanText, chips, isNew: true };
                }
                return {
                  ...i,
                  text: cleanText,
                  // Always generate a fresh id so AI-provided ids ("1", "2") never collide
                  chips: [...i.chips, { ...patch.chip, id: generateId(), isNew: true }],
                  isNew: true,
                };
              });
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
            case 'move_to_date': {
              // Remove from current document; the item will be created on target date server-side
              next = next.filter(i => i.id !== patch.item_id);
              break;
            }
            case 'reorder_items': {
              const idOrder = patch.ids;
              const knownIds = next.map(i => i.id);
              const matched = idOrder.filter((id: string) => knownIds.includes(id));
              console.log('[usePlanDocument] reorder_items received ids:', idOrder, 'known ids:', knownIds, 'matched:', matched);
              const map = new Map(next.map(i => [i.id, i]));
              const reordered = idOrder.map((id: string) => map.get(id)).filter(Boolean) as PlanItem[];
              const rest = next.filter(i => !idOrder.includes(i.id));
              next = [...reordered, ...rest];
              break;
            }
          }
        }

        // Auto-sort by time after any batch that assigned time chips,
        // regardless of whether the agent sent a reorder_items patch.
        if (hadTimeChip) {
          next = sortByTime(next);
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
  // flushSync — cancel debounce and sync immediately
  // ---------------------------------------------------------------------------

  const flushSync = useCallback(async () => {
    const pending = pendingSyncItemsRef.current;
    if (pending && syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
      pendingSyncItemsRef.current = null;
      await syncNow(pending);
    }
  }, [syncNow]);

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
    flushSync,
    bannerMessage,
    clearBanner,
    setBannerMessage,
  };
}
