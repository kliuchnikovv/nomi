import React, { useEffect } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useRoute, RouteProp } from '@react-navigation/native';
import { ChatDetailScreen } from '../screens/chat/chatDetail/ChatDetailScreen';
import { VoiceScreen } from '../screens/chat/voice/VoiceScreen';
import { CommandScreen } from '../screens/chat/CommandScreen';
import { useMain, emptyChatID } from '../screens/main/context';
import { ChatProvider } from '../screens/chat/context';
import { AskUserProvider } from '../screens/chat/AskUserContext';
import type { ChatStackParamList } from './types';

const Stack = createNativeStackNavigator<ChatStackParamList>();

function ChatDetailScreenWrapper() {
    const route = useRoute<RouteProp<ChatStackParamList, 'ChatDetail'>>();
    const { activeChatID, setActiveChatID } = useMain();
    const chatId = route.params?.chatId ?? activeChatID;

    useEffect(() => {
        if (chatId) setActiveChatID(chatId);
    }, [chatId, setActiveChatID]);

    return <ChatDetailScreen />;
}

export function ChatStack() {
    const { activeChatID, setActiveChatID, isNewSession, setIsNewSession } =
        useMain();

    return (
        <ChatProvider
            activeChatID={activeChatID ? activeChatID : emptyChatID}
            setActiveChatID={setActiveChatID}
            isNewSession={isNewSession}
            onSessionStarted={() => setIsNewSession(false)}
        >
            <AskUserProvider>
                <Stack.Navigator
                    screenOptions={{ headerShown: false }}
                    initialRouteName="ChatDetail"
                >
                    <Stack.Screen
                        name="ChatDetail"
                        component={ChatDetailScreenWrapper}
                        options={{ title: 'Chat' }}
                    />
                    <Stack.Screen
                        name="VoiceScreen"
                        component={VoiceScreen}
                        options={{
                            title: 'Voice',
                            animation: 'slide_from_bottom',
                        }}
                    />
                    <Stack.Screen
                        name="CommandScreen"
                        component={CommandScreen}
                        options={{ title: 'Command', presentation: 'modal' }}
                    />
                </Stack.Navigator>
            </AskUserProvider>
        </ChatProvider>
    );
}
