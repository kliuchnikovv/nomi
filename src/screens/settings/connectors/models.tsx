import React from 'react';
import { oneDarkPalette } from '../../../themes/oneDark.ts';
import { Chat } from '../../main/models.tsx';

function deepEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i += 1) {
            if (!deepEqual(a[i], b[i])) {
                return false;
            }
        }
        return true;
    }
    if (
        typeof a === 'object' &&
        typeof b === 'object' &&
        !Array.isArray(a) &&
        !Array.isArray(b)
    ) {
        const aKeys = Object.keys(a);
        const bKeys = Object.keys(b);
        if (aKeys.length !== bKeys.length) return false;
        for (const key of aKeys) {
            if (!deepEqual(a[key], (b as Record<string, any>)[key])) {
                return false;
            }
        }
        return true;
    }
    return false;
}

function updateMapState<T>(
    ref: React.MutableRefObject<Record<string, T>>,
    setState: React.Dispatch<React.SetStateAction<Record<string, T>>>,
    next: Record<string, T>,
) {
    if (!deepEqual(ref.current, next)) {
        ref.current = next;
        setState(next);
    }
    return ref.current;
}

export type Props = {
    visible: boolean;
    onClose: () => void;
};

export type Connector = {
    id: string;
    name: string;
    toolKey: string;
    oauthProvider: string;
    color: string;
    glyph: string;
};

export type Integration = {
    id: string;
    name: string;
    provider: string;
    connected: boolean;
    info?: Record<string, any>;
    state?: Record<string, any>;
};

export type Tool = {
    id: string;
    name: string;
    provider: string;
    enabled: boolean;
    created_at?: string;
    info?: Record<string, any>;
    state?: Record<string, any>;
};

export type OAuthStatus = {
    provider: string;
    authorized: boolean;
    account_email?: string;
    scopes?: string[];
};

// TODO: replace with tool-configs
export const CONNECTORS: Connector[] = [
    {
        id: 'gmail',
        name: 'Gmail',
        toolKey: 'gmail',
        oauthProvider: 'gmail',
        color: oneDarkPalette.red,
        glyph: 'gmail',
    },
    {
        id: 'calendar',
        name: 'Google Calendar',
        toolKey: 'calendar',
        oauthProvider: 'calendar',
        color: oneDarkPalette.blue,
        glyph: 'calendar-month',
    },
];

export interface ConnectorContextType {
    tools: Tool[];
    integrations: Integration[];
    getTools: () => Promise<void>;
    getIntegrations: () => Promise<void>;
    toggleTool: (configID: string, enabled: boolean) => Promise<void>;
}
