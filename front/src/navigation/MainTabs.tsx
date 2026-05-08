import React, { useEffect } from 'react';
import { LayoutChangeEvent, View, Text } from 'react-native';
import {
    createBottomTabNavigator,
    BottomTabBar,
    BottomTabBarProps,
} from '@react-navigation/bottom-tabs';
import {
    getFocusedRouteNameFromRoute,
    type RouteProp,
} from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../screens/auth/context';
import { useMain } from '../screens/main/context';

// Height of the tab bar icon area above the safe-area inset (≈ input bar / 1.5).
// Used by screens that need a bottom spacer to clear the floating tab bar.
export const TAB_BAR_ICON_HEIGHT = 60; // px above insets.bottom

import { DashboardScreen } from '../screens/dashboard/DashboardScreen';
import { PlannerScreen } from '../screens/planner/PlannerScreen';
import { ChatStack } from './ChatStack';
import { ProjectsStack } from './ProjectsStack';
import { SettingsStack } from './SettingsStack';
import type { RootTabParamList } from './types';

const Tab = createBottomTabNavigator<RootTabParamList>();

const SPRING_CONFIG = { damping: 22, stiffness: 180 };

function CalendarDayIcon({ color }: { color: string }) {
    const day = String(new Date().getDate());
    return (
        <View style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            borderWidth: 1.5,
            borderColor: color,
            alignItems: 'center',
            justifyContent: 'center',
        }}>
            <Text style={{
                fontSize: 13,
                fontWeight: '700',
                color,
                lineHeight: 15,
                includeFontPadding: false,
            }}>{day}</Text>
        </View>
    );
}

function AnimatedTabBar(props: BottomTabBarProps) {
    const { state } = props;
    const { theme } = useTheme();
    const heightSV = useSharedValue(0);
    const progress = useSharedValue(0); // 0 = visible, 1 = hidden

    const activeTabName = state.routes[state.index]?.name;
    const chatRoute = state.routes.find(r => r.name === 'Chat');
    const projectsRoute = state.routes.find(r => r.name === 'Projects');
    // getFocusedRouteNameFromRoute returns undefined on the initial route (ChatList).
    // Hide the bar only when navigated to ChatDetail, not on the list.
    const chatFocusedRoute = chatRoute
        ? getFocusedRouteNameFromRoute(chatRoute)
        : undefined;
    const isInChatDetail =
        activeTabName === 'Chat' &&
        chatFocusedRoute !== undefined &&
        chatFocusedRoute !== 'ChatList';
    // getFocusedRouteNameFromRoute returns undefined on the initial route (ProjectsList).
    // Hide the bar whenever we've navigated away from the root screen.
    const projectsFocusedRoute = projectsRoute
        ? getFocusedRouteNameFromRoute(projectsRoute)
        : undefined;
    // undefined = initial state (ProjectsList), 'ProjectsList' = navigated back to list.
    // Hide the bar whenever we're deeper than the root screen.
    const isInProjectChatDetail =
        activeTabName === 'Projects' &&
        projectsFocusedRoute !== undefined &&
        projectsFocusedRoute !== 'ProjectsList';

    useEffect(() => {
        progress.value = withSpring(
            isInChatDetail || isInProjectChatDetail ? 1 : 0,
            SPRING_CONFIG,
        );
    }, [isInChatDetail, isInProjectChatDetail]);

    // Measure the tab bar once on first layout
    const handleLayout = (e: LayoutChangeEvent) => {
        const h = e.nativeEvent.layout.height;
        if (h > 0 && heightSV.value === 0) {
            heightSV.value = h;
        }
    };

    // Slide the bar off-screen downward without changing layout — avoids any reflow/jump
    const containerStyle = useAnimatedStyle(() => ({
        position: 'absolute' as const,
        bottom: 0,
        left: 0,
        right: 0,
        transform: [{ translateY: heightSV.value * progress.value }],
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
    }));

    return (
        <Animated.View
            style={[
                containerStyle,
                {
                    borderWidth: 1,
                    borderBottomWidth: 0,
                    borderColor: `${theme.accent}40`,
                },
            ]}
            onLayout={handleLayout}
        >
            <BottomTabBar {...props} />
        </Animated.View>
    );
}

export function MainTabs() {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const { user } = useAuth();
    const { activeChatID } = useMain();
    // Total tab bar height = icon area + device bottom inset
    const tabBarHeight = TAB_BAR_ICON_HEIGHT + insets.bottom;

    return (
        <Tab.Navigator
            tabBar={props => <AnimatedTabBar {...props} />}
            screenOptions={({
                route,
            }: {
                route: RouteProp<RootTabParamList, keyof RootTabParamList>;
            }) => ({
                headerShown: false,
                tabBarStyle: {
                    backgroundColor: theme.surface,
                    borderTopWidth: 0,
                    height: tabBarHeight,
                    paddingTop: 12,
                },
                tabBarActiveTintColor: theme.accent,
                tabBarInactiveTintColor: 'rgba(255,255,255,0.55)',
                tabBarShowLabel: false,
                tabBarIcon: ({
                    focused,
                    color,
                }: {
                    focused: boolean;
                    color: string;
                }) => {
                    let iconName: keyof typeof Ionicons.glyphMap;

                    if (route.name === 'Planning') {
                        return <CalendarDayIcon color={color} />;
                    }

                    switch (route.name) {
                        case 'Dashboard':
                            iconName = focused ? 'home' : 'home-outline';
                            break;
                        case 'Chat':
                            iconName = focused
                                ? 'chatbubbles'
                                : 'chatbubbles-outline';
                            break;
                        case 'Projects':
                            iconName = focused ? 'folder' : 'folder-outline';
                            break;
                        case 'Settings':
                            iconName = focused
                                ? 'settings'
                                : 'settings-outline';
                            break;
                        default:
                            iconName = 'ellipse';
                    }

                    return <Ionicons name={iconName} size={28} color={color} />;
                },
            })}
        >
            <Tab.Screen name="Dashboard" component={DashboardScreen} />
            <Tab.Screen name="Planning" component={PlannerScreen} />
            <Tab.Screen
                name="Chat"
                component={ChatStack}
                listeners={({ navigation }) => ({
                    tabPress: e => {
                        e.preventDefault();
                        if (user?.single_chat_mode && activeChatID) {
                            navigation.navigate('Chat', {
                                screen: 'ChatDetail',
                                params: { chatId: activeChatID },
                            });
                        } else {
                            navigation.navigate('Chat', { screen: 'ChatList' });
                        }
                    },
                })}
            />
            <Tab.Screen name="Projects" component={ProjectsStack} />
            <Tab.Screen name="Settings" component={SettingsStack} />
        </Tab.Navigator>
    );
}
