import React, { useState } from 'react';
import { Modal, View } from 'react-native';
import { styles } from './styles'

import ChatScreen from '../chat/screen';
import SettingsModal from '../settings/screen';
import { emptyChatID, useMain } from './context';
import { ChatProvider } from '../chat/context.tsx';
import { AskUserProvider } from '../chat/AskUserContext';

import { getClientPlugin } from '../../plugins/clientRegistry';

function MainScreenContent() {
    const { activeChatID, setActiveChatID, activePluginView, setActivePluginView, activePluginIntegrationId, closePluginKeepSidebar, closePluginWithSidebar } = useMain();
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
        <AskUserProvider>
            <View style={styles.root}>
                {PluginComponent ? (
                    <ChatProvider
                        activeChatID={emptyChatID}
                        setActiveChatID={() => {}}
                    >
                        <View style={styles.content}>
                            <PluginComponent
                                integrationId={activePluginIntegrationId ?? undefined}
                                onClose={(closeSidebar?: boolean) => {
                                    if (closeSidebar) {
                                        closePluginWithSidebar();
                                    } else {
                                        closePluginKeepSidebar();
                                    }
                                }}
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
                <Modal
                    visible={settingsOpen}
                    animationType="slide"
                    onRequestClose={() => setSettingsOpen(false)}
                >
                    <SettingsModal />
                </Modal>
            </View>
        </AskUserProvider>
    );
}

export default function MainScreen() {
    return <MainScreenContent />;
}
