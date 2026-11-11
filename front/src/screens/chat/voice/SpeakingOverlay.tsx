import React, { useEffect, useMemo, useRef } from 'react';
import { View, Pressable, Animated, StyleSheet } from 'react-native';
import { Text } from '@genie/ds';
import { useTheme } from '../../../context/ThemeContext';

type Props = {
    text: string;
    chunk?: string;
    onPress?: () => void;
};

// Floating "Nomi is speaking" card rendered above the Voice dock while the
// assistant is voicing a reply. Displays the full spoken text in a larger
// type with the currently-playing sentence highlighted in an animated
// accent color (karaoke follow-along). The whole card is a Pressable so
// tapping it (including on the text) interrupts playback via `onPress`.
export function SpeakingOverlay({ text, chunk, onPress }: Props) {
    const { theme, descriptor } = useTheme();

    // Non-native driver so we can interpolate to a color string.
    const anim = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        const loop = Animated.loop(
            Animated.sequence([
                Animated.timing(anim, {
                    toValue: 1,
                    duration: 900,
                    useNativeDriver: false,
                }),
                Animated.timing(anim, {
                    toValue: 0,
                    duration: 900,
                    useNativeDriver: false,
                }),
            ]),
        );
        loop.start();
        return () => loop.stop();
    }, [anim]);

    const activeColor = anim.interpolate({
        inputRange: [0, 1],
        outputRange: [theme.accentAlt, theme.accent],
    }) as any;

    // Match `chunk` inside `text` with flexible whitespace so newlines/
    // markdown in the raw reply don't defeat the karaoke highlight.
    const parts = useMemo(() => {
        const trimmed = chunk?.trim() ?? '';
        if (!trimmed) return { before: text, during: '', after: '' };
        const escaped = trimmed
            .split(/\s+/)
            .filter(Boolean)
            .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('\\s+');
        try {
            const m = new RegExp(escaped).exec(text);
            if (m) {
                return {
                    before: text.slice(0, m.index),
                    during: text.slice(m.index, m.index + m[0].length),
                    after: text.slice(m.index + m[0].length),
                };
            }
        } catch {
            /* bad regex — fall through */
        }
        return { before: text, during: '', after: '' };
    }, [chunk, text]);

    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel="Tap to interrupt"
        >
            <View
                style={[
                    styles.card,
                    {
                        backgroundColor: theme.surface,
                        borderColor: theme.border,
                    },
                ]}
            >
                <View style={styles.headerRow}>
                    <View
                        style={[
                            styles.dot,
                            { backgroundColor: theme.accentAlt },
                        ]}
                    />
                    <Text
                        theme={descriptor}
                        style={[styles.header, { color: theme.accent }]}
                    >
                        Nomi is speaking
                    </Text>
                </View>
                <Text
                    theme={descriptor}
                    style={[styles.body, { color: theme.textPrimary }]}
                >
                    {parts.before}
                    {parts.during ? (
                        <Animated.Text style={{ color: activeColor }}>
                            {parts.during}
                        </Animated.Text>
                    ) : null}
                    {parts.after}
                </Text>
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    card: {
        marginHorizontal: 12,
        marginBottom: 8,
        paddingHorizontal: 14,
        paddingTop: 10,
        paddingBottom: 12,
        borderRadius: 16,
        borderWidth: 1,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 6,
    },
    dot: { width: 6, height: 6, borderRadius: 3 },
    header: { fontSize: 11, fontWeight: '600' },
    body: { fontSize: 17, lineHeight: 24 },
});
