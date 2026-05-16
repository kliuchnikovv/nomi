import React, { useEffect } from 'react';
import { LayoutChangeEvent } from 'react-native';
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
import { useMain, emptyChatID } from '../screens/main/context';

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


function AnimatedTabBar(props: BottomTabBarProps & { initialHeight: number }) {
    const { state, initialHeight } = props;
    const { theme } = useTheme();
    const { user } = useAuth();

    // ── Determine visibility synchronously, before hooks ──────────────────────
    // This lets us seed progress with the correct initial value so there is no
    // first-frame flash of the bar on screens where it should be hidden.

    const activeTabName = state.routes[state.index]?.name;
    const chatRoute = state.routes.find(r => r.name === 'Chat');
    const projectsRoute = state.routes.find(r => r.name === 'Projects');

    // getFocusedRouteNameFromRoute returns undefined for the initial (root) route.
    // We also inspect the nested route state directly so single_chat_mode, which
    // uses ChatDetail as the initial Chat-stack route, is handled correctly.
    const chatFocusedRoute = chatRoute
        ? getFocusedRouteNameFromRoute(chatRoute)
        : undefined;
    const chatNestedRouteName = chatRoute?.state
        ? (chatRoute.state.routes[chatRoute.state.index ?? 0] as any)?.name
        : undefined;
    const isInChatDetail =
        activeTabName === 'Chat' &&
        (
            // In single_chat_mode, ChatList is not registered in the stack —
            // the Chat tab always shows ChatDetail regardless of params.screen.
            !!user?.single_chat_mode ||
            (chatFocusedRoute !== undefined && chatFocusedRoute !== 'ChatList') ||
            chatNestedRouteName === 'ChatDetail'
        );

    const projectsFocusedRoute = projectsRoute
        ? getFocusedRouteNameFromRoute(projectsRoute)
        : undefined;
    const isInProjectChatDetail =
        activeTabName === 'Projects' &&
        projectsFocusedRoute !== undefined &&
        projectsFocusedRoute !== 'ProjectsList';

    const shouldHide = isInChatDetail || isInProjectChatDetail;

    // ── Shared values ─────────────────────────────────────────────────────────
    // heightSV is pre-seeded so the translateY calculation is correct on the
    // very first frame (onLayout fires after paint).
    const heightSV = useSharedValue(initialHeight);
    // opacity: 1 = visible, 0 = hidden (directly maps shouldHide → 0/1).
    const opacity = useSharedValue(shouldHide ? 0 : 1);

    // Animate on subsequent route changes.
    useEffect(() => {
        const target = shouldHide ? 0 : 1;
        opacity.value = withSpring(target, SPRING_CONFIG);
        // Also update heightSV-based translation for a slide-out effect.
        heightSV.value = initialHeight;
    }, [shouldHide, initialHeight]);

    // Refine the height once the real layout is known.
    const handleLayout = (e: LayoutChangeEvent) => {
        const h = e.nativeEvent.layout.height;
        if (h > 0) {
            heightSV.value = h;
        }
    };

    const containerStyle = useAnimatedStyle(() => ({
        position: 'absolute' as const,
        bottom: 0,
        left: 0,
        right: 0,
        // Slide down while fading — gives a natural exit feel.
        transform: [{ translateY: heightSV.value * (1 - opacity.value) }],
        opacity: opacity.value,
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
            tabBar={props => <AnimatedTabBar {...props} initialHeight={tabBarHeight} />}
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
                        if (user?.single_chat_mode) {
                            // In single_chat_mode ChatList is not in the stack;
                            // always open ChatDetail. Fall back to emptyChatID so
                            // the welcome screen shows when no active chat exists yet.
                            navigation.navigate('Chat', {
                                screen: 'ChatDetail',
                                params: { chatId: activeChatID || emptyChatID },
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
