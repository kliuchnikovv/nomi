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
};

// Settings nested stack (inside the Settings tab)
export type SettingsStackParamList = {
  SettingsHome: undefined;
  ThemeScreen: undefined;
  LocationScreen: undefined;
  PlannerModelScreen: undefined;
  BotIdentityScreen: undefined;
};

// Main bottom tab navigator
export type RootTabParamList = {
  Dashboard: undefined;
  Planning: undefined;
  Chat: NavigatorScreenParams<ChatStackParamList>; // Chat tab contains ChatStack
  Integrations: undefined;
  Settings: NavigatorScreenParams<SettingsStackParamList>; // Settings tab contains SettingsStack
};
