import { truncate, formatMessageId, wsLogger, messageLogger, storeLogger } from '../../src/utils/logger';

describe('truncate', () => {
    it('returns empty string for falsy input', () => {
        expect(truncate('')).toBe('');
        expect(truncate(null as any)).toBe('');
    });

    it('returns string unchanged when within maxLength', () => {
        expect(truncate('Hello', 10)).toBe('Hello');
    });

    it('truncates and appends character count when over limit', () => {
        const long = 'a'.repeat(150);
        const result = truncate(long, 100);
        expect(result).toMatch(/^a{100}\.\.\..*chars\)$/);
        expect(result.startsWith('a'.repeat(100))).toBe(true);
    });

    it('uses default limit of 100', () => {
        const long = 'x'.repeat(101);
        const result = truncate(long);
        expect(result.startsWith('x'.repeat(100))).toBe(true);
        expect(result).toContain('101 chars');
    });

    it('returns string unchanged when exactly at maxLength', () => {
        const str = 'a'.repeat(50);
        expect(truncate(str, 50)).toBe(str);
    });
});

describe('formatMessageId', () => {
    it('returns only the id when agentId is absent', () => {
        expect(formatMessageId('msg-1')).toBe('msg-1');
    });

    it('combines id and agentId with a dash', () => {
        expect(formatMessageId('msg-1', 'agent-A')).toBe('msg-1-agent-A');
    });
});

describe('wsLogger — error always logs', () => {
    it('calls console.error for error()', () => {
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        wsLogger.error('connection lost', new Error('net'));
        expect(spy).toHaveBeenCalledTimes(1);
        spy.mockRestore();
    });
});

describe('wsLogger / messageLogger / storeLogger — dev-only methods do not throw', () => {
    it('wsLogger.received does not throw', () => {
        expect(() => wsLogger.received('frame received')).not.toThrow();
    });

    it('wsLogger.sent does not throw', () => {
        expect(() => wsLogger.sent('frame sent')).not.toThrow();
    });

    it('wsLogger.connection does not throw', () => {
        expect(() => wsLogger.connection('connected')).not.toThrow();
    });

    it('wsLogger.routing does not throw', () => {
        expect(() => wsLogger.routing('routing to room')).not.toThrow();
    });

    it('wsLogger.store does not throw', () => {
        expect(() => wsLogger.store('store updated')).not.toThrow();
    });

    it('messageLogger.start does not throw', () => {
        expect(() => messageLogger.start('handleText')).not.toThrow();
    });

    it('messageLogger.complete does not throw', () => {
        expect(() => messageLogger.complete('handleText')).not.toThrow();
    });

    it('messageLogger.skip does not throw', () => {
        expect(() => messageLogger.skip('handleText', 'empty')).not.toThrow();
    });

    it('storeLogger.action does not throw', () => {
        expect(() => storeLogger.action('appendMessage')).not.toThrow();
    });

    it('storeLogger.before does not throw', () => {
        expect(() => storeLogger.before('update')).not.toThrow();
    });

    it('storeLogger.after does not throw', () => {
        expect(() => storeLogger.after('update')).not.toThrow();
    });

    it('storeLogger.skip does not throw', () => {
        expect(() => storeLogger.skip('duplicate')).not.toThrow();
    });
});
