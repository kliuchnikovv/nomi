import React, { useState } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@nomi/ds';
import { useTheme } from '../../../context/ThemeContext';

interface Props {
    recap: string;
    onDismiss: () => void;
    accentColor: string;
    surfaceColor: string;
    textPrimaryColor: string;
    textSecondaryColor: string;
    borderColor: string;
}

export function ChatRecapBanner({
    recap,
    onDismiss,
    accentColor,
    surfaceColor,
    textPrimaryColor,
    textSecondaryColor,
    borderColor,
}: Props) {
    const [expanded, setExpanded] = useState(false);
    const { descriptor } = useTheme();

    return (
        <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => setExpanded(prev => !prev)}
            style={[
                styles.container,
                { backgroundColor: surfaceColor, borderColor },
            ]}
        >
            <View
                style={[
                    styles.iconChip,
                    { backgroundColor: `${accentColor}20` },
                ]}
            >
                <Ionicons name="sparkles" size={16} color={accentColor} />
            </View>
            <View style={styles.text}>
                <Text
                    theme={descriptor}
                    variant="caption"
                    weight="500"
                    style={[styles.label, { color: textSecondaryColor }]}
                >
                    Recap
                </Text>
                <Text
                    theme={descriptor}
                    variant="body"
                    style={[styles.recap, { color: textPrimaryColor }]}
                    numberOfLines={expanded ? undefined : 3}
                >
                    {recap}
                </Text>
            </View>
            <TouchableOpacity
                style={styles.closeBtn}
                onPress={onDismiss}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
                <Ionicons name="close" size={18} color={textSecondaryColor} />
            </TouchableOpacity>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginHorizontal: 12,
        marginBottom: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 16,
        borderWidth: StyleSheet.hairlineWidth,
        gap: 10,
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
        elevation: 6,
    },
    iconChip: {
        width: 34,
        height: 34,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    text: { flex: 1 },
    label: { fontSize: 11, fontWeight: '500' },
    recap: { fontSize: 13, lineHeight: 18, marginTop: 2 },
    closeBtn: { padding: 4 },
});
