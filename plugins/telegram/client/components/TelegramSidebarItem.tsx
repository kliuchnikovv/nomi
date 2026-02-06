import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '@genie/front/context/ThemeContext';
import { PluginSidebarProps } from '@genie/front/plugins/types';

export function TelegramSidebarItem({ integrationId, onSelect, isSelected }: PluginSidebarProps) {
    const { theme, palette } = useTheme();

    return (
        <Pressable
            style={[
                styles.container,
                isSelected && { backgroundColor: `${theme.accent}15` }
            ]}
            onPress={onSelect}
        >
            <View style={styles.left}>
                <Text style={styles.icon}>✈️</Text>
                <Text style={[styles.label, { color: theme.text }]}>Telegram</Text>
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 8,
        marginVertical: 2,
    },
    left: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    icon: {
        fontSize: 18,
    },
    label: {
        fontSize: 15,
        fontWeight: '500',
    },
});
