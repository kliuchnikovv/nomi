import React, { useState, useEffect } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl, ActivityIndicator, Text } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { DashboardHeader } from './components/DashboardHeader';
import { GreetingCard } from './components/GreetingCard';
import { ActiveTasksList } from '../../components/dashboard/ActiveTasksList';

import { BriefingCard } from '../chat/components/BriefingCard';
import { dashboardApi, apiClient } from '../../apiClient';
import { NewTaskModal } from '../../components/NewTaskModal';
import { getApiUrl } from '../../config';
import { Chat } from '../main/models';

interface DashboardScreenProps {
    onNavigateToChat: (chatId: string) => void;
    onNewChatPress: () => void;
    onOpenChats?: () => void;
    onOpenInbox?: () => void;
    showHeader?: boolean;
}

export const DashboardScreen = ({ onNavigateToChat, onNewChatPress, onOpenChats, onOpenInbox, showHeader = true }: DashboardScreenProps) => {
    const { theme } = useTheme();
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [newTaskVisible, setNewTaskVisible] = useState(false);
    const [dashboardData, setDashboardData] = useState<{
        user: { name: string };
        recent_chats: any[];
        stats: { unread_emails: number; today_events: number };
    } | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadDashboard();
    }, []);

    const loadDashboard = async (isRefresh = false) => {
        if (isRefresh) {
            setRefreshing(true);
        } else {
            setLoading(true);
        }
        setError(null);

        try {
            const data = await dashboardApi.getDashboard();
            setDashboardData(data);
        } catch (e) {
            console.error('Failed to load dashboard:', e);
            setError('Failed to load dashboard');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    const onRefresh = () => {
        loadDashboard(true);
    };

    if (loading && !dashboardData) {
        return (
            <View style={[styles.container, { backgroundColor: theme.background }]}>
                <View style={styles.centerContent}>
                    <ActivityIndicator size="large" color={theme.primary} />
                </View>
            </View>
        );
    }

    if (error && !dashboardData) {
        return (
            <View style={[styles.container, { backgroundColor: theme.background }]}>
                <View style={styles.centerContent}>
                    <Text style={[styles.errorText, { color: theme.error }]}>{error}</Text>
                </View>
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: theme.background }]}>
            {showHeader && (
                <DashboardHeader
                    onMenuPress={onOpenChats}
                    onInboxPress={onOpenInbox}
                    onNewTaskPress={() => setNewTaskVisible(true)}
                />
            )}
            <NewTaskModal
                visible={newTaskVisible}
                onClose={() => setNewTaskVisible(false)}
                onTaskCreated={async (task, projectId) => {
                    try {
                        const newChat = await apiClient.post<Chat>(`${getApiUrl()}/chats`, {
                            mode: 'team',
                            team_id: 'development_team',
                            project_id: projectId,
                            task_id: task.id,
                            title: task.title,
                        });
                        if (newChat && newChat.id) {
                            onNavigateToChat(newChat.id);
                        }
                    } catch (e) {
                        console.error('Failed to create chat for task:', e);
                        // Optional: alert user
                    }
                }}
            />
            <ScrollView
                style={styles.scrollView}
                contentContainerStyle={{ paddingTop: 8 }}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={onRefresh}
                        tintColor={theme.primary}
                    />
                }
            >
                <GreetingCard userName={dashboardData?.user?.name} />

                <ActiveTasksList />

                <BriefingCard />


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
    centerContent: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    errorText: {
        fontSize: 16,
    },
});
