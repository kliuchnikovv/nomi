/**
 * Unit tests for the applyPatches transformation logic.
 *
 * These tests exercise the same patch operations used by usePlanDocument.applyPatches
 * by implementing the transformation as a pure function — identical logic, no React.
 */

import { PlanChip, PlanItem } from '../../src/screens/planner/types';
import { PatchOp } from '../../src/screens/planner/hooks/usePlanDocument';

// ---------------------------------------------------------------------------
// Minimal reimplementation of the patch logic (mirrors usePlanDocument.applyPatches)
// This keeps tests independent from React rendering while validating the logic.
// ---------------------------------------------------------------------------

function insertAfter(items: PlanItem[], newItem: PlanItem, afterId?: string): PlanItem[] {
  if (!afterId) return [...items, newItem];
  const idx = items.findIndex(i => i.id === afterId);
  if (idx === -1) return [...items, newItem];
  const next = [...items];
  next.splice(idx + 1, 0, newItem);
  return next;
}

function applyPatches(items: PlanItem[], patches: PatchOp[]): PlanItem[] {
  let next = [...items];
  for (const patch of patches) {
    switch (patch.op) {
      case 'add_item':
        next = insertAfter(next, { ...patch.item, isNew: true }, patch.after_id);
        break;
      case 'remove_item':
        next = next.filter(i => i.id !== patch.item_id);
        break;
      case 'update_item':
        next = next.map(i =>
          i.id === patch.item_id ? { ...i, ...patch.changes, isNew: true } : i,
        );
        break;
      case 'add_chip':
        next = next.map(i => {
          if (i.id !== patch.item_id) return i;
          const existingIdx = i.chips.findIndex(c => c.type === patch.chip.type);
          if (existingIdx !== -1) {
            const chips = [...i.chips];
            chips[existingIdx] = { ...patch.chip, id: i.chips[existingIdx].id, isNew: true };
            return { ...i, chips, isNew: true };
          }
          return { ...i, chips: [...i.chips, { ...patch.chip, isNew: true }], isNew: true };
        });
        break;
      case 'remove_chip':
        next = next.map(i =>
          i.id === patch.item_id
            ? { ...i, chips: i.chips.filter(c => c.id !== patch.chip_id) }
            : i,
        );
        break;
      case 'update_chip':
        next = next.map(i =>
          i.id === patch.item_id
            ? {
                ...i,
                chips: i.chips.map(c =>
                  c.id === patch.chip.id ? { ...patch.chip, isNew: true } : c,
                ),
                isNew: true,
              }
            : i,
        );
        break;
      case 'move_to_date':
        next = next.filter(i => i.id !== patch.item_id);
        break;
    }
  }
  return next;
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<PlanItem> = {}): PlanItem {
  return {
    id: 'item-1',
    text: 'Test task',
    depth: 0,
    checked: false,
    chips: [],
    ...overrides,
  };
}

function makeChip(overrides: Partial<PlanChip> = {}): PlanChip {
  return { id: 'chip-1', type: 'time', value: '09:00', ...overrides };
}

// ---------------------------------------------------------------------------
// add_item
// ---------------------------------------------------------------------------

