import React from 'react';
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

function getTabBarStyle(route: RouteProp<RootTabParamList, 'Chat'>, surface: string, border: string) {
    const routeName = getFocusedRouteNameFromRoute(route) ?? 'ChatList';
    if (routeName === 'ChatDetail') {
        return { display: 'none' as const };
    }
    return { backgroundColor: surface, borderTopColor: border };
}

export function MainTabs() {
    const { theme } = useTheme();

    return (
        <Tab.Navigator
            screenOptions={({ route }: { route: RouteProp<RootTabParamList, keyof RootTabParamList> }) => ({
                headerShown: false,
                tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.border },
                tabBarActiveTintColor: theme.accent,
                tabBarInactiveTintColor: theme.textSecondary,
                tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
                tabBarIcon: ({ focused, color, size }: { focused: boolean; color: string; size: number }) => {
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
            <Tab.Screen
                name="Chat"
                component={ChatStack}
                options={({ route }: { route: RouteProp<RootTabParamList, 'Chat'> }) => ({
                    title: 'Chats',
                    tabBarStyle: getTabBarStyle(route, theme.surface, theme.border),
                })}
            />
            <Tab.Screen name="Integrations" component={IntegrationsScreen} options={{ title: 'Integrations' }} />
            <Tab.Screen name="Settings" component={SettingsTabScreen} options={{ title: 'Settings' }} />
        </Tab.Navigator>
    );
}
