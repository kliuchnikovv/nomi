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
};

// Settings nested stack (inside the Settings tab)
export type SettingsStackParamList = {
  SettingsHome: undefined;
  ThemeScreen: undefined;
  LocationScreen: undefined;
  PlannerModelScreen: undefined;
  BotIdentityScreen: undefined;
  IntegrationsScreen: undefined;
  MemoryScreen: undefined;
};

// Projects nested stack (inside the Projects tab)
export type ProjectsStackParamList = {
  ProjectsList: undefined;
  ProjectDetail: { projectId: string };
  CreateEditProject: { projectId?: string };
  ProjectChatDetail: { chatId: string; projectId?: string; pendingText?: string };
};

// Main bottom tab navigator
export type RootTabParamList = {
  Dashboard: undefined;
  Planning: undefined;
  Chat: NavigatorScreenParams<ChatStackParamList>; // Chat tab contains ChatStack
  Projects: NavigatorScreenParams<ProjectsStackParamList>;
  Settings: NavigatorScreenParams<SettingsStackParamList>; // Settings tab contains SettingsStack
};
