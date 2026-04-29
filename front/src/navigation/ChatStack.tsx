import React, { useEffect } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useRoute, RouteProp } from '@react-navigation/native';
import { ChatListScreen } from '../screens/chat/chatList/ChatListScreen';
import { ChatDetailScreen } from '../screens/chat/chatDetail/ChatDetailScreen';
import { useMain, emptyChatID } from '../screens/main/context';
import { useAuth } from '../screens/auth/context';
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
    const { activeChatID, setActiveChatID, isNewSession, setIsNewSession } = useMain();
    const { user } = useAuth();
    const singleChatMode = !!user?.single_chat_mode;

    return (
        <ChatProvider
            activeChatID={activeChatID ? activeChatID : emptyChatID}
            setActiveChatID={setActiveChatID}
            isNewSession={isNewSession}
            onSessionStarted={() => setIsNewSession(false)}
        >
            <AskUserProvider>
                <Stack.Navigator
                    screenOptions={{
                        headerShown: false,
                    }}
                    initialRouteName={singleChatMode ? 'ChatDetail' : 'ChatList'}
                >
                    {!singleChatMode && (
                        <Stack.Screen
                            name="ChatList"
                            component={ChatListScreen}
                            options={{ title: 'Chats' }}
                        />
                    )}
                    <Stack.Screen
                        name="ChatDetail"
                        component={ChatDetailScreenWrapper}
                        options={({ route }) => ({ title: 'Chat' })}
                    />
                </Stack.Navigator>
            </AskUserProvider>
        </ChatProvider>
    );
}
