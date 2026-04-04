import type { PatchOp } from './hooks/usePlanDocument';

// A registry entry: a function that applies patches for a specific date's document.
// The router in PlannerScreen registers one per day, keyed by item IDs.
type ApplyFn = (patches: PatchOp[], bannerText?: string) => void;

// item_id → applyPatches for that day
let _itemToApply: Map<string, ApplyFn> = new Map();

// Fallback for when item_id is unknown (e.g. add_item ops)
let _fallbackApply: ApplyFn | null = null;

export function registerApplyPatches(fn: ApplyFn) {
    _fallbackApply = fn;
}

export function unregisterApplyPatches() {
    _fallbackApply = null;
    _itemToApply.clear();
}

/** Register item IDs → applyFn mapping (called by PlannerScreen on every items change) */
export function registerItemMapping(itemIds: string[], fn: ApplyFn) {
    for (const id of itemIds) {
        _itemToApply.set(id, fn);
    }
}

/** Remove all item IDs that belong to a specific apply function (called when day unmounts) */
export function unregisterItemMapping(itemIds: string[]) {
    for (const id of itemIds) {
        _itemToApply.delete(id);
    }
}

export function callApplyPatches(patches: PatchOp[], bannerText?: string) {
    // Group patches by their target apply function
    const groups = new Map<ApplyFn, PatchOp[]>();

    for (const patch of patches) {
        const itemId = 'item_id' in patch ? patch.item_id : ('item' in patch ? (patch as any).item?.id : undefined);
        const fn = (itemId && _itemToApply.get(itemId)) ?? _fallbackApply;
        if (!fn) continue;
        if (!groups.has(fn)) groups.set(fn, []);
        groups.get(fn)!.push(patch);
    }

    for (const [fn, group] of groups) {
        fn(group, bannerText);
    }
}
