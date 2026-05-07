import { renderHook, act, waitFor } from '@testing-library/react-native';
import { usePlanDocument } from '../../src/screens/planner/hooks/usePlanDocument';
import type { PlanDocument, PlanItem, PlanChip } from '../../src/screens/planner/types';

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../../src/config', () => ({ getApiUrl: () => 'http://test' }));

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();
jest.mock('../../src/apiClient', () => ({
    apiClient: { get: (...a: any[]) => mockGet(...a), post: (...a: any[]) => mockPost(...a), patch: (...a: any[]) => mockPatch(...a) },
}));

// AppState is provided by the react-native jest preset; spy on it per test
import { AppState } from 'react-native';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDoc(items: PlanItem[] = []): PlanDocument {
    return { id: 'doc-1', date: '2024-06-15', items, createdAt: '', updatedAt: '' };
}

function makeItem(id: string, text = 'Task', extra: Partial<PlanItem> = {}): PlanItem {
    return { id, text, depth: 0, checked: false, chips: [], ...extra };
}

function makeChip(type: PlanChip['type'], value: string): PlanChip {
    return { id: `chip-${type}`, type, value };
}

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() } as any);
    mockGet.mockResolvedValue(makeDoc());
    mockPatch.mockResolvedValue(makeDoc());
});

afterEach(() => {
    jest.useRealTimers();
});

async function renderAndLoad(items: PlanItem[] = []) {
    mockGet.mockResolvedValue(makeDoc(items));
    const hook = renderHook(() => usePlanDocument('2024-06-15'));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    return hook;
}

// ── Loading ───────────────────────────────────────────────────────────────────

