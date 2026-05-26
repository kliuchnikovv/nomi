import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import { useTheme } from '../../../context/ThemeContext';
import { useMain } from '../../main/context';
import type { RootTabParamList } from '../../../navigation/types';

/**
 * Dashboard card that surfaces the user's Updates (proactive) chat.
 * Hidden when updatesChatId is null (backend not yet populated or user has no updates chat).
 */
export function UpdatesCard() {
    const navigation = useNavigation<NavigationProp<RootTabParamList>>();
    const { theme } = useTheme();
    const { updatesChatId } = useMain();

    if (!updatesChatId) return null;

    return (
        <TouchableOpacity
            style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
            onPress={() =>
                navigation.navigate('Chat', {
                    screen: 'ChatDetail',
                    params: { chatId: updatesChatId },
                })
            }
            activeOpacity={0.8}
        >
            <View style={[styles.iconBg, { backgroundColor: `${theme.accent}20` }]}>
                <Ionicons name="notifications" size={20} color={theme.accent} />
            </View>
            <View style={styles.textBlock}>
                <Text style={[styles.title, { color: theme.textPrimary }]}>Updates</Text>
                <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
                    Proactive messages from Nomi
                </Text>
            </View>
            <View style={[styles.badge, { backgroundColor: theme.accent }]}>
                <Text style={styles.badgeText}>View</Text>
            </View>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 14,
        borderRadius: 16,
        borderWidth: 1,
    },
    iconBg: {
        width: 40,
        height: 40,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    textBlock: {
        flex: 1,
        gap: 2,
    },
    title: {
        fontSize: 15,
        fontWeight: '600',
    },
    subtitle: {
        fontSize: 12,
    },
    badge: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
    },
    badgeText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#fff',
    },
});
