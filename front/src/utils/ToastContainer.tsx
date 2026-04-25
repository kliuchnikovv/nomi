import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { subscribeToast } from './toast';

export function ToastContainer() {
    const [message, setMessage] = useState('');
    const opacity = useRef(new Animated.Value(0)).current;
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => subscribeToast((msg) => {
        if (timerRef.current) clearTimeout(timerRef.current);
        setMessage(msg);
        opacity.setValue(0);
        Animated.sequence([
            Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }),
            Animated.delay(1200),
            Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
        ]).start();
        timerRef.current = setTimeout(() => setMessage(''), 1700);
    }), []);

    if (!message) return null;

    return (
        <Animated.View style={[styles.container, { opacity }]}>
            <Text style={styles.text}>{message}</Text>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        bottom: 100,
        alignSelf: 'center',
        backgroundColor: 'rgba(0,0,0,0.75)',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        zIndex: 999,
    },
    text: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '600',
    },
});
