import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../../context/ThemeContext';
import { Ionicons } from '@expo/vector-icons';

interface DashboardActionsProps {
    onOpenChats: () => void;
    onOpenInbox: () => void;
}

export const DashboardActions = ({ onOpenChats, onOpenInbox }: DashboardActionsProps) => {
    const { theme } = useTheme();

    return (
        <View style={[styles.container, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <TouchableOpacity
                style={[styles.button, { backgroundColor: theme.background }]}
                onPress={onOpenChats}
            >
                <Ionicons name="chatbubbles" size={24} color={theme.primary} />
                <Text style={[styles.buttonText, { color: theme.text }]}>All Chats</Text>
                <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity
                style={[styles.button, { backgroundColor: theme.background }]}
                onPress={onOpenInbox}
            >
                <Ionicons name="mail" size={24} color={theme.primary} />
                <Text style={[styles.buttonText, { color: theme.text }]}>Inbox</Text>
                <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
            </TouchableOpacity>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        margin: 16,
        marginTop: 8,
        borderRadius: 16,
        borderWidth: 1,
        overflow: 'hidden',
    },
    button: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        gap: 12,
    },
    buttonText: {
        flex: 1,
        fontSize: 16,
        fontWeight: '600',
    },
});
