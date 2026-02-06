import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, ActivityIndicator, Pressable } from 'react-native';
import { useTheme } from '@genie/front/context/ThemeContext';
import { gmailClient } from '@genie/front/services/integrations/clients/GmailClient';
import { Email } from '@genie/front/services/integrations/IntegrationStorage';
import { PluginMainScreenProps } from '@genie/front/plugins/types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { XmarkCircle } from 'iconoir-react-native';

export function GmailMainScreen({ integrationId: integrationIdProp, onClose }: PluginMainScreenProps) {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const [emails, setEmails] = useState<Email[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const integrationId = integrationIdProp ?? 'gmail'; 

    const loadEmails = async () => {
        try {
            const data = await gmailClient.getCachedEmails(integrationId);
            setEmails(data);
        } catch (error) {
            console.error('Failed to load emails:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleRefresh = async () => {
        setRefreshing(true);
        try {
            // Force sync
            await gmailClient.syncEmails(integrationId);
            await loadEmails();
        } catch (error) {
            console.error('Failed to refresh emails:', error);
        } finally {
            setRefreshing(false);
        }
    };

    useEffect(() => {
        loadEmails();
    }, []);

    const renderItem = ({ item }: { item: Email }) => (
        <View style={[styles.emailItem, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={styles.emailHeader}>
                <Text style={[styles.sender, { color: theme.text }]} numberOfLines={1}>
                    {item.fromName || item.fromEmail}
                </Text>
                <Text style={[styles.date, { color: theme.textSecondary }]}>
                    {item.date ? new Date(item.date).toLocaleDateString() : ''}
                </Text>
            </View>
            <Text style={[styles.subject, { color: theme.text }]} numberOfLines={1}>
                {item.subject}
            </Text>
            <Text style={[styles.snippet, { color: theme.textSecondary }]} numberOfLines={2}>
                {item.snippet}
            </Text>
        </View>
    );

    return (
        <View style={[styles.container, { backgroundColor: theme.background }]}>
            {/* Header */}
            <View style={[styles.header, { paddingTop: insets.top + 10, borderBottomColor: theme.border }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={[styles.headerTitle, { color: theme.text }]}>Gmail</Text>
                    {onClose && (
                        <Pressable onPress={onClose} hitSlop={12}>
                            <XmarkCircle width={24} height={24} color={theme.textSecondary} />
                        </Pressable>
                    )}
                </View>
            </View>

            {loading ? (
                <View style={styles.center}>
                    <ActivityIndicator size="large" color={theme.accent} />
                </View>
            ) : (
                <FlatList
                    data={emails}
                    renderItem={renderItem}
                    keyExtractor={item => item.id}
                    contentContainerStyle={styles.listContent}
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.accent} />
                    }
                    ListEmptyComponent={
                        <View style={styles.center}>
                            <Text style={{ color: theme.textSecondary }}>No emails found</Text>
                        </View>
                    }
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        paddingHorizontal: 20,
        paddingBottom: 15,
        borderBottomWidth: 1,
    },
    headerTitle: {
        fontSize: 24,
        fontWeight: 'bold',
    },
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    listContent: {
        padding: 16,
    },
    emailItem: {
        padding: 16,
        borderRadius: 12,
        marginBottom: 12,
        borderWidth: 1,
    },
    emailHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 4,
    },
    sender: {
        fontWeight: '600',
        fontSize: 15,
        flex: 1,
        marginRight: 8,
    },
    date: {
        fontSize: 12,
    },
    subject: {
        fontSize: 15,
        fontWeight: '500',
        marginBottom: 4,
    },
    snippet: {
        fontSize: 14,
    },
});
