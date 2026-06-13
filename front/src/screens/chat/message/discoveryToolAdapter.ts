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

/**
 * Built-in tools that Agno registers automatically (not routed through
 * discovery_tool). They arrive as plain tool calls with raw snake_case names and
 * no icon — map them to a friendly label + icon so the Details rows read like the
 * resolved integration calls (e.g. "Clarification needed").
 */
const KNOWN_TOOL_DISPLAY: Record<string, { name: string; icon: string }> = {
    // Knowledge / memory
    search_knowledge_base: {
        name: 'Searching memory',
        icon: 'book-search-outline',
    },
    remember_this: { name: 'Saving to memory', icon: 'content-save-outline' },

    // Web search
    duckduckgo_search: { name: 'Searching the web', icon: 'web' },
    duckduckgo_news: {
        name: 'Searching news',
        icon: 'newspaper-variant-outline',
    },

    // Email (unified)
    list_email_accounts: {
        name: 'Email accounts',
        icon: 'email-multiple-outline',
    },
    search_emails: { name: 'Searching email', icon: 'email-search-outline' },
    get_recent_emails: { name: 'Reading recent email', icon: 'email-outline' },
    get_email: { name: 'Reading email', icon: 'email-open-outline' },
    send_email: { name: 'Sending email', icon: 'send' },
    reply_email: { name: 'Replying to email', icon: 'reply-outline' },
    create_draft: { name: 'Drafting email', icon: 'email-edit-outline' },
    mark_email: { name: 'Marking email', icon: 'email-check-outline' },
    move_email: { name: 'Moving email', icon: 'folder-move-outline' },
    archive_email: { name: 'Archiving email', icon: 'archive-outline' },
    delete_email: { name: 'Deleting email', icon: 'email-remove-outline' },
    list_mailboxes: {
        name: 'Listing mailboxes',
        icon: 'inbox-multiple-outline',
    },

    // User interaction (same intent as the discovery clarification flow)
    ask_user: { name: 'Clarification needed', icon: 'chat-question-outline' },

    // Planning / projects
    patch_plan_document: {
        name: 'Updating plan',
        icon: 'clipboard-edit-outline',
    },
    list_projects: {
        name: 'Listing projects',
        icon: 'folder-multiple-outline',
    },

    // Maps
    open_route: { name: 'Building route', icon: 'map-marker-path' },
    search_places: { name: 'Searching places', icon: 'map-search-outline' },

    // Reminders (self-reminders / watch) + notifications
    create_reminder: { name: 'Setting a reminder', icon: 'bell-plus-outline' },
    list_reminders: { name: 'Checking reminders', icon: 'bell-outline' },
    cancel_reminder: { name: 'Canceling reminder', icon: 'bell-off-outline' },
    schedule_notification: {
        name: 'Scheduling notification',
        icon: 'bell-ring-outline',
    },

    // Chat history
    search_chat_history: { name: 'Searching chat history', icon: 'history' },

    // Delegation
    delegate_to: { name: 'Delegating', icon: 'account-arrow-right-outline' },
};

/**
 * Decorate a known built-in tool call with a friendly label + icon.
 * Returns null for unknown tools so callers fall back to the original.
 */
export function decorateKnownToolCall(
    toolCall: ToolCall,
): ResolvedToolCall | null {
    const display = toolCall && KNOWN_TOOL_DISPLAY[toolCall.name];
    if (!display) return null;
    return { ...toolCall, name: display.name, icon: display.icon };
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
    // In-process "local" toolkits (maps, watch, notification, planning, …) routed
    // through discovery_tool aren't in the integration registry. Fall back to the
    // per-method display map so they render with a friendly label + icon instead
    // of a raw `watch · create_reminder`.
    if (!meta) {
        const byMethod = env.method && KNOWN_TOOL_DISPLAY[env.method];
        if (byMethod) {
            return { name: byMethod.name, icon: mciIcon(byMethod.icon) };
        }
    }
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
            icon: 'chat-question-outline',
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
