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

export const SimpleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    console.log('SimpleProvider rendering with ALL imports');

    console.log('DatabaseModule:', !!DatabaseModule);
    console.log('inboxApi:', !!inboxApi);
    console.log('integrationStorage:', !!integrationStorage);
    console.log('gmailClient:', !!gmailClient);

    return (
        <View style={{ flex: 1 }}>
            {children}
        </View>
    );
};
