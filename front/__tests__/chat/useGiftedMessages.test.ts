import { renderHook } from '@testing-library/react-native';
import { useGiftedMessages } from '../../src/screens/chat/hooks/useGiftedMessages';
import type { Message } from '../../src/screens/main/models';

function makeMsg(overrides: Partial<Message> = {}): Message {
    return {
        id: 'msg-1', chat_id: 'chat-1', role: 'assistant',
        text: 'Hello', created_at: 1_000_000,
        ...overrides,
    };
}

describe('useGiftedMessages', () => {
    describe('role → user mapping', () => {
        it('maps role=user to effectiveUserId', () => {
            const msg = makeMsg({ id: 'u1', role: 'user', created_at: 1 });
            const { result } = renderHook(() => useGiftedMessages([msg], 'alice'));
            expect(result.current[0].user._id).toBe('alice');
            expect(result.current[0].user.name).toBe('You');
        });

        it('uses "user" when no userId provided', () => {
            const msg = makeMsg({ id: 'u2', role: 'user', created_at: 1 });
            const { result } = renderHook(() => useGiftedMessages([msg]));
            expect(result.current[0].user._id).toBe('user');
        });

        it('maps role=assistant', () => {
            const msg = makeMsg({ id: 'a1', role: 'assistant', created_at: 1 });
            const { result } = renderHook(() => useGiftedMessages([msg]));
            expect(result.current[0].user._id).toBe('assistant');
            expect(result.current[0].user.name).toBe('Assistant');
        });

        it('maps role=system', () => {
            const msg = makeMsg({ id: 's1', role: 'system', created_at: 1 });
            const { result } = renderHook(() => useGiftedMessages([msg]));
            expect(result.current[0].user._id).toBe('system');
            expect(result.current[0].user.name).toBe('System');
        });
    });

    describe('extended fields passthrough', () => {
        it('passes through tool_calls, attachments, actions, content_parts, context_items', () => {
            const msg = makeMsg({
                id: 'ext1', created_at: 1,
                tool_calls: [{ id: 'tc1' }],
                attachments: [{ id: 'a1', url: 'http://x', name: 'f.png', content_type: 'image/png' }],
                actions: [{ id: 'act1' }],
                content_parts: [{ type: 'text', text: 'hi' }],
                context_items: [{ id: 'ci1' }],
            });
            const { result } = renderHook(() => useGiftedMessages([msg]));
            const out = result.current[0];
            expect(out.tool_calls).toEqual([{ id: 'tc1' }]);
            expect(out.attachments).toHaveLength(1);
            expect(out.actions).toEqual([{ id: 'act1' }]);
            expect(out.content_parts).toHaveLength(1);
            expect(out.context_items).toEqual([{ id: 'ci1' }]);
        });
    });

    describe('filtering', () => {
        it('excludes messages with empty text and no media', () => {
            const msg = makeMsg({ id: 'empty', text: '', created_at: 1 });
            const { result } = renderHook(() => useGiftedMessages([msg]));
            expect(result.current).toHaveLength(0);
        });

        it('excludes whitespace-only text with no media', () => {
            const msg = makeMsg({ id: 'ws', text: '   ', created_at: 1 });
            const { result } = renderHook(() => useGiftedMessages([msg]));
            expect(result.current).toHaveLength(0);
        });

        it('includes messages with empty text if they have attachments', () => {
            const msg = makeMsg({
                id: 'att', text: '',
                attachments: [{ id: 'a', url: 'u', name: 'n', content_type: 'image/png' }],
                created_at: 1,
            });
            const { result } = renderHook(() => useGiftedMessages([msg]));
            expect(result.current).toHaveLength(1);
        });

        it('includes messages with empty text if they have tool_calls', () => {
            const msg = makeMsg({ id: 'tc', text: '', tool_calls: [{ id: 'x' }], created_at: 1 });
            const { result } = renderHook(() => useGiftedMessages([msg]));
            expect(result.current).toHaveLength(1);
        });

        it('includes messages with empty text if they have content_parts', () => {
            const msg = makeMsg({ id: 'cp', text: '', content_parts: [{ type: 'text', text: 'a' }], created_at: 1 });
            const { result } = renderHook(() => useGiftedMessages([msg]));
            expect(result.current).toHaveLength(1);
        });
    });

    describe('sorting', () => {
        it('returns messages sorted descending (newest first)', () => {
            const older = makeMsg({ id: 'old', created_at: 1_000 });
            const newer = makeMsg({ id: 'new', created_at: 2_000 });
            const { result } = renderHook(() => useGiftedMessages([older, newer]));
            expect(result.current[0]._id).toBe('new');
            expect(result.current[1]._id).toBe('old');
        });

        it('handles created_at as ISO string', () => {
            const a = makeMsg({ id: 'a', created_at: '2024-01-01T10:00:00Z' });
            const b = makeMsg({ id: 'b', created_at: '2024-01-02T10:00:00Z' });
            const { result } = renderHook(() => useGiftedMessages([a, b]));
            expect(result.current[0]._id).toBe('b');
        });

        it('handles already-ascending input with fast-reverse path', () => {
            const msgs = [1_000, 2_000, 3_000].map((t, i) =>
                makeMsg({ id: `m${i}`, created_at: t }),
            );
            const { result } = renderHook(() => useGiftedMessages(msgs));
            expect(result.current.map(m => m._id)).toEqual(['m2', 'm1', 'm0']);
        });
    });

    describe('caching', () => {
        it('returns the same array reference when messages reference is unchanged', () => {
            const msgs = [makeMsg({ id: 'c1', created_at: 1 })];
            const { result, rerender } = renderHook(() => useGiftedMessages(msgs));
            const first = result.current;
            rerender({});
            expect(result.current).toBe(first);
        });

        it('recomputes when messages reference changes', () => {
            const msgs1 = [makeMsg({ id: 'x1', created_at: 1 })];
            const msgs2 = [makeMsg({ id: 'x1', created_at: 1 })]; // same content, different ref
            const { result, rerender } = renderHook(
                ({ ms }) => useGiftedMessages(ms),
                { initialProps: { ms: msgs1 } },
            );
            const first = result.current;
            rerender({ ms: msgs2 });
            expect(result.current).not.toBe(first);
        });
    });
});
