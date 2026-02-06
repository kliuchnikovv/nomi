/**
 * Generated from plugins manifest.yaml files.
 * Regenerate with: node scripts/generate-registry.js (from repo root)
 */

export type StorageType = 'client' | 'server' | 'hybrid';

export interface IntegrationMetadata {
    id: string;
    name: string;
    displayName: string;
    description: string;
    icon: string;
    storageType: StorageType;
    supportsBackgroundTasks: boolean;
    systemEventListeners: string[];
    authType: 'oauth2' | 'api_key' | 'none';
    category?: string;
    color?: string;
}

export const INTEGRATION_REGISTRY: Record<string, IntegrationMetadata> = {
    gmail: {
        id: 'gmail',
        name: 'gmail',
        displayName: 'Gmail',
        description: 'Gmail integration for email management',
        icon: 'gmail',
        storageType: 'hybrid',
        supportsBackgroundTasks: true,
        systemEventListeners: ['push_notifications', 'app_lifecycle'],
        authType: 'oauth2',
        category: 'email',
        color: '#EA4335',
    },
    calendar: {
        id: 'calendar',
        name: 'calendar',
        displayName: 'Google Calendar',
        description: 'Google Calendar integration for calendar management',
        icon: 'calendar',
        storageType: 'hybrid',
        supportsBackgroundTasks: true,
        systemEventListeners: ['push_notifications', 'app_lifecycle'],
        authType: 'oauth2',
        category: 'calendar',
        color: '#4285F4',
    },
    github: {
        id: 'github',
        name: 'github',
        displayName: 'GitHub',
        description: 'GitHub integration for repository management',
        icon: 'github',
        storageType: 'hybrid',
        supportsBackgroundTasks: false,
        systemEventListeners: [],
        authType: 'oauth2',
        category: 'development',
        color: '#24292e',
    },
    telegram: {
        id: 'telegram',
        name: 'telegram',
        displayName: 'Telegram Bot',
        description: 'Telegram bot integration for messaging',
        icon: 'telegram',
        storageType: 'hybrid',
        supportsBackgroundTasks: false,
        systemEventListeners: [],
        authType: 'api_key',
        category: 'messaging',
        color: '#0088cc',
    },
    jules: {
        id: 'jules',
        name: 'jules',
        displayName: 'Jules',
        description: 'Jules API integration - executes on server',
        icon: 'jules',
        storageType: 'server',
        supportsBackgroundTasks: false,
        systemEventListeners: [],
        authType: 'api_key',
        category: 'development',
        color: '#9334EA',
    },
};
