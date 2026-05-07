import React from 'react';
import { render, waitFor, fireEvent, act } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { MemoryScreen } from '../../src/screens/settings/screens/MemoryScreen';
import type { MemoryEntry, EntityEntry } from '../../src/apiClient';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
    useNavigation: () => ({ goBack: mockGoBack }),
    useFocusEffect: (cb: any) => {
        require('react').useEffect(cb, []);
    },
}));

jest.mock('../../src/context/ThemeContext', () => ({
    useTheme: () => ({
        theme: {
            background: '#000', textPrimary: '#fff', textSecondary: '#aaa',
            fadedText: '#666', accent: '#f00', surface: '#111', error: '#ef4444',
        },
        themeName: 'retroSunset',
    }),
}));

const mockMemoryList = jest.fn();
const mockMemoryDelete = jest.fn();
const mockEntityList = jest.fn();

jest.mock('../../src/apiClient', () => ({
    memoryApi: {
        list: (...a: any[]) => mockMemoryList(...a),
        delete: (...a: any[]) => mockMemoryDelete(...a),
    },
    entityApi: {
        list: (...a: any[]) => mockEntityList(...a),
    },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMemory(id: string, memory: string, created_at = '2024-01-01T00:00:00Z'): MemoryEntry {
    return { id, memory, created_at };
}

function makeEntity(id: string, name: string, entity_type = 'person', facts: any[] = []): EntityEntry {
    return { id, entity_id: id, name, entity_type, facts };
}

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
    jest.clearAllMocks();
    mockMemoryList.mockResolvedValue([]);
    mockEntityList.mockResolvedValue([]);
    mockMemoryDelete.mockResolvedValue(undefined);
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('MemoryScreen — structure', () => {
    it('renders the screen title', async () => {
        const { getByText } = render(<MemoryScreen />);
        expect(getByText('Memory')).toBeTruthy();
    });

    it('shows loading indicator on initial render', () => {
        mockMemoryList.mockReturnValue(new Promise(() => {})); // never resolves
        mockEntityList.mockReturnValue(new Promise(() => {}));
        const { UNSAFE_getByType } = render(<MemoryScreen />);
        const { ActivityIndicator } = require('react-native');
        expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
    });
});

describe('MemoryScreen — empty state', () => {
    it('shows empty-state message when no memories and no entities', async () => {
        const { getByText } = render(<MemoryScreen />);
        await waitFor(() => expect(getByText(/No memories yet/)).toBeTruthy());
    });
});

describe('MemoryScreen — memory list', () => {
    it('renders memory text entries', async () => {
        mockMemoryList.mockResolvedValue([
            makeMemory('m1', 'User prefers dark mode'),
            makeMemory('m2', 'User is a software engineer'),
        ]);
        const { getByText } = render(<MemoryScreen />);
        await waitFor(() => expect(getByText('User prefers dark mode')).toBeTruthy());
        expect(getByText('User is a software engineer')).toBeTruthy();
    });

    it('shows "Memories" section title when memories exist', async () => {
        mockMemoryList.mockResolvedValue([makeMemory('m1', 'Some fact')]);
        const { getByText } = render(<MemoryScreen />);
        await waitFor(() => expect(getByText('Memories')).toBeTruthy());
    });
});

describe('MemoryScreen — entity list', () => {
    it('renders entity name', async () => {
        mockEntityList.mockResolvedValue([makeEntity('e1', 'Alice')]);
        const { getByText } = render(<MemoryScreen />);
        await waitFor(() => expect(getByText('Alice')).toBeTruthy());
    });

    it('renders entity type badge', async () => {
        mockEntityList.mockResolvedValue([makeEntity('e1', 'Alice', 'person')]);
        const { getByText } = render(<MemoryScreen />);
        await waitFor(() => expect(getByText('person')).toBeTruthy());
    });

    it('renders entity facts', async () => {
        const facts = [
            { id: 'f1', content: 'Likes coffee' },
            { id: 'f2', content: 'Works at Acme' },
        ];
        mockEntityList.mockResolvedValue([makeEntity('e1', 'Alice', 'person', facts)]);
        const { getByText } = render(<MemoryScreen />);
        await waitFor(() => expect(getByText(/Likes coffee/)).toBeTruthy());
        expect(getByText(/Works at Acme/)).toBeTruthy();
    });

    it('shows "Entity Memory" section title when entities exist', async () => {
        mockEntityList.mockResolvedValue([makeEntity('e1', 'Bob')]);
        const { getByText } = render(<MemoryScreen />);
        await waitFor(() => expect(getByText('Entity Memory')).toBeTruthy());
    });
});

describe('MemoryScreen — navigation', () => {
    it('calls navigation.goBack() when back icon is pressed', async () => {
        const { getByTestId } = render(<MemoryScreen />);
        await waitFor(() => expect(mockMemoryList).toHaveBeenCalled());
        fireEvent.press(getByTestId('NavArrowLeft'));
        expect(mockGoBack).toHaveBeenCalledTimes(1);
    });
});

describe('MemoryScreen — delete', () => {
    it('shows Alert.alert when trash button is pressed', async () => {
        const alertSpy = jest.spyOn(Alert, 'alert');
        mockMemoryList.mockResolvedValue([makeMemory('m1', 'Delete me')]);
        const { getByTestId } = render(<MemoryScreen />);
        await waitFor(() => expect(mockMemoryList).toHaveBeenCalled());
        fireEvent.press(getByTestId('Trash'));
        expect(alertSpy).toHaveBeenCalledWith(
            'Delete Memory',
            expect.any(String),
            expect.any(Array),
        );
    });

    it('calls memoryApi.delete with the correct id when Delete is confirmed', async () => {
        jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
            const deleteBtn = (buttons as any[]).find(b => b.text === 'Delete');
            deleteBtn?.onPress?.();
        });
        mockMemoryList.mockResolvedValue([makeMemory('m1', 'Bye')]);
        const { getByTestId } = render(<MemoryScreen />);
        await waitFor(() => expect(mockMemoryList).toHaveBeenCalled());
        fireEvent.press(getByTestId('Trash'));
        await waitFor(() => expect(mockMemoryDelete).toHaveBeenCalledWith('m1'));
    });
});
