/**
 * UpdatesBellButton — header entry point to the Updates (proactive) chat with an
 * unread badge. Renders an empty same-size spacer when the user has no Updates
 * chat, so it can safely sit in a fixed header slot without shifting layout.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import { useTheme } from '../../../context/ThemeContext';
import { useMain } from '../../main/context';
import { useUpdates } from '../hooks/useUpdatesUnread';
import type { RootTabParamList } from '../../../navigation/types';

export function UpdatesBellButton() {
    const navigation = useNavigation<NavigationProp<RootTabParamList>>();
    const { theme } = useTheme();
    const { updatesChatId } = useMain();
    const { unreadCount } = useUpdates();

    // Keep a same-size spacer so the header stays balanced when hidden.
    if (!updatesChatId) {
        return <View style={styles.button} />;
    }

    const hasUnread = unreadCount > 0;
    const badgeText = unreadCount > 99 ? '99+' : String(unreadCount);

    return (
        <Pressable
            style={[styles.button, { backgroundColor: theme.surface }]}
            hitSlop={8}
            onPress={() =>
                navigation.navigate('Chat', {
                    screen: 'ChatDetail',
                    params: { chatId: updatesChatId },
                })
            }
        >
            <Ionicons
                name={hasUnread ? 'notifications' : 'notifications-outline'}
                size={22}
                color={theme.text}
            />
            {hasUnread && (
                <View style={[styles.badge, { backgroundColor: theme.accent }]}>
                    <Text style={styles.badgeText} numberOfLines={1}>
                        {badgeText}
                    </Text>
                </View>
            )}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    button: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    badge: {
        position: 'absolute',
        top: 4,
        right: 4,
        minWidth: 18,
        height: 18,
        borderRadius: 9,
        paddingHorizontal: 4,
        alignItems: 'center',
        justifyContent: 'center',
    },
    badgeText: {
        fontSize: 10,
        fontWeight: '700',
        color: '#fff',
    },
});
