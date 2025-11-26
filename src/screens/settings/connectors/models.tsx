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
};

export type Tool = {
    id: string;
    name: string;
    provider: string;
    enabled: boolean;
    created_at: string;
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
        id: 'github',
        name: 'GitHub',
        toolKey: 'github',
        oauthProvider: 'github',
        color: '#24292e',
        glyph: 'github',
    },
    {
        id: 'slack',
        name: 'Slack',
        toolKey: 'slack',
        oauthProvider: 'slack',
        color: '#611f69',
        glyph: 'slack',
    },
    {
        id: 'gmail',
        name: 'Gmail',
        toolKey: 'gmail',
        oauthProvider: 'google',
        color: oneDarkPalette.red,
        glyph: 'gmail',
    },
    {
        id: 'google_calendar',
        name: 'Google Calendar',
        toolKey: 'google_calendar',
        oauthProvider: 'google',
        color: oneDarkPalette.blue,
        glyph: 'calendar-month',
    },
    {
        id: 'google_contacts',
        name: 'Google Contacts',
        toolKey: 'google_contacts',
        oauthProvider: 'google',
        color: '#1a73e8',
        glyph: 'account',
    },
    {
        id: 'google_drive',
        name: 'Google Drive',
        toolKey: 'google_drive',
        oauthProvider: 'google',
        color: '#188038',
        glyph: 'google-drive',
    },
];

export interface ConnectorContextType {
    tools: Tool[];
    integrations: Integration[];
    getTools: () => void;
    getIntegrations: () => void;
    toggleTool: (configID: string, enabled: boolean) => Promise<void>;
}