import React, { useEffect, useRef } from 'react';
import {
    Animated,
    StyleSheet,
    Text,
    TouchableOpacity,
} from 'react-native';

const BANNER_HEIGHT = 52;

interface Props {
    message: string | null;
    onDismiss: () => void;
}

export function AIEditBanner({ message, onDismiss }: Props) {
    const translateY = useRef(new Animated.Value(BANNER_HEIGHT)).current;
    const visible = useRef(false);
    const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (message !== null && !visible.current) {
            // Slide up
            visible.current = true;
            Animated.timing(translateY, {
                toValue: 0,
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
            toValue: BANNER_HEIGHT,
            duration: 240,
            useNativeDriver: true,
        }).start(() => {
            onDismiss();
        });
    };

    // Always rendered but translated off-screen when hidden
    return (
        <Animated.View
            style={[
                styles.banner,
                { transform: [{ translateY }] },
            ]}
            pointerEvents={message !== null ? 'auto' : 'none'}
        >
            <TouchableOpacity
                style={styles.inner}
                onPress={slideDown}
                activeOpacity={0.85}
            >
                <Text style={styles.text}>
                    {'✦ '}
                    {message ?? ''}
                </Text>
            </TouchableOpacity>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    banner: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: BANNER_HEIGHT,
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
    text: {
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: '600',
        textAlign: 'center',
    },
});
