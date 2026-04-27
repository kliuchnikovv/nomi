import React, { useEffect } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useRoute, RouteProp } from '@react-navigation/native';
import type { ProjectsStackParamList } from './types';
import { ProjectsScreen } from '../screens/projects/ProjectsScreen';
import { ProjectDetailScreen } from '../screens/projects/ProjectDetailScreen';
import { CreateEditProjectScreen } from '../screens/projects/CreateEditProjectScreen';
import { ChatDetailScreen } from '../screens/chat/chatDetail/ChatDetailScreen';
import { ChatProvider } from '../screens/chat/context';
import { AskUserProvider } from '../screens/chat/AskUserContext';
import { useMain, emptyChatID } from '../screens/main/context';

const Stack = createNativeStackNavigator<ProjectsStackParamList>();

function ProjectChatDetailWrapper() {
    const route = useRoute<RouteProp<ProjectsStackParamList, 'ProjectChatDetail'>>();
    const { setActiveChatID } = useMain();
    const { chatId, projectId } = route.params;

    // Use emptyChatID sentinel when opening a new chat from a project
    const resolvedChatId = chatId || emptyChatID;

    useEffect(() => {
        setActiveChatID(resolvedChatId);
    }, [resolvedChatId, setActiveChatID]);

    return (
        <ChatProvider
            activeChatID={resolvedChatId}
            setActiveChatID={setActiveChatID}
            initialProjectId={projectId}
        >
            <AskUserProvider>
                <ChatDetailScreen />
            </AskUserProvider>
        </ChatProvider>
    );
}

export function ProjectsStack() {
    return (
        <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="ProjectsList" component={ProjectsScreen} />
            <Stack.Screen name="ProjectDetail" component={ProjectDetailScreen} />
            <Stack.Screen name="CreateEditProject" component={CreateEditProjectScreen} />
            <Stack.Screen name="ProjectChatDetail" component={ProjectChatDetailWrapper} />
        </Stack.Navigator>
    );
}
