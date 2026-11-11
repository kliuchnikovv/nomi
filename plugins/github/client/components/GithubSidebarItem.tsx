import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Github } from 'iconoir-react-native';
import { useTheme } from '@nomi/front/context/ThemeContext';
import { ThemePalette } from '@nomi/front/themes/types';
import { PluginSidebarProps } from '@nomi/front/plugins/types';

export function GithubSidebarItem({ integrationId, onSelect, isSelected }: PluginSidebarProps) {
    const { theme, palette } = useTheme();
    const [unreadCount, setUnreadCount] = useState(0);

    return (
        <Pressable
            style={[
                styles.container,
                isSelected && { backgroundColor: `${theme.accent}15` }
            ]}
            onPress={onSelect}
        >
            <View style={styles.left}>
                <Github width={20} height={20} color={palette.black} />
                <Text style={[styles.label, { color: theme.text }]}>GitHub</Text>
            </View>
            {unreadCount > 0 && (
                <View style={[styles.badge, { backgroundColor: palette.black }]}>
                    <Text style={styles.badgeText}>{unreadCount}</Text>
                </View>
            )}
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
    label: {
        fontSize: 15,
        fontWeight: '500',
    },
    badge: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 10,
        minWidth: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    badgeText: {
        color: 'white',
        fontSize: 11,
        fontWeight: '700',
    },
});
