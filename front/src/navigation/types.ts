// src/navigation/types.ts

import type { NavigatorScreenParams } from '@react-navigation/native';

// Auth stack
export type AuthStackParamList = {
    Auth: undefined;
};

// Chat nested stack (inside the Chat tab)
export type ChatStackParamList = {
    ChatList: undefined;
    ChatDetail: { chatId?: string };
    VoiceScreen: { chatId: string };
    CommandScreen: { spec: import('../commands/types').CommandSpec };
};

// Settings nested stack (inside the Settings tab)
export type SettingsStackParamList = {
    SettingsHome: undefined;
    ThemeScreen: undefined;
    LocationScreen: undefined;
    BotIdentityScreen: undefined;
    IntegrationsScreen: undefined;
    MemoryScreen: undefined;
    BYOKScreen: undefined;
};

// Dashboard nested stack (inside the Dashboard tab)
export type DashboardStackParamList = {
    DashboardHome: undefined;
    Tasks: undefined;
    TaskDetail: { taskId: string };
};

// Projects nested stack (inside the Projects tab)
export type ProjectsStackParamList = {
    ProjectsList: undefined;
    ProjectDetail: { projectId: string };
    CreateEditProject: { projectId?: string };
    ProjectChatDetail: {
        chatId: string;
        projectId?: string;
        pendingText?: string;
    };
};

// Main bottom tab navigator
export type RootTabParamList = {
    Dashboard: NavigatorScreenParams<DashboardStackParamList>; // Dashboard tab contains DashboardStack
    Planning: undefined;
    Chat: NavigatorScreenParams<ChatStackParamList>; // Chat tab contains ChatStack
    Projects: NavigatorScreenParams<ProjectsStackParamList>;
    Settings: NavigatorScreenParams<SettingsStackParamList>; // Settings tab contains SettingsStack
};
