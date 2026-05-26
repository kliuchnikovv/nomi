import React, { useEffect, useRef } from 'react';
import {
    Animated,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Spark } from 'iconoir-react-native';
import { TAB_BAR_ICON_HEIGHT } from '../../../navigation/MainTabs';

const BANNER_HEIGHT = 52;

interface Props {
    message: string | null;
    onDismiss: () => void;
}

export function AIEditBanner({ message, onDismiss }: Props) {
    const insets = useSafeAreaInsets();
    // Banner sits at `bottom: 0` of the planner's SafeAreaView, which is ABOVE
    // the home-indicator inset. To fully hide it we slide past BANNER_HEIGHT
    // plus the bottom inset (and a little extra so the shadow doesn't peek).
    const hiddenOffset = BANNER_HEIGHT + insets.bottom + 16;
    const visibleOffset = -(insets.bottom + TAB_BAR_ICON_HEIGHT + 8);
    const translateY = useRef(new Animated.Value(hiddenOffset)).current;
    const visible = useRef(false);
    const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (message !== null && !visible.current) {
            // Slide up above the floating dock
            visible.current = true;
            Animated.timing(translateY, {
                toValue: visibleOffset,
                duration: 280,
                useNativeDriver: true,
            }).start();

            dismissTimer.current = setTimeout(() => {
                slideDown();
            }, 3000);
        } else if (message === null && visible.current) {
            slideDown();
        }

        return () => {
            if (dismissTimer.current) clearTimeout(dismissTimer.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [message]);

    const slideDown = () => {
        if (!visible.current) return;
        visible.current = false;
        if (dismissTimer.current) {
            clearTimeout(dismissTimer.current);
            dismissTimer.current = null;
        }
        Animated.timing(translateY, {
            toValue: hiddenOffset,
            duration: 240,
            useNativeDriver: true,
        }).start(() => {
            onDismiss();
        });
    };

    // Always rendered but translated off-screen when hidden
    return (
        <Animated.View
            style={[styles.banner, { transform: [{ translateY }] }]}
            pointerEvents={message !== null ? 'auto' : 'none'}
        >
            <TouchableOpacity
                style={styles.inner}
                onPress={slideDown}
                activeOpacity={0.85}
            >
                <View style={styles.textContainer}>
                    <Spark width={14} height={14} color="#FFFFFF" />
                    <Text style={styles.text}>{message ?? ''}</Text>
                </View>
            </TouchableOpacity>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    banner: {
        position: 'absolute',
        bottom: 0,
        left: 16,
        right: 16,
        height: BANNER_HEIGHT,
        borderRadius: 22,
        overflow: 'hidden',
        backgroundColor: '#007AFF',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.15,
        shadowRadius: 6,
        elevation: 8,
    },
    inner: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 16,
    },
    textContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    text: {
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: '600',
        textAlign: 'center',
    },
});
