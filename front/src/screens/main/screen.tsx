import React, { useState } from 'react';
import { View } from 'react-native';
import { styles } from './styles'

import ChatScreen from '../chat/screen';
import SettingsModal from '../settings/screen';
import { emptyChatID, useMain } from './context';
import { ChatProvider } from '../chat/context.tsx';

import { ConnectorsProvider } from '../settings/connectors/context';
import { getClientPlugin } from '../../plugins/clientRegistry';

function MainScreenContent() {
    const { activeChatID, setActiveChatID, activePluginView, setActivePluginView, activePluginIntegrationId } = useMain();
    const [settingsOpen, setSettingsOpen] = useState(false);

    // Check if we need to render a plugin view
    let PluginComponent = null;
    if (activePluginView) {
        const plugin = getClientPlugin(activePluginView);
        if (plugin?.MainComponent) {
            PluginComponent = plugin.MainComponent;
        }
    }

    return (
        <ConnectorsProvider>
            <View style={styles.root}>
                {PluginComponent ? (
                    <ChatProvider
                        activeChatID={emptyChatID}
                        setActiveChatID={() => {}}
                    >
                        <View style={styles.content}>
                            <PluginComponent
                                integrationId={activePluginIntegrationId ?? undefined}
                                onClose={() => setActivePluginView(null)}
                            />
                        </View>
                    </ChatProvider>
                ) : (
                    <ChatProvider
                        activeChatID={activeChatID ? activeChatID : emptyChatID}
                        setActiveChatID={setActiveChatID}
                    >
                        <View style={styles.content}>
                            <ChatScreen onSettingsPress={() => setSettingsOpen(true)} />
                        </View>
                    </ChatProvider>
                )}
                <SettingsModal
                    visible={settingsOpen}
                    onClose={() => setSettingsOpen(false)}
                />
            </View>
        </ConnectorsProvider>
    );
}

export default function MainScreen() {
    return <MainScreenContent />;
}
