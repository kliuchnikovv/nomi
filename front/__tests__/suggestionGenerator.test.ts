import { Platform } from 'react-native';
import { generateFollowUps } from '../src/services/suggestionGenerator';

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

describe('generateFollowUps', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (Platform as any).OS = 'ios';
    });

    it('returns [] on Android without calling AFM', async () => {
        (Platform as any).OS = 'android';
        const result = await generateFollowUps('Here is your summary.');
        expect(result).toEqual([]);
        expect(mockGenerateText).not.toHaveBeenCalled();
    });

    it('returns [] for empty assistant text', async () => {
        const result = await generateFollowUps('   ');
        expect(result).toEqual([]);
        expect(mockGenerateText).not.toHaveBeenCalled();
    });

    it('parses a valid JSON array of strings', async () => {
        mockGenerateText.mockResolvedValueOnce({
            text: '["Tell me more", "Show an example"]',
        });
        const result = await generateFollowUps('Here is your summary.');
        expect(result).toEqual(['Tell me more', 'Show an example']);
    });

    it('includes the user message in the prompt when provided', async () => {
        mockGenerateText.mockResolvedValueOnce({ text: '[]' });
        await generateFollowUps('A reply', 'My question');
        const callArgs = mockGenerateText.mock.calls[0][0] as {
            prompt: string;
        };
        expect(callArgs.prompt).toContain('My question');
        expect(callArgs.prompt).toContain('A reply');
    });

    it('filters out non-strings and over-long items, caps at 4', async () => {
        const longStr = 'x'.repeat(100);
        mockGenerateText.mockResolvedValueOnce({
            text: JSON.stringify(['a', 123, longStr, 'b', 'c', 'd', 'e']),
        });
        const result = await generateFollowUps('A reply');
        expect(result).toEqual(['a', 'b', 'c', 'd']);
    });

    it('returns [] when AFM returns malformed JSON', async () => {
        mockGenerateText.mockResolvedValueOnce({ text: 'not json' });
        const result = await generateFollowUps('A reply');
        expect(result).toEqual([]);
    });

    it('parses arrays wrapped in markdown code fences', async () => {
        mockGenerateText.mockResolvedValueOnce({
            text: '```json\n["Yes, do it", "Show the tests"]\n```',
        });
        const result = await generateFollowUps('A reply');
        expect(result).toEqual(['Yes, do it', 'Show the tests']);
    });

    it('extracts the array when surrounded by prose', async () => {
        mockGenerateText.mockResolvedValueOnce({
            text: 'Sure! Here are some: ["Option A", "Option B"] hope that helps',
        });
        const result = await generateFollowUps('A reply');
        expect(result).toEqual(['Option A', 'Option B']);
    });

    it('parses newline-separated suggestions (no JSON)', async () => {
        mockGenerateText.mockResolvedValueOnce({
            text: 'Tell me more\nShow an example\nWrite the code',
        });
        const result = await generateFollowUps('A reply');
        expect(result).toEqual([
            'Tell me more',
            'Show an example',
            'Write the code',
        ]);
    });

    it('strips bullets/numbering from newline output', async () => {
        mockGenerateText.mockResolvedValueOnce({
            text: '1. First option\n2. Second option',
        });
        const result = await generateFollowUps('A reply');
        expect(result).toEqual(['First option', 'Second option']);
    });

    it('ignores a single prose line (needs >= 2 lines)', async () => {
        mockGenerateText.mockResolvedValueOnce({
            text: 'Here are some ideas for you to consider next.',
        });
        const result = await generateFollowUps('A reply');
        expect(result).toEqual([]);
    });

    it('coerces array-of-objects into strings', async () => {
        mockGenerateText.mockResolvedValueOnce({
            text: '[{"text":"Write it here"},{"label":"Try later"}]',
        });
        const result = await generateFollowUps('A reply');
        expect(result).toEqual(['Write it here', 'Try later']);
    });

    it('returns [] when AFM times out', async () => {
        jest.useFakeTimers();
        // Never resolves → the queue's per-task timeout must fire.
        mockGenerateText.mockImplementation(
            () => new Promise<{ text?: string }>(() => {}),
        );
        const promise = generateFollowUps('A reply');
        // Flush the queue's microtask chain so the timeout timer is scheduled.
        await Promise.resolve();
        await Promise.resolve();
        jest.advanceTimersByTime(13_000);
        const result = await promise;
        expect(result).toEqual([]);
        jest.useRealTimers();
    });

    it('returns [] when AFM rejects with an error', async () => {
        mockGenerateText.mockRejectedValueOnce(new Error('AFM crash'));
        const result = await generateFollowUps('A reply');
        expect(result).toEqual([]);
    });
});
