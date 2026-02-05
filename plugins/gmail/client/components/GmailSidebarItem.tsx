import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Mail } from 'iconoir-react-native';
import { useTheme } from '@genie/front/context/ThemeContext';
import { ThemePalette } from '@genie/front/themes/types';

interface GmailSidebarItemProps {
    integrationId: string;
    onSelect: () => void;
    isSelected: boolean;
}

export function GmailSidebarItem({ integrationId, onSelect, isSelected }: GmailSidebarItemProps) {
    const { theme, palette } = useTheme();
    // In a real app, we would subscribe to a store or context to get the unread count for this specific integration.
    // For now, we'll assume the parent component might pass it or we fetch it.
    // Simplification: Static unread count or fetched from local storage hook (omitted for brevity).
    const unreadCount = 0; 

    return (
        <Pressable
            style={[
                styles.container,
                isSelected && { backgroundColor: `${theme.accent}15` }
            ]}
            onPress={onSelect}
        >
            <View style={styles.left}>
                <Mail width={20} height={20} color={palette.red} />
                <Text style={[styles.label, { color: theme.text }]}>Gmail</Text>
            </View>
            {unreadCount > 0 && (
                <View style={[styles.badge, { backgroundColor: palette.red }]}>
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
