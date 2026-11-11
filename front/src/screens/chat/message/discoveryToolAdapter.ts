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

/**
 * Rich-card variant to render this tool call as, instead of the generic
 * collapsible JSON chip. `undefined` (or 'generic') falls back to `SingleToolCall`.
 */
export type ToolCardKind = 'calendar' | 'email' | 'task' | 'generic';

export interface ResolvedToolCall extends ToolCall {
    /** MaterialCommunityIcons glyph name for the resolved integration, if known. */
    icon?: string;
    /** Rich-card variant this tool should render as, if any. */
    card?: ToolCardKind;
}

/**
 * Built-in tools that Agno registers automatically (not routed through
 * discovery_tool). They arrive as plain tool calls with raw snake_case names and
 * no icon — map them to a friendly label + icon so the Details rows read like the
 * resolved integration calls (e.g. "Clarification needed").
 */
interface ToolDisplay {
    name: string;
    icon: string;
    card?: ToolCardKind;
}

const KNOWN_TOOL_DISPLAY: Record<string, ToolDisplay> = {
    // Discovery router itself (shown while routing, or when a request is unrouted)
    discovery_tool: { name: 'Routing request', icon: 'compass-outline' },

    // Knowledge / memory
    search_knowledge_base: {
        name: 'Searching memory',
        icon: 'book-search-outline',
    },
    search_entities: {
        name: 'Searching entities',
        icon: 'account-search-outline',
    },
    remember_this: { name: 'Saving to memory', icon: 'content-save-outline' },

    // Web search
    duckduckgo_search: { name: 'Searching the web', icon: 'web' },
    duckduckgo_news: {
        name: 'Searching news',
        icon: 'newspaper-variant-outline',
    },

    // Email (unified) → email card
    list_email_accounts: {
        name: 'Email accounts',
        icon: 'email-multiple-outline',
        card: 'email',
    },
    search_emails: {
        name: 'Searching email',
        icon: 'email-search-outline',
        card: 'email',
    },
    get_recent_emails: {
        name: 'Reading recent email',
        icon: 'email-outline',
        card: 'email',
    },
    get_email: {
        name: 'Reading email',
        icon: 'email-open-outline',
        card: 'email',
    },
    send_email: { name: 'Sending email', icon: 'send', card: 'email' },
    reply_email: {
        name: 'Replying to email',
        icon: 'reply-outline',
        card: 'email',
    },
    create_draft: {
        name: 'Drafting email',
        icon: 'email-edit-outline',
        card: 'email',
    },
    mark_email: {
        name: 'Marking email',
        icon: 'email-check-outline',
        card: 'email',
    },
    move_email: {
        name: 'Moving email',
        icon: 'folder-move-outline',
        card: 'email',
    },
    archive_email: {
        name: 'Archiving email',
        icon: 'archive-outline',
        card: 'email',
    },
    delete_email: {
        name: 'Deleting email',
        icon: 'email-remove-outline',
        card: 'email',
    },
    list_mailboxes: {
        name: 'Listing mailboxes',
        icon: 'inbox-multiple-outline',
        card: 'email',
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

    // Calendar (Google + iOS) → calendar card
    create_event: {
        name: 'Creating event',
        icon: 'calendar-plus',
        card: 'calendar',
    },
    get_events: {
        name: 'Reading events',
        icon: 'calendar-outline',
        card: 'calendar',
    },
    get_upcoming_events: {
        name: 'Upcoming events',
        icon: 'calendar-clock-outline',
        card: 'calendar',
    },
    update_event: {
        name: 'Updating event',
        icon: 'calendar-edit',
        card: 'calendar',
    },
    delete_event: {
        name: 'Deleting event',
        icon: 'calendar-remove-outline',
        card: 'calendar',
    },
    list_calendars: {
        name: 'Listing calendars',
        icon: 'calendar-multiple',
        card: 'calendar',
    },
    get_calendars: {
        name: 'Reading calendars',
        icon: 'calendar-multiple',
        card: 'calendar',
    },

    // Reminders (self-reminders / watch) + notifications → task card
    create_reminder: {
        name: 'Setting a reminder',
        icon: 'bell-plus-outline',
        card: 'task',
    },
    list_reminders: {
        name: 'Checking reminders',
        icon: 'bell-outline',
        card: 'task',
    },
    cancel_reminder: {
        name: 'Canceling reminder',
        icon: 'bell-off-outline',
        card: 'task',
    },
    get_reminders: {
        name: 'Reading reminders',
        icon: 'bell-outline',
        card: 'task',
    },
    update_reminder: {
        name: 'Updating reminder',
        icon: 'bell-cog-outline',
        card: 'task',
    },
    complete_reminder: {
        name: 'Completing reminder',
        icon: 'bell-check-outline',
        card: 'task',
    },
    delete_reminder: {
        name: 'Deleting reminder',
        icon: 'bell-remove-outline',
        card: 'task',
    },
    get_lists: {
        name: 'Reading lists',
        icon: 'format-list-bulleted',
        card: 'task',
    },
    add_to_list: {
        name: 'Adding to list',
        icon: 'playlist-plus',
        card: 'task',
    },
    remove_from_list: {
        name: 'Removing from list',
        icon: 'playlist-minus',
        card: 'task',
    },
    schedule_notification: {
        name: 'Scheduling notification',
        icon: 'bell-ring-outline',
    },

    // Chat history
    search_chat_history: { name: 'Searching chat history', icon: 'history' },

    // Delegation
    delegate_to: { name: 'Delegating', icon: 'account-arrow-right-outline' },

    // Sandbox (isolated code-execution environment)
    exec_command: { name: 'Running command', icon: 'console-line' },
    upload_file: { name: 'Uploading file', icon: 'file-upload-outline' },
    download_file: { name: 'Downloading file', icon: 'file-download-outline' },
    list_files: { name: 'Listing files', icon: 'file-multiple-outline' },
    clone_repo: { name: 'Cloning repository', icon: 'source-branch' },
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
    return {
        ...toolCall,
        name: display.name,
        icon: display.icon,
        card: display.card,
    };
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
function resolvedLabel(
    env: any,
): { name: string; icon?: string; card?: ToolCardKind } | null {
    if (!env?.tool) return null;
    const meta = getIntegrationMetadata(env.tool);
    // Method-level card mapping wins when we know the tool — same map as the
    // direct decorateKnownToolCall path.
    const byMethod = env.method ? KNOWN_TOOL_DISPLAY[env.method] : undefined;
    // In-process "local" toolkits (maps, watch, notification, planning, …) routed
    // through discovery_tool aren't in the integration registry. Fall back to the
    // per-method display map so they render with a friendly label + icon instead
    // of a raw `watch · create_reminder`.
    if (!meta && byMethod) {
        return {
            name: byMethod.name,
            icon: mciIcon(byMethod.icon),
            card: byMethod.card,
        };
    }
    const name =
        [meta?.displayName ?? env.tool, env.method]
            .filter(Boolean)
            .join(' · ') || 'discovery_tool';
    return { name, icon: mciIcon(meta?.icon), card: byMethod?.card };
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
            name: label?.name ?? KNOWN_TOOL_DISPLAY.discovery_tool.name,
            icon: label?.icon ?? KNOWN_TOOL_DISPLAY.discovery_tool.icon,
            card: label?.card,
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
        name: label?.name ?? KNOWN_TOOL_DISPLAY.discovery_tool.name,
        icon: label?.icon ?? KNOWN_TOOL_DISPLAY.discovery_tool.icon,
        card: label?.card,
        arguments: requestText,
        result: inner,
        status: toolCall.status,
    };
}
