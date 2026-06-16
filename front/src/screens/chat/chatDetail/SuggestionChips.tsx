import React from 'react';
import { ScrollView, Text, TouchableOpacity, StyleSheet } from 'react-native';

interface Props {
    suggestions: string[];
    onPress: (text: string) => void;
    accentColor: string;
    surfaceColor: string;
    textPrimaryColor: string;
}

/**
 * Horizontal strip of generated follow-up suggestion chips, rendered just above
 * the chat input. Tapping a chip fills the composer (does not auto-send).
 * Styled to match the welcome-screen starter chips (PersistentChatEmptyState).
 */
export function SuggestionChips({
    suggestions,
    onPress,
    accentColor,
    surfaceColor,
    textPrimaryColor,
}: Props) {
    if (!suggestions.length) return null;

    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}
        >
            {suggestions.map((text, index) => (
                <TouchableOpacity
                    key={`${index}-${text}`}
                    style={[
                        styles.chip,
                        {
                            backgroundColor: surfaceColor,
                            borderColor: accentColor + '40',
                        },
                    ]}
                    onPress={() => onPress(text)}
                    activeOpacity={0.7}
                >
                    <Text
                        style={[styles.chipText, { color: textPrimaryColor }]}
                        numberOfLines={1}
                    >
                        {text}
                    </Text>
                </TouchableOpacity>
            ))}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    content: {
        flexDirection: 'row',
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    chip: {
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 18,
        borderWidth: 1,
    },
    chipText: { fontSize: 14, fontWeight: '500' },
});