describe('usePlanDocument — loading', () => {
    it('starts in loading state', () => {
        const { result } = renderHook(() => usePlanDocument('2024-06-15'));
        expect(result.current.loading).toBe(true);
    });

    it('loads document from API and sets items', async () => {
        const { result } = await renderAndLoad([makeItem('i1', 'Buy milk')]);
        expect(result.current.items).toHaveLength(1);
        expect(result.current.items[0].text).toBe('Buy milk');
    });

    it('creates a new document when GET returns null', async () => {
        mockGet.mockResolvedValueOnce(null);
        mockPost.mockResolvedValueOnce(makeDoc([makeItem('i1', 'New')]));
        const { result } = renderHook(() => usePlanDocument('2024-06-15'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(mockPost).toHaveBeenCalledTimes(1);
        expect(result.current.items).toHaveLength(1);
    });

    it('creates a new document when GET throws', async () => {
        mockGet.mockRejectedValueOnce(new Error('404'));
        mockPost.mockResolvedValueOnce(makeDoc());
        const { result } = renderHook(() => usePlanDocument('2024-06-15'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(mockPost).toHaveBeenCalledTimes(1);
    });
});

// ── addItem ───────────────────────────────────────────────────────────────────

describe('usePlanDocument — addItem', () => {
    it('appends a new empty item', async () => {
        const { result } = await renderAndLoad();
        act(() => { result.current.addItem(); });
        expect(result.current.items).toHaveLength(1);
        expect(result.current.items[0].text).toBe('');
    });

    it('returns the new item id', async () => {
        const { result } = await renderAndLoad();
        let id!: string;
        act(() => { id = result.current.addItem(); });
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
    });

    it('inserts after the specified item', async () => {
        const { result } = await renderAndLoad([makeItem('i1', 'First'), makeItem('i2', 'Third')]);
        act(() => { result.current.addItem('i1'); });
        expect(result.current.items[1].text).toBe('');
        expect(result.current.items[2].text).toBe('Third');
    });

    it('appends at end when afterId is not found', async () => {
        const { result } = await renderAndLoad([makeItem('i1', 'A')]);
        act(() => { result.current.addItem('nonexistent'); });
        expect(result.current.items).toHaveLength(2);
        expect(result.current.items[1].text).toBe('');
    });
});

// ── removeItem ────────────────────────────────────────────────────────────────

describe('usePlanDocument — removeItem', () => {
    it('removes the item with the given id', async () => {
        const { result } = await renderAndLoad([makeItem('i1', 'A'), makeItem('i2', 'B')]);
        act(() => { result.current.removeItem('i1'); });
        expect(result.current.items).toHaveLength(1);
        expect(result.current.items[0].id).toBe('i2');
    });

    it('does nothing when id does not exist', async () => {
        const { result } = await renderAndLoad([makeItem('i1', 'A')]);
        act(() => { result.current.removeItem('none'); });
        expect(result.current.items).toHaveLength(1);
    });
});

// ── updateItem ────────────────────────────────────────────────────────────────

describe('usePlanDocument — updateItem', () => {
    it('updates text of the specified item', async () => {
        const { result } = await renderAndLoad([makeItem('i1', 'Old text')]);
        act(() => { result.current.updateItem('i1', { text: 'New text' }); });
        expect(result.current.items[0].text).toBe('New text');
    });

    it('does not affect other items', async () => {
        const { result } = await renderAndLoad([makeItem('i1', 'A'), makeItem('i2', 'B')]);
        act(() => { result.current.updateItem('i1', { text: 'X' }); });
        expect(result.current.items[1].text).toBe('B');
    });
});

// ── moveItem ──────────────────────────────────────────────────────────────────

describe('usePlanDocument — moveItem', () => {
    it('moves item from index 0 to index 1', async () => {
        const { result } = await renderAndLoad([makeItem('i1', 'A'), makeItem('i2', 'B')]);
        act(() => { result.current.moveItem(0, 1); });
        expect(result.current.items[0].id).toBe('i2');
        expect(result.current.items[1].id).toBe('i1');
    });

    it('ignores out-of-bounds indices', async () => {
        const { result } = await renderAndLoad([makeItem('i1', 'A')]);
        act(() => { result.current.moveItem(0, 5); });
        expect(result.current.items).toHaveLength(1);
        expect(result.current.items[0].id).toBe('i1');
    });
});

// ── indentItem ────────────────────────────────────────────────────────────────

describe('usePlanDocument — indentItem', () => {
    it('increases depth by 1', async () => {
        const { result } = await renderAndLoad([makeItem('i1', 'A', { depth: 0 })]);
        act(() => { result.current.indentItem('i1', 1); });
        expect(result.current.items[0].depth).toBe(1);
    });

    it('decreases depth by 1', async () => {
        const { result } = await renderAndLoad([makeItem('i1', 'A', { depth: 1 })]);
        act(() => { result.current.indentItem('i1', -1); });
        expect(result.current.items[0].depth).toBe(0);
    });

    it('clamps depth at 0 (no negative)', async () => {
        const { result } = await renderAndLoad([makeItem('i1', 'A', { depth: 0 })]);
        act(() => { result.current.indentItem('i1', -1); });
        expect(result.current.items[0].depth).toBe(0);
    });

    it('clamps depth at 2 (no deeper than 2)', async () => {
        const { result } = await renderAndLoad([makeItem('i1', 'A', { depth: 2 })]);
        act(() => { result.current.indentItem('i1', 1); });
        expect(result.current.items[0].depth).toBe(2);
    });
});

// ── toggleChecked ──────────────────────────────────────────────────────────────

describe('usePlanDocument — toggleChecked', () => {
    it('checks an unchecked item', async () => {
        const { result } = await renderAndLoad([makeItem('i1', 'A', { checked: false })]);
        act(() => { result.current.toggleChecked('i1'); });
        expect(result.current.items[0].checked).toBe(true);
    });

    it('unchecks a checked item', async () => {
        const { result } = await renderAndLoad([makeItem('i1', 'A', { checked: true })]);
        act(() => { result.current.toggleChecked('i1'); });
        expect(result.current.items[0].checked).toBe(false);
    });
});

// ── applyPatches ──────────────────────────────────────────────────────────────

describe('usePlanDocument — applyPatches', () => {
    it('add_item appends a new item', async () => {
        const { result } = await renderAndLoad();
        const newItem = makeItem('new1', 'New task');
        act(() => { result.current.applyPatches([{ op: 'add_item', item: newItem }]); });
        expect(result.current.items.some(i => i.id === 'new1')).toBe(true);
    });

    it('remove_item removes a specific item', async () => {
        const { result } = await renderAndLoad([makeItem('i1', 'A'), makeItem('i2', 'B')]);
        act(() => { result.current.applyPatches([{ op: 'remove_item', item_id: 'i1' }]); });
        expect(result.current.items.find(i => i.id === 'i1')).toBeUndefined();
    });

    it('update_item changes item fields', async () => {
        const { result } = await renderAndLoad([makeItem('i1', 'Old')]);
        act(() => { result.current.applyPatches([{ op: 'update_item', item_id: 'i1', changes: { text: 'Updated' } }]); });
        expect(result.current.items[0].text).toBe('Updated');
    });

    it('add_chip appends a new chip', async () => {
        const { result } = await renderAndLoad([makeItem('i1', 'Meeting at 9am')]);
        const chip = makeChip('time', '09:00');
        act(() => { result.current.applyPatches([{ op: 'add_chip', item_id: 'i1', chip }]); });
        expect(result.current.items[0].chips.some(c => c.type === 'time')).toBe(true);
    });

    it('add_chip strips time from text when adding time chip', async () => {
        const { result } = await renderAndLoad([makeItem('i1', 'Meeting at 09:00')]);
        const chip = makeChip('time', '09:00');
        act(() => { result.current.applyPatches([{ op: 'add_chip', item_id: 'i1', chip }]); });
        expect(result.current.items[0].text).not.toContain('09:00');
    });

    it('add_chip does not overwrite user-pinned chip', async () => {
        const userChip: PlanChip = { id: 'uc1', type: 'time', value: '10:00', source: 'user' };
        const { result } = await renderAndLoad([makeItem('i1', 'A', { chips: [userChip] })]);
        const aiChip = makeChip('time', '15:00');
        act(() => { result.current.applyPatches([{ op: 'add_chip', item_id: 'i1', chip: aiChip }]); });
        // User chip should be untouched
        expect(result.current.items[0].chips[0].value).toBe('10:00');
    });

    it('remove_chip removes a specific chip', async () => {
        const chip = makeChip('note', 'reminder');
        const { result } = await renderAndLoad([makeItem('i1', 'A', { chips: [chip] })]);
        act(() => { result.current.applyPatches([{ op: 'remove_chip', item_id: 'i1', chip_id: chip.id }]); });
        expect(result.current.items[0].chips).toHaveLength(0);
    });

    it('reorder_items reorders by given ids', async () => {
        const { result } = await renderAndLoad([
            makeItem('i1', 'A'), makeItem('i2', 'B'), makeItem('i3', 'C'),
        ]);
        act(() => { result.current.applyPatches([{ op: 'reorder_items', ids: ['i3', 'i1', 'i2'] }]); });
        expect(result.current.items.map(i => i.id)).toEqual(['i3', 'i1', 'i2']);
    });

    it('sets bannerMessage when bannerText is provided', async () => {
        const { result } = await renderAndLoad();
        act(() => { result.current.applyPatches([], 'AI updated your plan'); });
        expect(result.current.bannerMessage).toBe('AI updated your plan');
    });

    it('auto-sorts by time chip after add_chip with time', async () => {
        const { result } = await renderAndLoad([
            makeItem('i1', 'Late', { chips: [makeChip('time', '14:00')] }),
            makeItem('i2', 'Early', { chips: [] }),
        ]);
        act(() => {
            result.current.applyPatches([
                { op: 'add_chip', item_id: 'i2', chip: makeChip('time', '09:00') },
            ]);
        });
        // After sort: i2 (09:00) should come before i1 (14:00)
        expect(result.current.items[0].id).toBe('i2');
    });
});

// ── bannerMessage / clearBanner ───────────────────────────────────────────────

describe('usePlanDocument — banner', () => {
    it('clearBanner sets bannerMessage to null', async () => {
        const { result } = await renderAndLoad();
        act(() => { result.current.setBannerMessage('Hello'); });
        expect(result.current.bannerMessage).toBe('Hello');
        act(() => { result.current.clearBanner(); });
        expect(result.current.bannerMessage).toBeNull();
    });
});
