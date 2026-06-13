/**
 * discovery_tool is a single routing tool: the agent calls it with a natural-language
 * `request`, and the backend resolves it to a real integration tool+method+account and
 * returns a JSON envelope ({type, result, tool, method, account, ...}).
 *
 * Rendering that envelope verbatim leaks internals (the "discovery_tool" name, the raw
 * {request} args, account UUIDs). This adapter unwraps a completed discovery_tool call
 * into a synthetic ToolCall that looks like a normal per-integration call
 * ("GitHub · list_repos" + clean result), so the existing tool-call UI can render it.
 *
 * Returns null when the call should be rendered as-is (not discovery_tool, still running,
 * or an unparseable result) — callers fall back to the original tool call.
 */
import { ToolCall } from '../../../types/api';
import { getIntegrationMetadata } from '../../../services/integrations/registry';

export interface ResolvedToolCall extends ToolCall {
    /** MaterialCommunityIcons glyph name for the resolved integration, if known. */
    icon?: string;
}

function parseMaybeJson(value: any): any {
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

/**
 * Registry icon names follow no single icon set, and some are recent MCI glyphs
 * (e.g. `gmail`) that exist in the JS glyph map but are missing from the bundled
 * font `.ttf`, so they render as a tofu "?" box. Map those — and the non-MCI
 * names — to core glyphs that are guaranteed present in the shipped font.
 */
const MCI_ICON_OVERRIDES: Record<string, string> = {
    gmail: 'email',
    mail: 'email',
    google: 'email',
    telegram: 'send',
    user: 'account',
    'check-square': 'checkbox-marked-outline',
    jules: 'robot-outline',
};

function mciIcon(icon?: string): string | undefined {
    if (!icon) return undefined;
    return MCI_ICON_OVERRIDES[icon] ?? icon;
}

/**
 * Build a display label + icon for a resolved discovery envelope.
 * Returns null when no tool was resolved (genuinely unrouted → keep "discovery_tool").
 */
function resolvedLabel(env: any): { name: string; icon?: string } | null {
    if (!env?.tool) return null;
    const meta = getIntegrationMetadata(env.tool);
    const name =
        [meta?.displayName ?? env.tool, env.method]
            .filter(Boolean)
            .join(' · ') || 'discovery_tool';
    return { name, icon: mciIcon(meta?.icon) };
}

export function unwrapDiscoveryToolCall(
    toolCall: ToolCall,
): ResolvedToolCall | null {
    if (!toolCall || toolCall.name !== 'discovery_tool') return null;

    const env = parseMaybeJson(toolCall.result);
    // Still running (no result yet) or unparseable → let caller render as-is.
    if (!env || typeof env !== 'object') return null;

    const reqArgs = parseMaybeJson(toolCall.arguments) ?? toolCall.arguments;
    const requestText =
        reqArgs && typeof reqArgs === 'object' ? reqArgs.request : reqArgs;

    if (env.type === 'question') {
        return {
            name: 'Clarification needed',
            arguments: requestText,
            result: env.question,
            status: toolCall.status,
        };
    }

    if (env.type === 'error') {
        // A tool was resolved/attempted → show its name even on failure.
        // Otherwise (genuinely unrouted) keep the generic "discovery_tool".
        const label = resolvedLabel(env);
        return {
            name: label?.name ?? 'discovery_tool',
            icon: label?.icon,
            arguments: requestText,
            result: env.error,
            status: toolCall.status,
        };
    }

    if (env.type !== 'result') return null;

    const label = resolvedLabel(env);

    // Multi-account aggregated result: key by human-readable account, drop UUIDs.
    let inner = env.result;
    if (env.aggregated && Array.isArray(inner)) {
        const byAccount: Record<string, any> = {};
        for (const item of inner) {
            const key = item?.account_display || item?.account_id || 'account';
            byAccount[key] = item?.error
                ? `Error: ${item.error}`
                : item?.result;
        }
        inner = byAccount;
    }

    return {
        name: label?.name ?? 'discovery_tool',
        icon: label?.icon,
        arguments: requestText,
        result: inner,
        status: toolCall.status,
    };
}
