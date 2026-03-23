import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../context/ThemeContext';

interface QuickActionsWidgetProps {
    onOpenChats?: () => void;
    onNewChatPress: () => void;
}

export function QuickActionsWidget({ onOpenChats, onNewChatPress }: QuickActionsWidgetProps) {
    const { theme } = useTheme();

    return (
        <View style={styles.row}>
            <TouchableOpacity
                style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
                onPress={onOpenChats}
                activeOpacity={0.8}
            >
                <Ionicons name="list-outline" size={24} color={theme.accent} />
                <Text style={[styles.label, { color: theme.textPrimary }]}>All Chats</Text>
            </TouchableOpacity>

            <TouchableOpacity
                style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
                onPress={onNewChatPress}
                activeOpacity={0.8}
            >
                <Ionicons name="add-circle-outline" size={24} color={theme.accent} />
                <Text style={[styles.label, { color: theme.textPrimary }]}>New Chat</Text>
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        gap: 8,
    },
    card: {
        flex: 1,
        padding: 16,
        borderRadius: 16,
        borderWidth: 1,
        minHeight: 90,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 8,
    },
    label: {
        fontSize: 13,
        fontWeight: '600',
    },
});
