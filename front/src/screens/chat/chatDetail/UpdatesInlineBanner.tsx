/**
 * UpdatesInlineBanner — "N new updates" strip shown in the persistent chat when
 * the Updates chat has unseen proactive messages. Tapping it opens the Updates
 * chat. Layout-agnostic: the host screen decides where to place it and whether
 * it applies (e.g. hidden while already viewing the Updates chat).
 */

import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import { Text } from '@nomi/ds';
import { useTheme } from '../../../context/ThemeContext';
import { useMain } from '../../main/context';
import { useUpdates } from '../hooks/useUpdatesUnread';
import type { RootTabParamList } from '../../../navigation/types';

export function UpdatesInlineBanner() {
    const { theme, descriptor } = useTheme();
    const navigation = useNavigation<NavigationProp<RootTabParamList>>();
    const { updatesChatId } = useMain();
    const { unreadCount } = useUpdates();

    if (!updatesChatId || unreadCount === 0) return null;

    const label = `${unreadCount} new update${unreadCount === 1 ? '' : 's'}`;

    return (
        <TouchableOpacity
            style={[
                styles.container,
                { backgroundColor: theme.surface, borderColor: theme.border },
            ]}
            activeOpacity={0.8}
            onPress={() =>
                navigation.navigate('Chat', {
                    screen: 'ChatDetail',
                    params: { chatId: updatesChatId },
                })
            }
        >
            <View
                style={[
                    styles.iconBg,
                    { backgroundColor: `${theme.accent}20` },
                ]}
            >
                <Ionicons name="notifications" size={16} color={theme.accent} />
            </View>
            <Text
                theme={descriptor}
                variant="body"
                weight="600"
                style={[styles.label, { color: theme.textPrimary }]}
                numberOfLines={1}
            >
                {label}
            </Text>
            <Text
                theme={descriptor}
                variant="caption"
                weight="600"
                style={[styles.view, { color: theme.accent }]}
            >
                View
            </Text>
            <Ionicons
                name="chevron-forward"
                size={16}
                color={theme.textSecondary}
            />
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderBottomWidth: StyleSheet.hairlineWidth,
        gap: 10,
    },
    iconBg: {
        width: 28,
        height: 28,
        borderRadius: 9,
        alignItems: 'center',
        justifyContent: 'center',
    },
    label: { flex: 1, fontSize: 14, fontWeight: '600' },
    view: { fontSize: 13, fontWeight: '600' },
});
