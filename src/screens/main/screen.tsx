import React, { useState } from 'react';
import { View } from 'react-native';
import { styles } from './styles'

import ChatScreen from '../chat/screen';
import SettingsModal from '../settings/screen';
import { emptyChatID, useMain } from './context';
import { ChatProvider } from '../chat/context.tsx';

function MainScreenContent() {
    const { activeChatID, setActiveChatID } = useMain();
    const [settingsOpen, setSettingsOpen] = useState(false);

    return (
        <View style={styles.root}>
            <ChatProvider
                activeChatID={activeChatID ? activeChatID : emptyChatID}
                setActiveChatID={setActiveChatID}
            >
                <View style={styles.content}>
                    <ChatScreen onSettingsPress={() => setSettingsOpen(true)} />
                </View>
            </ChatProvider>
            <SettingsModal
                visible={settingsOpen}
                onClose={() => setSettingsOpen(false)}
            />
        </View>
    );
}

export default function MainScreen() {
    return <MainScreenContent />;
}
