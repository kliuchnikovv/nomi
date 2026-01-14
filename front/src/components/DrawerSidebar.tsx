import React, { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { interpolate, SharedValue, useAnimatedStyle } from 'react-native-reanimated';
import { GestureDetector } from 'react-native-gesture-handler';
import { Gesture } from 'react-native-gesture-handler';
import { useTheme } from '../context/ThemeContext';
import { createSidebarStyles, SidebarSide, SidebarStyles } from './drawerSidebarStyles';

export interface SidebarProps {
    side: SidebarSide;
    variant: 'inline' | 'overlay';
    width: number;
    visible?: boolean;
    onClose?: () => void;
    translateX?: SharedValue<number>;
    dragGesture?: ReturnType<typeof Gesture.Pan>;
    children: React.ReactNode;
}

export function Sidebar({
    side,
    variant,
    width,
    onClose,
    translateX,
    dragGesture,
    children,
}: SidebarProps) {
    const { theme } = useTheme();
    const styles = useMemo(() => createSidebarStyles(theme, side), [theme, side]);

    if (variant === 'inline') {
        return (
            <View style={[styles.container, { width }]}>
                {children}
            </View>
        );
    }

    // Overlay variant
    if (!translateX) {
        return null;
    }

    const isLeft = side === 'left';

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: translateX.value }],
    }));

    const backdropStyle = useAnimatedStyle(() => {
        // For left sidebar: translateX goes from -width (closed) to 0 (open)
        // For right sidebar: translateX goes from width (closed) to 0 (open)
        const closedValue = isLeft ? -width : width;
        const opacity = interpolate(
            translateX.value,
            [closedValue, 0],
            [0, 0.5],
            'clamp'
        );
        return { opacity };
    });

    const containerStyle = useAnimatedStyle(() => {
        // Hide container when fully closed
        const closedValue = isLeft ? -width : width;
        const threshold = isLeft ? closedValue + 1 : closedValue - 1;
        const isClosed = isLeft
            ? translateX.value <= threshold
            : translateX.value >= threshold;
        return {
            zIndex: isClosed ? -1 : 100,
        };
    });

    const cardPositionStyle = isLeft
        ? { left: 0 }
        : { right: 0, left: undefined };

    // Drag handle element - only this responds to the drag gesture
    const dragHandle = dragGesture ? (
        <GestureDetector gesture={dragGesture}>
            <View style={{
                width: '100%',
                height: 24,
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 8,
            }}>
                <View style={{
                    width: 40,
                    height: 4,
                    borderRadius: 2,
                    backgroundColor: theme.border,
                }} />
            </View>
        </GestureDetector>
    ) : null;

    const content = (
        <Animated.View style={[styles.overlayCard, { width }, cardPositionStyle, animatedStyle]}>
            {dragHandle}
            {children}
        </Animated.View>
    );

    return (
        <Animated.View style={[styles.overlayRoot, containerStyle]} pointerEvents="box-none">
            <Animated.View style={[styles.overlayBackdrop, backdropStyle]}>
                <Pressable style={{ flex: 1 }} onPress={onClose} />
            </Animated.View>
            {content}
        </Animated.View>
    );
}

// Re-export styles for use in children
export { createSidebarStyles };
export type { SidebarStyles, SidebarSide };
