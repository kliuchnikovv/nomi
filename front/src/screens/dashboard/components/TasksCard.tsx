import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card, Text } from '@genie/ds';
import { useTheme } from '../../../context/ThemeContext';
import type { DashboardStackParamList } from '../../../navigation/types';

/**
 * Dashboard card that opens the Tasks screen — the entry point for the
 * autonomous background-task feature.
 */
export function TasksCard() {
    const navigation =
        useNavigation<
            NativeStackNavigationProp<DashboardStackParamList, 'DashboardHome'>
        >();
    const { theme, descriptor } = useTheme();

    return (
        <TouchableOpacity
            onPress={() => navigation.navigate('Tasks')}
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
                        name="rocket-outline"
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
                        Tasks
                    </Text>
                    <Text theme={descriptor} variant="caption" tone="secondary">
                        Background work Nomi runs for you
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
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    iconBg: {
        width: 40,
        height: 40,
        justifyContent: 'center',
        alignItems: 'center',
    },
    textBlock: {
        flex: 1,
        gap: 2,
    },
    badge: {},
});
