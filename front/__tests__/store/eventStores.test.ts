import { subscribeChatError, emitChatError } from '../../src/store/chatErrorStore';
import { subscribeGenerationDone, emitGenerationDone } from '../../src/store/generationDoneStore';

// ── chatErrorStore ────────────────────────────────────────────────────────────

describe('chatErrorStore', () => {
    it('calls subscribed handler when error is emitted', () => {
        const handler = jest.fn();
        subscribeChatError('chat-1', handler);
        emitChatError('chat-1', new Error('oops'));
        expect(handler).toHaveBeenCalledWith(expect.any(Error));
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('does not call handler for a different chatId', () => {
        const handler = jest.fn();
        subscribeChatError('chat-A', handler);
        emitChatError('chat-B', 'error');
        expect(handler).not.toHaveBeenCalled();
    });

    it('unsubscribes when returned cleanup function is called', () => {
        const handler = jest.fn();
        const unsub = subscribeChatError('chat-X', handler);
        unsub();
        emitChatError('chat-X', 'err');
        expect(handler).not.toHaveBeenCalled();
    });

    it('ignores unsubscribe if a newer handler replaced the old one', () => {
        const handler1 = jest.fn();
        const handler2 = jest.fn();
        const unsub1 = subscribeChatError('chat-Y', handler1);
        subscribeChatError('chat-Y', handler2); // replaces handler1
        unsub1(); // should NOT remove handler2
        emitChatError('chat-Y', 'x');
        expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('does not throw when no handler is registered for chatId', () => {
        expect(() => emitChatError('nonexistent', 'error')).not.toThrow();
    });

    it('does not throw when the handler itself throws', () => {
        subscribeChatError('chat-throw', () => { throw new Error('listener blew up'); });
        expect(() => emitChatError('chat-throw', 'e')).not.toThrow();
    });
});

// ── generationDoneStore ───────────────────────────────────────────────────────

describe('generationDoneStore', () => {
    it('calls all subscribed listeners when generation completes', () => {
        const fn1 = jest.fn();
        const fn2 = jest.fn();
        subscribeGenerationDone(fn1);
        subscribeGenerationDone(fn2);
        emitGenerationDone('chat-done');
        expect(fn1).toHaveBeenCalledWith('chat-done');
        expect(fn2).toHaveBeenCalledWith('chat-done');
    });

    it('unsubscribes listener via returned cleanup', () => {
        const fn = jest.fn();
        const unsub = subscribeGenerationDone(fn);
        unsub();
        emitGenerationDone('chat-z');
        expect(fn).not.toHaveBeenCalled();
    });

    it('does not throw when a listener throws', () => {
        subscribeGenerationDone(() => { throw new Error('bang'); });
        expect(() => emitGenerationDone('chat-err')).not.toThrow();
    });

    it('emits chatId to listeners', () => {
        const received: string[] = [];
        subscribeGenerationDone((id) => received.push(id));
        emitGenerationDone('my-chat');
        expect(received).toContain('my-chat');
    });
});
