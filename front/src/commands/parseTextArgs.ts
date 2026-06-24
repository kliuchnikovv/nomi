import type { CommandSpec } from './types';

/**
 * Split "/name rest of the text" into its command name and the remaining text.
 * Returns null when the input is not a slash-command.
 */
export function splitSlashCommand(
    text: string,
): { name: string; rest: string } | null {
    if (!text.startsWith('/')) return null;
    const body = text.slice(1);
    const sp = body.search(/\s/);
    if (sp === -1) return { name: body, rest: '' };
    return { name: body.slice(0, sp), rest: body.slice(sp + 1) };
}

/**
 * Map the free text after a slash-command to its arguments.
 *
 * Commands are entered as plain text (no form UI), so the entire remainder
 * maps to the command's FIRST declared argument, coerced to that arg's
 * JSON-Schema type. Any other arguments fall back to their schema defaults.
 * An empty remainder yields {} (backend applies defaults / required-field
 * validation).
 */
export function parseTextArgs(spec: CommandSpec, rest: string): object {
    const schema = (spec.args_schema ?? {}) as {
        properties?: Record<string, { type?: string }>;
    };
    const props = schema.properties ?? {};
    const keys = Object.keys(props);
    const trimmed = rest.trim();
    if (keys.length === 0 || !trimmed) return {};

    const key = keys[0];
    const type = props[key]?.type;

    if (type === 'integer') {
        const n = parseInt(trimmed, 10);
        return Number.isNaN(n) ? {} : { [key]: n };
    }
    if (type === 'number') {
        const n = parseFloat(trimmed);
        return Number.isNaN(n) ? {} : { [key]: n };
    }
    return { [key]: trimmed };
}
