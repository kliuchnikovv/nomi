import React from 'react';
import { View, Text } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { getFocusedRouteNameFromRoute, type RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';

import { DashboardScreen } from '../screens/dashboard/DashboardScreen';
import { PlannerScreen } from '../screens/planner/PlannerScreen';
import { ChatStack } from './ChatStack';
import { IntegrationsScreen } from '../screens/integrations/IntegrationsScreen';
import { SettingsTabScreen } from '../screens/settingsTab/SettingsTabScreen';
import type { RootTabParamList } from './types';

const Tab = createBottomTabNavigator<RootTabParamList>();

export function MainTabs() {
    const { theme } = useTheme();

    return (
        <Tab.Navigator
            screenOptions={({ route }: { route: RouteProp<RootTabParamList, keyof RootTabParamList> }) => ({
                headerShown: false,
                tabBarStyle: (route) => {
                    const routeName = getFocusedRouteNameFromRoute(route) ?? 'ChatList';
                    return routeName === 'ChatDetail' ? { display: 'none' } : { backgroundColor: theme.surface, borderTopColor: theme.border };
                },
                tabBarActiveTintColor: theme.accent,
                tabBarInactiveTintColor: theme.textSecondary,
                tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
                tabBarIcon: ({ focused, color, size }) => {
                    let iconName: keyof typeof Ionicons.glyphMap;

                    switch (route.name) {
                        case 'Dashboard':
                            iconName = focused ? 'home' : 'home-outline';
                            break;
                        case 'Planning':
                            iconName = focused ? 'calendar' : 'calendar-outline';
                            break;
                        case 'Chat':
                            iconName = focused ? 'chatbubbles' : 'chatbubbles-outline';
                            break;
                        case 'Integrations':
                            iconName = focused ? 'apps' : 'apps-outline';
                            break;
                        case 'Settings':
                            iconName = focused ? 'settings' : 'settings-outline';
                            break;
                        default:
                            iconName = 'ellipse';
                    }

                    return <Ionicons name={iconName} size={size} color={color} />;
                },
            })}
        >
            <Tab.Screen name="Dashboard" component={DashboardScreen} options={{ title: 'Home' }} />
            <Tab.Screen name="Planning" component={PlannerScreen} options={{ title: 'Plan' }} />
            <Tab.Screen name="Chat" component={ChatStack} options={{ title: 'Chats' }} />
            <Tab.Screen name="Integrations" component={IntegrationsScreen} options={{ title: 'Integrations' }} />
            <Tab.Screen name="Settings" component={SettingsTabScreen} options={{ title: 'Settings' }} />
        </Tab.Navigator>
    );
}
