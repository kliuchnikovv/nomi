import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import { Card, Text } from '@nomi/ds';
import { useTheme } from '../../../context/ThemeContext';
import { useMain } from '../../main/context';
import type { RootTabParamList } from '../../../navigation/types';

/**
 * Dashboard card that surfaces the user's Updates (proactive) chat.
 * Hidden when updatesChatId is null (backend not yet populated or user has no updates chat).
 */
export function UpdatesCard() {
    const navigation = useNavigation<NavigationProp<RootTabParamList>>();
    const { theme, descriptor } = useTheme();
    const { updatesChatId } = useMain();

    if (!updatesChatId) return null;

    return (
        <TouchableOpacity
            onPress={() =>
                navigation.navigate('Chat', {
                    screen: 'ChatDetail',
                    params: { chatId: updatesChatId },
                })
            }
            activeOpacity={0.8}
            style={{ borderRadius: descriptor.radius.lg }}
        >
            <Card
                theme={descriptor}
                padding="md"
                radius="lg"
                bordered
                style={styles.row}
            >
                <View
                    style={[
                        styles.iconBg,
                        {
                            backgroundColor: `${theme.accent}20`,
                            borderRadius: descriptor.radius.md,
                        },
                    ]}
                >
                    <Ionicons
                        name="notifications"
                        size={20}
                        color={theme.accent}
                    />
                </View>
                <View style={styles.textBlock}>
                    <Text
                        theme={descriptor}
                        variant="body"
                        tone="primary"
                        weight="600"
                    >
                        Updates
                    </Text>
                    <Text theme={descriptor} variant="caption" tone="secondary">
                        Proactive messages from Nomi
                    </Text>
                </View>
                <View
                    style={[
                        styles.badge,
                        {
                            backgroundColor: theme.accent,
                            borderRadius: descriptor.radius.md,
                            paddingHorizontal: descriptor.spacing.sm,
                            paddingVertical: descriptor.spacing.xs,
                        },
                    ]}
                >
                    <Text
                        theme={descriptor}
                        variant="caption"
                        weight="600"
                        style={{ color: theme.background }}
                    >
                        View
                    </Text>
                </View>
            </Card>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    iconBg: {
        width: 40,
        height: 40,
        justifyContent: 'center',
        alignItems: 'center',
    },
    textBlock: { flex: 1, gap: 2 },
    badge: {},
});
