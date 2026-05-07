import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { GreetingCard } from '../../src/screens/dashboard/components/GreetingCard';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockTheme = {
    surface: '#fff', border: '#ccc', text: '#000', textSecondary: '#666',
    background: '#f5f5f5', primary: '#007AFF',
};
jest.mock('../../src/context/ThemeContext', () => ({
    useTheme: () => ({ theme: mockTheme }),
}));

const mockGetStoredLocation = jest.fn();
jest.mock('../../src/services/location/locationService', () => ({
    getStoredLocation: (...a: any[]) => mockGetStoredLocation(...a),
}));

const mockGetCurrentWeather = jest.fn();
jest.mock('../../src/apiClient', () => ({
    weatherApi: { getCurrentWeather: (...a: any[]) => mockGetCurrentWeather(...a) },
}));

// ── Setup ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockGetStoredLocation.mockResolvedValue({ lat: 51.5, lon: -0.1 });
    mockGetCurrentWeather.mockResolvedValue(null);
});

afterEach(() => {
    jest.useRealTimers();
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('GreetingCard — greeting text', () => {
    it('shows "Good morning" before noon', async () => {
        jest.setSystemTime(new Date('2024-06-15T08:00:00'));
        const { getByText } = render(<GreetingCard />);
        await waitFor(() => expect(mockGetCurrentWeather).toHaveBeenCalled());
        expect(getByText(/Good morning!/)).toBeTruthy();
    });

    it('shows "Good afternoon" between noon and 18:00', async () => {
        jest.setSystemTime(new Date('2024-06-15T14:00:00'));
        const { getByText } = render(<GreetingCard />);
        await waitFor(() => expect(mockGetCurrentWeather).toHaveBeenCalled());
        expect(getByText(/Good afternoon!/)).toBeTruthy();
    });

    it('shows "Good evening" after 18:00', async () => {
        jest.setSystemTime(new Date('2024-06-15T20:00:00'));
        const { getByText } = render(<GreetingCard />);
        await waitFor(() => expect(mockGetCurrentWeather).toHaveBeenCalled());
        expect(getByText(/Good evening!/)).toBeTruthy();
    });

    it('appends userName when provided', async () => {
        jest.setSystemTime(new Date('2024-06-15T08:00:00'));
        const { getByText } = render(<GreetingCard userName="Alice" />);
        await waitFor(() => expect(mockGetCurrentWeather).toHaveBeenCalled());
        expect(getByText(/Alice/)).toBeTruthy();
    });

    it('does not crash when userName is omitted', async () => {
        jest.setSystemTime(new Date('2024-06-15T08:00:00'));
        const { getByText } = render(<GreetingCard />);
        await waitFor(() => expect(mockGetCurrentWeather).toHaveBeenCalled());
        expect(getByText(/Good morning!/)).toBeTruthy();
    });
});

describe('GreetingCard — weather', () => {
    it('shows temperature when weather loads successfully', async () => {
        mockGetCurrentWeather.mockResolvedValueOnce({
            current_weather: { temperature: 22.4, weathercode: 0 },
        });
        const { getByText } = render(<GreetingCard />);
        await waitFor(() => expect(getByText('22°')).toBeTruthy());
    });

    it('does not show temperature when weather fetch returns null', async () => {
        mockGetCurrentWeather.mockResolvedValueOnce(null);
        const { queryByText } = render(<GreetingCard />);
        await waitFor(() => expect(mockGetCurrentWeather).toHaveBeenCalled());
        expect(queryByText(/°/)).toBeNull();
    });

    it('does not show temperature when weather fetch throws', async () => {
        mockGetCurrentWeather.mockRejectedValueOnce(new Error('network'));
        const { queryByText } = render(<GreetingCard />);
        await waitFor(() => expect(mockGetCurrentWeather).toHaveBeenCalled());
        expect(queryByText(/°/)).toBeNull();
    });

    it('rounds fractional temperature', async () => {
        mockGetCurrentWeather.mockResolvedValueOnce({
            current_weather: { temperature: 18.7, weathercode: 0 },
        });
        const { getByText } = render(<GreetingCard />);
        await waitFor(() => expect(getByText('19°')).toBeTruthy());
    });
});
