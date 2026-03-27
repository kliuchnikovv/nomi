import React, { useEffect } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useRoute, RouteProp } from '@react-navigation/native';
import { ChatListScreen } from '../screens/chat/chatList/ChatListScreen';
import { ChatDetailScreen } from '../screens/chat/chatDetail/ChatDetailScreen';
import { useMain, emptyChatID } from '../screens/main/context';
import { ChatProvider } from '../screens/chat/context';
import { AskUserProvider } from '../screens/chat/AskUserContext';
import type { ChatStackParamList } from './types';

const Stack = createNativeStackNavigator<ChatStackParamList>();

function ChatDetailScreenWrapper() {
    const route = useRoute<RouteProp<ChatStackParamList, 'ChatDetail'>>();
    const { chatId } = route.params;
    const { setActiveChatID } = useMain();

    useEffect(() => {
        setActiveChatID(chatId);
    }, [chatId, setActiveChatID]);

    return <ChatDetailScreen />;
}

export function ChatStack() {
    const { activeChatID, setActiveChatID } = useMain();

    return (
        <ChatProvider
            activeChatID={activeChatID ? activeChatID : emptyChatID}
            setActiveChatID={setActiveChatID}
        >
            <AskUserProvider>
                <Stack.Navigator
                    screenOptions={{
                        headerShown: false,
                    }}
                >
                    <Stack.Screen
                        name="ChatList"
                        component={ChatListScreen}
                        options={{ title: 'Chats' }}
                    />
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
