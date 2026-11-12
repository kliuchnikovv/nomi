/**
 * UpdatesBellButton — header entry point to the Updates (proactive) chat with an
 * unread badge. Always rendered so the inbox affordance is consistently visible;
 * navigation is a no-op until the user's Updates chat id is known.
 */

import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import { Text } from '@nomi/ds';
import { useTheme } from '../../../context/ThemeContext';
import { useMain } from '../../main/context';
import { useUpdates } from '../hooks/useUpdatesUnread';
import type { RootTabParamList } from '../../../navigation/types';

export function UpdatesBellButton() {
    const navigation = useNavigation<NavigationProp<RootTabParamList>>();
    const { theme, descriptor } = useTheme();
    const { updatesChatId } = useMain();
    const { unreadCount } = useUpdates();

    const hasUnread = unreadCount > 0;
    const badgeText = unreadCount > 99 ? '99+' : String(unreadCount);

    return (
        <Pressable
            style={[styles.button, { backgroundColor: theme.surface }]}
            hitSlop={8}
            onPress={() => {
                if (!updatesChatId) return;
                navigation.navigate('Chat', {
                    screen: 'ChatDetail',
                    params: { chatId: updatesChatId },
                });
            }}
        >
            <Ionicons
                name={hasUnread ? 'notifications' : 'notifications-outline'}
                size={22}
                color={theme.text}
            />
            {hasUnread && (
                <View style={[styles.badge, { backgroundColor: theme.accent }]}>
                    <Text
                        theme={descriptor}
                        variant="caption"
                        weight="700"
                        style={styles.badgeText}
                        numberOfLines={1}
                    >
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
