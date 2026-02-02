import React from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { DashboardHeader } from './components/DashboardHeader';
import { GreetingCard } from './components/GreetingCard';

interface DashboardScreenProps {
    onNavigateToChat: (chatId: string) => void;
    onNewChatPress: () => void;
    onOpenChats?: () => void;
    onOpenInbox?: () => void;
    showHeader?: boolean;
}

export const DashboardScreen = ({ onNewChatPress, onOpenChats, onOpenInbox, showHeader = true }: DashboardScreenProps) => {
    const { theme } = useTheme();

    return (
        <View style={[styles.container, { backgroundColor: theme.background }]}>
            {showHeader && (
                <DashboardHeader
                    onMenuPress={onOpenChats}
                    onInboxPress={onOpenInbox}
                />
            )}
            <ScrollView
                style={styles.scrollView}
                contentContainerStyle={{ paddingTop: 8 }}
            >
                <GreetingCard />
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    scrollView: {
        flex: 1,
    },
});
