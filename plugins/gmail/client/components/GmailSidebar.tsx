import React, { useEffect, useState } from 'react';
import { View, Text, SectionList, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Mail } from 'iconoir-react-native';
import { useTheme } from '@genie/front/context/ThemeContext';
import { gmailClient } from '@genie/front/services/integrations/clients/GmailClient';
import { Email } from '@genie/front/services/integrations/IntegrationStorage';
import { PluginSidebarProps } from '@genie/front/plugins/types';

export function GmailSidebar({ integrationId, onSelect, isSelected }: PluginSidebarProps) {
    const { theme, palette } = useTheme();
    const [emails, setEmails] = useState<Email[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadEmails = async () => {
        try {
            setLoading(true);
            setError(null);
            // Get recent emails (cached + sync)
            const data = await gmailClient.getRecentEmails(integrationId, 20);
            setEmails(data);
        } catch (error) {
            console.error('Failed to load gmail emails:', error);
            setError(error instanceof Error ? error.message : 'Failed to load emails');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadEmails();
    }, [integrationId]);

    const groupEmailsByDate = (emails: Email[]) => {
        const groups: Record<string, Email[]> = {};
        emails.forEach(email => {
            if (!email.date) return;
            const dateStr = new Date(email.date).toDateString();
            if (!groups[dateStr]) {
                groups[dateStr] = [];
            }
            groups[dateStr].push(email);
        });

        // Sort dates descending (newest first)
        return Object.entries(groups)
            .sort((a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime())
            .map(([date, data]) => ({
                title: date,
                data: data.sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0))
            }));
    };

    const sections = groupEmailsByDate(emails);

    return (
        <View style={{ flex: 1 }}>
            <Pressable
                style={[
                    styles.header,
                    isSelected && { backgroundColor: `${theme.accent}15` }
                ]}
                onPress={onSelect}
            >
                <View style={styles.headerLeft}>
                    <Mail width={20} height={20} color={palette.red} />
                    <Text style={[styles.headerTitle, { color: theme.text }]}>Gmail</Text>
                </View>
                {/* Optional: Add compose button or unread count */}
            </Pressable>

            {error && !loading && (
                <View style={styles.center}>
                    <Text style={[styles.errorText, { color: theme.error || '#ef4444', textAlign: 'center' }]}>{error}</Text>
                    <Pressable onPress={loadEmails} style={styles.retryButton}>
                        <Text style={[styles.retryButtonText, { color: theme.accent }]}>Retry</Text>
                    </Pressable>
                </View>
            )}

            {loading && !error && emails.length === 0 ? (
                <View style={styles.center}>
                    <ActivityIndicator color={theme.textSecondary} />
                </View>
            ) : !error ? (
                <SectionList
                    sections={sections}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={styles.listContent}
                    renderSectionHeader={({ section: { title } }) => {
                        const date = new Date(title);
                        const isToday = new Date().toDateString() === title;
                        const displayTitle = isToday
                            ? 'Today'
                            : date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

                        return (
                            <View style={[styles.sectionHeader, { backgroundColor: theme.background }]}>
                                <Text style={[styles.sectionHeaderText, { color: theme.textSecondary }]}>
                                    {displayTitle}
                                </Text>
                            </View>
                        );
                    }}
                    renderItem={({ item }) => (
                        <Pressable
                            style={[styles.emailItem, { backgroundColor: theme.card }]}
                            onPress={onSelect} // For now, clicking an email goes to main view
                        >
                            <View style={styles.emailHeader}>
                                <Text style={[styles.sender, { color: theme.text }]} numberOfLines={1}>
                                    {item.fromName || item.fromEmail}
                                </Text>
                                <Text style={[styles.time, { color: theme.textSecondary }]}>
                                    {item.date?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </Text>
                            </View>
                            <Text style={[styles.subject, { color: theme.text }]} numberOfLines={1}>
                                {item.subject || '(No Subject)'}
                            </Text>
                            <Text style={[styles.snippet, { color: theme.textSecondary }]} numberOfLines={2}>
                                {item.snippet}
                            </Text>
                        </Pressable>
                    )}
                    ListEmptyComponent={
                        <View style={styles.center}>
                            <Text style={{ color: theme.textSecondary }}>No recent emails</Text>
                        </View>
                    }
                />
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: 'rgba(150, 150, 150, 0.2)',
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    headerTitle: {
        fontSize: 16,
        fontWeight: '600',
    },
    center: {
        padding: 20,
        alignItems: 'center',
    },
    errorText: {
        fontSize: 13,
        marginBottom: 12,
    },
    retryButton: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 6,
        backgroundColor: '#e0f2fe',
    },
    retryButtonText: {
        fontSize: 13,
        fontWeight: '600',
    },
    listContent: {
        padding: 12,
        paddingBottom: 40,
    },
    sectionHeader: {
        paddingVertical: 8,
        marginBottom: 4,
    },
    sectionHeaderText: {
        fontSize: 12,
        fontWeight: '600',
        textTransform: 'uppercase',
    },
    emailItem: {
        marginBottom: 8,
        padding: 12,
        borderRadius: 8,
    },
    emailHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 4,
    },
    sender: {
        fontSize: 14,
        fontWeight: '600',
        flex: 1,
        marginRight: 8,
    },
    time: {
        fontSize: 12,
    },
    subject: {
        fontSize: 14,
        fontWeight: '500',
        marginBottom: 2,
    },
    snippet: {
        fontSize: 13,
    },
});
