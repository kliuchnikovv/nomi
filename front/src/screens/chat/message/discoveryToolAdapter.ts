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
        return {
            name: 'discovery_tool',
            arguments: requestText,
            result: env.error,
            status: toolCall.status,
        };
    }

    if (env.type !== 'result') return null;

    const meta = env.tool ? getIntegrationMetadata(env.tool) : undefined;
    const label =
        [meta?.displayName ?? env.tool, env.method].filter(Boolean).join(' · ') ||
        'discovery_tool';

    // Multi-account aggregated result: key by human-readable account, drop UUIDs.
    let inner = env.result;
    if (env.aggregated && Array.isArray(inner)) {
        const byAccount: Record<string, any> = {};
        for (const item of inner) {
            const key = item?.account_display || item?.account_id || 'account';
            byAccount[key] = item?.error ? `Error: ${item.error}` : item?.result;
        }
        inner = byAccount;
    }

    return {
        name: label,
        icon: meta?.icon,
        arguments: requestText,
        result: inner,
        status: toolCall.status,
    };
}
