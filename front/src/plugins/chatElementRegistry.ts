/**
 * Registry of custom chat element components.
 *
 * Plugins register components that render inline in chat messages
 * when matched by tool_call.name (e.g. "ui_client_show_poll").
 */

import React from 'react';
import { ChatElementProps, ChatElementRegistration } from './types';

const registry = new Map<string, React.ComponentType<ChatElementProps<any>>>();

export function registerChatElement(reg: ChatElementRegistration): void {
    const names = Array.isArray(reg.toolNames) ? reg.toolNames : [reg.toolNames];
    for (const name of names) {
        registry.set(name.toLowerCase(), reg.Component);
    }
}

export function getChatElementComponent(
    toolName: string,
): React.ComponentType<ChatElementProps<any>> | undefined {
    return registry.get(toolName.toLowerCase());
}
