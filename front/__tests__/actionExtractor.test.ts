import { Platform } from 'react-native';
import { extractActions } from '../src/services/actionExtractor';

// Mock react-native Platform
jest.mock('react-native', () => ({
    Platform: { OS: 'ios' },
}));

// Mock @react-native-ai/apple and ai
const mockGenerateText = jest.fn<Promise<{ text?: string }>, [object]>();
jest.mock('@react-native-ai/apple', () => ({
    apple: () => 'apple-model',
}));
jest.mock('ai', () => ({
    generateText: (args: object) => mockGenerateText(args),
}));

describe('extractActions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (Platform as any).OS = 'ios';
    });

    it('returns [] on Android without calling AFM', async () => {
        (Platform as any).OS = 'android';
        const result = await extractActions('Meet me at Central Park');
        expect(result).toEqual([]);
        expect(mockGenerateText).not.toHaveBeenCalled();
    });

    it('parses valid JSON array of actions', async () => {
        mockGenerateText.mockResolvedValueOnce({
            text: '[{"command":"open_maps","label":"Central Park","url":"maps://?daddr=40.785,-73.968"}]',
        });
        const result = await extractActions('Meet me at Central Park');
        expect(result).toHaveLength(1);
        expect(result[0].command).toBe('open_maps');
        expect(result[0].label).toBe('Central Park');
        expect(result[0].url).toBe('maps://?daddr=40.785,-73.968');
    });

    it('returns [] when AFM returns empty array', async () => {
        mockGenerateText.mockResolvedValueOnce({ text: '[]' });
        const result = await extractActions('The sky is blue.');
        expect(result).toEqual([]);
    });

    it('returns [] when AFM returns malformed JSON', async () => {
        mockGenerateText.mockResolvedValueOnce({ text: 'not json at all' });
        const result = await extractActions('Some text');
        expect(result).toEqual([]);
    });

    it('returns [] when AFM times out', async () => {
        jest.useFakeTimers();
        // Never resolves → the queue's per-task timeout must fire.
        mockGenerateText.mockImplementation(
            () => new Promise<{ text?: string }>(() => {}),
        );
        const promise = extractActions('Some text');
        // Flush the queue's microtask chain so the timeout timer is scheduled.
        await Promise.resolve();
        await Promise.resolve();
        jest.advanceTimersByTime(13_000);
        const result = await promise;
        expect(result).toEqual([]);
        jest.useRealTimers();
    });

    it('filters out items missing command or label', async () => {
        mockGenerateText.mockResolvedValueOnce({
            text: '[{"command":"open_maps","label":"Valid"},{"url":"https://example.com"}]',
        });
        const result = await extractActions('Some text');
        expect(result).toHaveLength(1);
        expect(result[0].command).toBe('open_maps');
    });

    it('truncates long input to 2000 chars', async () => {
        mockGenerateText.mockResolvedValueOnce({ text: '[]' });
        const longText = 'a'.repeat(5000);
        await extractActions(longText);
        const callArgs = mockGenerateText.mock.calls[0][0];
        expect(callArgs.prompt).toContain('a'.repeat(2000));
        expect(callArgs.prompt).not.toContain('a'.repeat(2001));
    });

    it('returns [] when AFM rejects with an error', async () => {
        mockGenerateText.mockRejectedValueOnce(new Error('AFM crash'));
        const result = await extractActions('Some text');
        expect(result).toEqual([]);
    });
});
