import React, { useMemo } from 'react';
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Menu, Mail, Plus } from 'iconoir-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../../context/ThemeContext';

interface DashboardHeaderProps {
    onMenuPress?: () => void;
    onInboxPress?: () => void;
    onNewTaskPress?: () => void;
}

export function DashboardHeader({ onMenuPress, onInboxPress, onNewTaskPress }: DashboardHeaderProps) {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();

    console.log('DashboardHeader rendered', {
        hasMenuPress: !!onMenuPress,
        hasInboxPress: !!onInboxPress
    });

    return (
        <View style={[
            styles.header,
            {
                paddingTop: insets.top,
                height: 60 + insets.top,
                backgroundColor: theme.surface,
                borderBottomWidth: 1,
                borderBottomColor: theme.border,
            }
        ]}>
            {onMenuPress && (
                <TouchableOpacity
                    style={styles.button}
                    onPress={() => {
                        console.log('Menu button pressed!');
                        onMenuPress();
                    }}
                >
                    <Menu width={24} height={24} color={theme.textPrimary} strokeWidth={2} />
                </TouchableOpacity>
            )}

            <View style={styles.titleContainer}>
                <Text style={[styles.title, { color: theme.text }]}>Dashboard</Text>
            </View>

            {onNewTaskPress && (
                <TouchableOpacity
                    style={styles.button}
                    onPress={() => {
                        console.log('New Task button pressed!');
                        onNewTaskPress();
                    }}
                >
                    <Plus width={24} height={24} color={theme.textPrimary} strokeWidth={2} />
                </TouchableOpacity>
            )}

            {onInboxPress && (
                <TouchableOpacity
                    style={styles.button} // Keep consistent style
                    onPress={() => {
                        console.log('Inbox button pressed!');
                        onInboxPress();
                    }}
                >
                    <Mail width={24} height={24} color={theme.textPrimary} strokeWidth={2} />
                </TouchableOpacity>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        gap: 12,
    },
    button: {
        width: 40,
        height: 40,
        justifyContent: 'center',
        alignItems: 'center',
    },
    titleContainer: {
        flex: 1,
        justifyContent: 'center',
    },
    title: {
        fontSize: 20,
        fontWeight: '700',
    },
});
