import React, { useEffect } from 'react';
import { LayoutChangeEvent, Pressable, View, StyleSheet } from 'react-native';
import {
    createBottomTabNavigator,
    BottomTabBarProps,
} from '@react-navigation/bottom-tabs';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
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

// Height of the floating dock area above the safe-area inset.
// Used by screens that need a bottom spacer to clear the dock.
export const TAB_BAR_ICON_HEIGHT = 72; // px above insets.bottom (56 pill + 8 gap + breathing room)

import { DashboardStack } from './DashboardStack';
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

    // ── Determine visibility synchronously, before hooks ──────────────────────
    // This lets us seed progress with the correct initial value so there is no
    // first-frame flash of the bar on screens where it should be hidden.

    const activeTabName = state.routes[state.index]?.name;
    const projectsRoute = state.routes.find(r => r.name === 'Projects');

    const projectsFocusedRoute = projectsRoute
        ? getFocusedRouteNameFromRoute(projectsRoute)
        : undefined;
    // Hide the dock on the Projects detail / create-edit screens, but KEEP it on
    // the project chat (ProjectChatDetail) so it has the same bottom nav as a
    // normal chat in the Chat tab.
    const shouldHide =
        activeTabName === 'Projects' &&
        projectsFocusedRoute !== undefined &&
        projectsFocusedRoute !== 'ProjectsList' &&
        projectsFocusedRoute !== 'ProjectChatDetail';

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
    }));

    return (
        <Animated.View
            pointerEvents="box-none"
            style={containerStyle}
            onLayout={handleLayout}
        >
            <DockFade color={theme.background} />
            <FloatingDock {...props} />
        </Animated.View>
    );
}

// Stacked-band faux gradient — used instead of expo-linear-gradient so we don't
// require a native rebuild. Eight bands stepping from transparent at the top to
// solid `color` at the bottom give a smooth-enough fade behind the floating dock.
function DockFade({ color }: { color: string }) {
    const STEPS = 24;
    const toHex2 = (n: number) =>
        Math.round(Math.min(1, Math.max(0, n)) * 255)
            .toString(16)
            .padStart(2, '0');
    return (
        <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
            {Array.from({ length: STEPS }).map((_, i) => {
                const alpha = ((i + 1) / STEPS) ** 1.8;
                return (
                    <View
                        key={i}
                        style={{
                            position: 'absolute',
                            left: 0,
                            right: 0,
                            top: `${(i * 100) / STEPS}%`,
                            height: `${100 / STEPS + 0.5}%`,
                            backgroundColor: `${color}${toHex2(alpha)}`,
                        }}
                    />
                );
            })}
        </View>
    );
}

function getTabIcon(
    routeName: string,
    focused: boolean,
): keyof typeof Ionicons.glyphMap {
    switch (routeName) {
        case 'Dashboard':
            return focused ? 'home' : 'home-outline';
        case 'Planning':
            return focused ? 'calendar' : 'calendar-outline';
        case 'Chat':
            return focused ? 'chatbubbles' : 'chatbubbles-outline';
        case 'Projects':
            return focused ? 'folder' : 'folder-outline';
        case 'Settings':
            return focused ? 'settings' : 'settings-outline';
        default:
            return 'ellipse';
    }
}

function FloatingDock({ state, descriptors, navigation }: BottomTabBarProps) {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const { user } = useAuth();
    const { activeChatID } = useMain();

    const translateX = useSharedValue(0);
    const slotWidth = useSharedValue(0);

    const onRowLayout = (e: LayoutChangeEvent) => {
        const w = e.nativeEvent.layout.width;
        if (w > 0 && state.routes.length > 0) {
            const next = w / state.routes.length;
            slotWidth.value = next;
            translateX.value = next * state.index;
        }
    };

    useEffect(() => {
        if (slotWidth.value > 0) {
            translateX.value = withSpring(
                slotWidth.value * state.index,
                SPRING_CONFIG,
            );
        }
    }, [state.index]);

    const activePillStyle = useAnimatedStyle(() => ({
        position: 'absolute' as const,
        top: 0,
        bottom: 0,
        width: slotWidth.value,
        transform: [{ translateX: translateX.value }],
    }));

    return (
        <View
            pointerEvents="box-none"
            style={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 8 }}
        >
            <View
                style={[
                    dockStyles.dock,
                    {
                        backgroundColor: theme.surface,
                        borderColor: `${theme.accent}40`,
                    },
                ]}
            >
                <View style={dockStyles.row} onLayout={onRowLayout}>
                    <Animated.View
                        pointerEvents="none"
                        style={[
                            activePillStyle,
                            dockStyles.activePill,
                            { backgroundColor: `${theme.accent}2E` },
                        ]}
                    />
                    {state.routes.map((route, index) => {
                        const focused = state.index === index;
                        const { options } = descriptors[route.key];
                        const color = focused
                            ? theme.accent
                            : 'rgba(255,255,255,0.55)';

                        const onPress = () => {
                            const event = navigation.emit({
                                type: 'tabPress',
                                target: route.key,
                                canPreventDefault: true,
                            });
                            if (event.defaultPrevented) return;

                            if (route.name === 'Chat') {
                                if (user?.single_chat_mode) {
                                    navigation.navigate('Chat', {
                                        screen: 'ChatDetail',
                                        params: {
                                            chatId: activeChatID || emptyChatID,
                                        },
                                    });
                                } else {
                                    navigation.navigate('Chat', {
                                        screen: 'ChatList',
                                    });
                                }
                                return;
                            }

                            if (!focused) {
                                navigation.navigate(route.name);
                            }
                        };

                        return (
                            <Pressable
                                key={route.key}
                                onPress={onPress}
                                accessibilityRole="button"
                                accessibilityState={{ selected: focused }}
                                accessibilityLabel={
                                    options.tabBarAccessibilityLabel ??
                                    route.name
                                }
                                style={dockStyles.slot}
                            >
                                <Ionicons
                                    name={getTabIcon(route.name, focused)}
                                    size={26}
                                    color={color}
                                />
                            </Pressable>
                        );
                    })}
                </View>
            </View>
        </View>
    );
}

const dockStyles = StyleSheet.create({
    dock: {
        height: 56,
        borderRadius: 28,
        borderWidth: 1,
        padding: 6,
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
        elevation: 12,
    },
    row: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'stretch',
        position: 'relative',
    },
    activePill: {
        borderRadius: 22,
    },
    slot: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
});

export function MainTabs() {
    const insets = useSafeAreaInsets();
    const { user } = useAuth();
    const { activeChatID } = useMain();
    // Total tab bar height = icon area + device bottom inset
    const tabBarHeight = TAB_BAR_ICON_HEIGHT + insets.bottom;

    return (
        <Tab.Navigator
            tabBar={props => (
                <AnimatedTabBar {...props} initialHeight={tabBarHeight} />
            )}
            screenOptions={{
                headerShown: false,
                tabBarStyle: { display: 'none' },
            }}
        >
            <Tab.Screen name="Dashboard" component={DashboardStack} />
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
