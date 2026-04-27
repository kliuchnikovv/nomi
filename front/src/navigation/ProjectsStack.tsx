import React, { useState } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useRoute, RouteProp } from '@react-navigation/native';
import type { ProjectsStackParamList } from './types';
import { ProjectsScreen } from '../screens/projects/ProjectsScreen';
import { ProjectDetailScreen } from '../screens/projects/ProjectDetailScreen';
import { CreateEditProjectScreen } from '../screens/projects/CreateEditProjectScreen';
import { ChatDetailScreen } from '../screens/chat/chatDetail/ChatDetailScreen';
import { ChatProvider } from '../screens/chat/context';
import { AskUserProvider } from '../screens/chat/AskUserContext';
import { emptyChatID } from '../screens/main/context';

const Stack = createNativeStackNavigator<ProjectsStackParamList>();

function ProjectChatDetailWrapper() {
    const route = useRoute<RouteProp<ProjectsStackParamList, 'ProjectChatDetail'>>();
    const { chatId, projectId, pendingText } = route.params;

    // Local state — intentionally isolated from the global Chat tab.
    // Using emptyChatID sentinel so ChatProvider creates a new chat on first send.
    const [localChatId, setLocalChatId] = useState<string>(chatId || emptyChatID);

    return (
        <ChatProvider
            activeChatID={localChatId}
            setActiveChatID={setLocalChatId}
            initialProjectId={projectId}
            initialPendingText={pendingText}
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