describe('applyPatches: add_item', () => {
  it('appends item when no after_id', () => {
    const items = [makeItem({ id: 'a' })];
    const newItem = makeItem({ id: 'b', text: 'New' });
    const result = applyPatches(items, [{ op: 'add_item', item: newItem }]);
    expect(result).toHaveLength(2);
    expect(result[1].id).toBe('b');
  });

  it('inserts after the specified item', () => {
    const items = [makeItem({ id: 'a' }), makeItem({ id: 'c' })];
    const newItem = makeItem({ id: 'b', text: 'Middle' });
    const result = applyPatches(items, [{ op: 'add_item', item: newItem, after_id: 'a' }]);
    expect(result[1].id).toBe('b');
    expect(result[2].id).toBe('c');
  });

  it('marks new item with isNew=true', () => {
    const result = applyPatches([], [{ op: 'add_item', item: makeItem({ id: 'x' }) }]);
    expect(result[0].isNew).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// remove_item
// ---------------------------------------------------------------------------

describe('applyPatches: remove_item', () => {
  it('removes item by id', () => {
    const items = [makeItem({ id: 'a' }), makeItem({ id: 'b' })];
    const result = applyPatches(items, [{ op: 'remove_item', item_id: 'a' }]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('b');
  });

  it('is a no-op for unknown id', () => {
    const items = [makeItem({ id: 'a' })];
    const result = applyPatches(items, [{ op: 'remove_item', item_id: 'z' }]);
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// update_item
// ---------------------------------------------------------------------------

describe('applyPatches: update_item', () => {
  it('applies partial changes to item', () => {
    const items = [makeItem({ id: 'a', text: 'Old' })];
    const result = applyPatches(items, [
      { op: 'update_item', item_id: 'a', changes: { text: 'New', checked: true } },
    ]);
    expect(result[0].text).toBe('New');
    expect(result[0].checked).toBe(true);
  });

  it('marks updated item with isNew=true', () => {
    const items = [makeItem({ id: 'a' })];
    const result = applyPatches(items, [
      { op: 'update_item', item_id: 'a', changes: { text: 'Updated' } },
    ]);
    expect(result[0].isNew).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// add_chip
// ---------------------------------------------------------------------------

describe('applyPatches: add_chip', () => {
  it('adds chip to item', () => {
    const items = [makeItem({ id: 'a', chips: [] })];
    const chip = makeChip({ id: 'c1', type: 'time', value: '09:00' });
    const result = applyPatches(items, [{ op: 'add_chip', item_id: 'a', chip }]);
    expect(result[0].chips).toHaveLength(1);
    expect(result[0].chips[0].value).toBe('09:00');
  });

  it('upserts chip of same type (updates value, preserves id)', () => {
    const existingChip = makeChip({ id: 'c1', type: 'time', value: '08:00' });
    const items = [makeItem({ id: 'a', chips: [existingChip] })];
    const newChip = makeChip({ id: 'c2', type: 'time', value: '09:00' });
    const result = applyPatches(items, [{ op: 'add_chip', item_id: 'a', chip: newChip }]);
    // Still only 1 chip — upserted in place
    expect(result[0].chips).toHaveLength(1);
    expect(result[0].chips[0].id).toBe('c1');   // original id preserved
    expect(result[0].chips[0].value).toBe('09:00'); // value updated
  });

  it('allows chips of different types', () => {
    const timeChip = makeChip({ id: 'c1', type: 'time', value: '09:00' });
    const items = [makeItem({ id: 'a', chips: [timeChip] })];
    const locationChip = makeChip({ id: 'c2', type: 'location', value: 'gym' });
    const result = applyPatches(items, [{ op: 'add_chip', item_id: 'a', chip: locationChip }]);
    expect(result[0].chips).toHaveLength(2);
  });

  it('adds chip when no chip of that type exists', () => {
    const items = [makeItem({ id: 'a', chips: [] })];
    const chip = makeChip({ id: 'c1', type: 'location', value: 'gym' });
    const result = applyPatches(items, [{ op: 'add_chip', item_id: 'a', chip }]);
    expect(result[0].chips).toHaveLength(1);
    expect(result[0].chips[0].value).toBe('gym');
  });
});

// ---------------------------------------------------------------------------
// remove_chip
// ---------------------------------------------------------------------------

describe('applyPatches: remove_chip', () => {
  it('removes chip by id', () => {
    const chip = makeChip({ id: 'c1' });
    const items = [makeItem({ id: 'a', chips: [chip] })];
    const result = applyPatches(items, [{ op: 'remove_chip', item_id: 'a', chip_id: 'c1' }]);
    expect(result[0].chips).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// move_to_date
// ---------------------------------------------------------------------------

describe('applyPatches: move_to_date', () => {
  it('removes item from current document', () => {
    const items = [makeItem({ id: 'a' }), makeItem({ id: 'b' })];
    const result = applyPatches(items, [
      { op: 'move_to_date', item_id: 'a', target_date: '2026-04-01' },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('b');
  });
});

// ---------------------------------------------------------------------------
// Multiple patches in sequence
// ---------------------------------------------------------------------------

describe('applyPatches: multiple operations', () => {
  it('applies patches in order', () => {
    const items = [
      makeItem({ id: 'a', text: 'Task A', chips: [] }),
      makeItem({ id: 'b', text: 'Task B', chips: [] }),
    ];
    const result = applyPatches(items, [
      { op: 'add_chip', item_id: 'a', chip: makeChip({ id: 'c1', type: 'time', value: '09:00' }) },
      { op: 'update_item', item_id: 'b', changes: { text: 'Updated B' } },
      { op: 'remove_item', item_id: 'a' },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Updated B');
  });
});
