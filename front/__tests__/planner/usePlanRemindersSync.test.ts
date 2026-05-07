import { renderHook, act, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePlanRemindersSync } from '../../src/screens/planner/hooks/usePlanRemindersSync';
import type { PlanItem } from '../../src/screens/planner/types';

// ── Mocks ─────────────────────────────────────────────────────────────────────

import { Platform } from 'react-native';
let originalPlatformOS: string;
let platformOSSpy: jest.SpyInstance | null = null;

const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
jest.mock('../../src/services/integrations/clients/IOSRemindersClient', () => ({
    iosRemindersClient: {
        createReminder: (...a: any[]) => mockCreate(...a),
        updateReminder: (...a: any[]) => mockUpdate(...a),
        deleteReminder: (...a: any[]) => mockDelete(...a),
    },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeItem(id: string, text = 'Task', extra: Partial<PlanItem> = {}): PlanItem {
    return { id, text, depth: 0, checked: false, chips: [], ...extra };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    (AsyncStorage as any).clear();
    originalPlatformOS = Platform.OS;
    (Platform as any).OS = 'ios';
    mockCreate.mockResolvedValue({ id: 'rem-1' });
    mockUpdate.mockResolvedValue(undefined);
    mockDelete.mockResolvedValue(undefined);
});

afterEach(() => {
    jest.useRealTimers();
    (Platform as any).OS = originalPlatformOS;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('usePlanRemindersSync — non-iOS', () => {
    it('sync() returns immediately without calling reminders client', async () => {
        (Platform as any).OS = 'android';
        const { result } = renderHook(() =>
            usePlanRemindersSync('2024-06-15', [makeItem('i1')])
        );
        // Wait for AsyncStorage load
        await act(async () => { await Promise.resolve(); });
        await act(async () => { await result.current.sync(); });
        expect(mockCreate).not.toHaveBeenCalled();
        expect(mockUpdate).not.toHaveBeenCalled();
    });
});

describe('usePlanRemindersSync — iOS', () => {
    it('initial isSyncing is false', () => {
        const { result } = renderHook(() =>
            usePlanRemindersSync('2024-06-15', [])
        );
        expect(result.current.isSyncing).toBe(false);
    });

    it('initial lastSynced is null', () => {
        const { result } = renderHook(() =>
            usePlanRemindersSync('2024-06-15', [])
        );
        expect(result.current.lastSynced).toBeNull();
    });

    it('sync() creates reminders for new items', async () => {
        const items = [makeItem('i1', 'Buy groceries')];
        const { result } = renderHook(() =>
            usePlanRemindersSync('2024-06-15', items)
        );
        // Let the AsyncStorage load settle
        await act(async () => { await Promise.resolve(); });

        await act(async () => { await result.current.sync(); });

        expect(mockCreate).toHaveBeenCalledWith(
            'Buy groceries',
            expect.objectContaining({ list: 'Genie Plan' })
        );
    });

    it('sync() sets lastSynced after completing', async () => {
        const { result } = renderHook(() =>
            usePlanRemindersSync('2024-06-15', [makeItem('i1', 'Task')])
        );
        await act(async () => { await Promise.resolve(); });

        await act(async () => { await result.current.sync(); });

        expect(result.current.lastSynced).toBeInstanceOf(Date);
    });

    it('sync() does nothing for items with empty text', async () => {
        const items = [makeItem('i1', '   ')]; // whitespace only
        const { result } = renderHook(() =>
            usePlanRemindersSync('2024-06-15', items)
        );
        await act(async () => { await Promise.resolve(); });

        await act(async () => { await result.current.sync(); });

        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('sync() passes dueDate from time chip', async () => {
        const items = [makeItem('i1', 'Standup', {
            chips: [{ id: 'c1', type: 'time', value: '09:30' }],
        })];
        const { result } = renderHook(() =>
            usePlanRemindersSync('2024-06-15', items)
        );
        await act(async () => { await Promise.resolve(); });

        await act(async () => { await result.current.sync(); });

        expect(mockCreate).toHaveBeenCalledWith(
            'Standup',
            expect.objectContaining({ dueDate: '2024-06-15T09:30:00' })
        );
    });

    it('sync() updates reminder when mapping already exists', async () => {
        // Pre-populate AsyncStorage with an existing mapping
        await AsyncStorage.setItem(
            'planner_reminders_map_2024-06-15',
            JSON.stringify({ 'i1': 'rem-existing' })
        );
        const items = [makeItem('i1', 'Updated task')];
        const { result } = renderHook(() =>
            usePlanRemindersSync('2024-06-15', items)
        );
        // Wait for map to load
        await act(async () => { await Promise.resolve(); });
        await act(async () => { await Promise.resolve(); });

        await act(async () => { await result.current.sync(); });

        expect(mockUpdate).toHaveBeenCalledWith('rem-existing', expect.objectContaining({
            title: 'Updated task',
        }));
        expect(mockCreate).not.toHaveBeenCalled();
    });
});
