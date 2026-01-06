import React from 'react';
import { View, Text } from 'react-native';

// Verify imports one by one
// 1. Models and Context (verified safe)
import { InboxMessage, Plugin, PluginChat, PluginChatMessage } from './models';
import { PluginChatsContext } from './context';
// 2. Database (verified safe)
import * as DatabaseModule from '../../services/database/database';
// 3. API Client (verified safe?)
import { inboxApi, integrationsApi, sidebarApi } from '../../apiClient';

// 4. IntegrationStorage
import { integrationStorage } from '../../services/integrations/IntegrationStorage';
// 5. GmailClient
import { gmailClient } from '../../services/integrations/clients/GmailClient';

export const PluginChatsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    console.log('PluginChatsProviderImpl (Simple version) rendering');

    console.log('DatabaseModule:', !!DatabaseModule);
    console.log('inboxApi:', !!inboxApi);
    console.log('integrationStorage:', !!integrationStorage);
    console.log('gmailClient:', !!gmailClient);

    const value = React.useMemo(() => ({
        plugins: [],
        loading: false,
        refreshing: false,
        error: null,
        selectedChatId: null,
        selectedChatMessages: [],
        chatLoading: false,
        chatError: null,
        selectChat: async () => null,
        setSelectedChatId: () => { },
        refresh: async () => { },
        loadMoreForPlugin: async () => { },
        hasMoreForPlugin: () => false,
        loadingMorePlugins: new Set<string>(),
    }), []);

    return (
        <PluginChatsContext.Provider value={value}>
            <View style={{ flex: 1 }}>
                {children}
            </View>
        </PluginChatsContext.Provider>
    );
};

// Add legacy export just in case
export const InboxProvider = PluginChatsProvider;
