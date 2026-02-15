import { ThemePalette } from '../../../themes/types';
import { Chat } from '../../main/models.tsx';
import { getAllIntegrations } from '../../../services/integrations/registry';

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
    colorKey: keyof ThemePalette;
    glyph: string;
};

export type StorageType = 'client' | 'server' | 'hybrid';

export type Integration = {
    id: string;
    name: string;
    provider: string;
    connected: boolean;
    storageType?: StorageType; // Тип хранения данных
    supportsBackgroundTasks?: boolean; // Поддерживает ли фоновые процессы
    systemEventListeners?: string[]; // Список системных событий
    info?: Record<string, any>;
    state?: Record<string, any>;
    params?: Record<string, any>;
};

export type Tool = {
    id: string;
    name: string;
    provider: string;
    enabled: boolean;
    created_at?: string;
    info?: Record<string, any>;
    state?: Record<string, any>;
    params?: Record<string, any>;
};

export type OAuthStatus = {
    provider: string;
    authorized: boolean;
    account_email?: string;
    scopes?: string[];
};

const CONNECTOR_COLOR_MAP: Partial<Record<string, keyof ThemePalette>> = {
    gmail: 'red',
    calendar: 'orange',
    github: 'magenta',
    telegram: 'blue',
    jules: 'purple',
    ios_calendar: 'red',
    ios_reminders: 'orange',
    ios_contacts: 'blue',
    ios_health: 'red',
};

function buildConnectors(): Connector[] {
    const integrations = getAllIntegrations();
    return integrations.map((m) => ({
        id: m.id,
        name: m.displayName,
        toolKey: m.id,
        oauthProvider: m.id,
        colorKey: (CONNECTOR_COLOR_MAP[m.id] ?? 'blue') as keyof ThemePalette,
        glyph: m.icon,
    }));
}

export const CONNECTORS: Connector[] = buildConnectors();

export interface ConnectorContextType {
    tools: Tool[];
    integrations: Integration[];
    getTools: () => Promise<void>;
    getIntegrations: () => Promise<void>;
    toggleTool: (configID: string, enabled: boolean) => Promise<void>;
    startOAuth: (provider: string) => Promise<void>;
    deleteIntegration: (id: string) => Promise<void>;
    connectTelegram: (code: string) => Promise<void>;
}
