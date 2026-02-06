/**
 * Plugin UI extension point types.
 *
 * Plugins implement these interfaces to provide UI for:
 * - Right sidebar sections
 * - Full-screen views
 * - Dashboard widgets
 * - Inline chat elements
 */

import React from 'react';
import { ToolCall } from '../screens/chat/message/models';

// ─── Sidebar ───────────────────────────────────────────────

export interface PluginSidebarProps {
    /** Server-assigned integration ID for this plugin instance */
    integrationId: string;
    /** Open the plugin's full-screen view */
    onSelect: () => void;
    /** Whether this plugin's full-screen view is currently active */
    isSelected: boolean;
    /** Close the sidebar panel */
    onClose?: () => void;
}

// ─── Full Screen ───────────────────────────────────────────

export interface PluginMainScreenProps {
    /** Server-assigned integration ID for this plugin instance */
    integrationId?: string;
    /** Navigate back from the full-screen view */
    onClose?: () => void;
}

// ─── Widgets ───────────────────────────────────────────────

export interface PluginWidgetProps {
    /** Integration ID, if the widget is tied to a specific integration instance */
    integrationId?: string;
}

export interface PluginWidgetRegistration {
    /** Unique key, e.g. "gmail:unread-count" */
    id: string;
    /** Display name shown in widget header */
    label: string;
    /** Sort priority — lower values appear first. Default: 100 */
    priority?: number;
    /** The widget component */
    Component: React.ComponentType<PluginWidgetProps>;
}

// ─── Chat Elements ─────────────────────────────────────────

export interface ChatElementProps<TArgs = Record<string, any>> {
    /** Parsed arguments from the tool_call */
    args: TArgs;
    /** The original tool_call object */
    toolCall: ToolCall;
}

export interface ChatElementRegistration {
    /**
     * The tool_call name(s) this component handles.
     * Matched against `tool_call.name` in the message renderer.
     */
    toolNames: string | string[];
    /** The component to render */
    Component: React.ComponentType<ChatElementProps<any>>;
}

// ─── Plugin Handler ────────────────────────────────────────

export interface ClientPluginHandler {
    /** Execute a tool method on behalf of the AI agent */
    execute(method: string, params: Record<string, any>): Promise<string>;

    /** Optional: periodic background sync task */
    backgroundTask?: (integrationId: string) => Promise<void>;

    /** Optional: full-screen component when plugin is selected */
    MainComponent?: React.ComponentType<PluginMainScreenProps>;

    /** Optional: sidebar section component */
    SidebarComponent?: React.ComponentType<PluginSidebarProps>;

    /** Optional: dashboard widget cards */
    widgets?: PluginWidgetRegistration[];

    /** Optional: custom inline chat elements */
    chatElements?: ChatElementRegistration[];
}
