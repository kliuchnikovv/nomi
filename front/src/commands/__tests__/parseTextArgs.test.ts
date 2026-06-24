import { splitSlashCommand, parseTextArgs } from '../parseTextArgs';
import type { CommandSpec } from '../types';

function spec(properties: object): CommandSpec {
    return {
        name: 'x',
        title: 'X',
        description: '',
        requires: [],
        missing: [],
        args_schema: { properties },
        surface: 'chat',
    };
}

describe('splitSlashCommand', () => {
    it('returns null for non-slash text', () => {
        expect(splitSlashCommand('hello world')).toBeNull();
    });
    it('splits name and remainder', () => {
        expect(splitSlashCommand('/recall vegan food')).toEqual({
            name: 'recall',
            rest: 'vegan food',
        });
    });
    it('handles a bare command with no args', () => {
        expect(splitSlashCommand('/today')).toEqual({
            name: 'today',
            rest: '',
        });
    });
});

describe('parseTextArgs', () => {
    it('maps the whole remainder to the first string arg', () => {
        const s = spec({
            query: { type: 'string' },
            limit: { type: 'integer' },
        });
        expect(parseTextArgs(s, 'vegan food preferences')).toEqual({
            query: 'vegan food preferences',
        });
    });

    it('coerces an integer first arg', () => {
        const s = spec({ count: { type: 'integer' } });
        expect(parseTextArgs(s, '10')).toEqual({ count: 10 });
    });

    it('returns {} for empty remainder so defaults apply', () => {
        const s = spec({ count: { type: 'integer' } });
        expect(parseTextArgs(s, '   ')).toEqual({});
    });

    it('returns {} when an integer arg cannot be parsed', () => {
        const s = spec({ count: { type: 'integer' } });
        expect(parseTextArgs(s, 'abc')).toEqual({});
    });

    it('passes a date-format string through as-is', () => {
        const s = spec({ day: { type: 'string', format: 'date' } });
        expect(parseTextArgs(s, '2026-06-23')).toEqual({ day: '2026-06-23' });
    });

    it('returns {} when the schema has no properties', () => {
        expect(parseTextArgs(spec({}), 'whatever')).toEqual({});
    });
});
