import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Linking } from 'react-native';
import { useTheme } from '../../../../context/ThemeContext'; // Adjusted path
import { createStyles } from '../styles'; // Adjusted path, assuming reusing chat styles or create new ones
import { Ionicons } from '@expo/vector-icons';

interface BriefingItem {
    id: string;
    type: 'meeting' | 'email' | 'task' | 'alert';
    priority: 'CRITICAL' | 'INFO';
    title: string;
    description: string;
    context?: string;
    action_required: boolean;
    source_link?: string;
}

interface BriefingData {
    headline: string;
    summary: string;
    items: BriefingItem[];
}

export const BriefingCard = () => {
    const { theme } = useTheme();
    // const styles = createBriefingStyles(theme); // Define below
    const [expanded, setExpanded] = useState(false);
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<BriefingData | null>(null);

    // Mock loading for now, later hook up to agent
    const loadBriefing = async () => {
        setLoading(true);
        // Simulate API call
        setTimeout(() => {
            setData({
                headline: "3 Critical blockers today",
                summary: "You have a tight schedule with a boss meeting and urgent API issues to resolve.",
                items: [
                    {
                        id: '1', type: 'meeting', priority: 'CRITICAL', title: 'Quarterly Review',
                        description: 'Meeting with Boss to discuss Q1 results.',
                        context: 'Last interaction: He asked for the budget report on Monday.',
                        action_required: true
                    },
                    {
                        id: '2', type: 'task', priority: 'INFO', title: 'Fix login timeout',
                        description: 'Github Issue #402',
                        context: 'See your notes on "Auth Optimization" in Obsidian.',
                        action_required: false
                    }
                ]
            });
            setLoading(false);
            setExpanded(true);
        }, 1500);
    };

    if (!data && !loading) {
        return (
            <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
                <TouchableOpacity onPress={loadBriefing} style={styles.header}>
                    <View style={styles.headerTitleContainer}>
                        <Ionicons name="sunny" size={24} color={theme.colors.primary} />
                        <Text style={[styles.headerTitle, { color: theme.colors.text }]}>Morning Briefing</Text>
                    </View>
                    <Text style={[styles.actionText, { color: theme.colors.primary }]}>Prepare</Text>
                </TouchableOpacity>
            </View>
        );
    }

    return (
        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
            <TouchableOpacity onPress={() => setExpanded(!expanded)} style={styles.header}>
                <View style={styles.headerTitleContainer}>
                    <Ionicons name="sunny" size={24} color={theme.colors.primary} />
                    <Text style={[styles.headerTitle, { color: theme.colors.text }]}>
                        {loading ? "Preparing..." : data?.headline || "Your Focus Today"}
                    </Text>
                </View>
                {loading ? <ActivityIndicator size="small" color={theme.colors.primary} /> :
                    <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={20} color={theme.colors.textSecondary} />
                }
            </TouchableOpacity>

            {expanded && data && (
                <View style={styles.content}>
                    <Text style={[styles.summary, { color: theme.colors.textSecondary }]}>{data.summary}</Text>

                    {data.items.map((item) => (
                        <View key={item.id} style={[styles.itemContainer, { borderLeftColor: item.priority === 'CRITICAL' ? theme.colors.error : theme.colors.info }]}>
                            <View style={styles.itemHeader}>
                                <Text style={[styles.itemTitle, { color: theme.colors.text }]}>{item.title}</Text>
                                {item.source_link && (
                                    <TouchableOpacity onPress={() => Linking.openURL(item.source_link!)}>
                                        <Ionicons name="link" size={16} color={theme.colors.primary} />
                                    </TouchableOpacity>
                                )}
                            </View>
                            <Text style={[styles.itemDescription, { color: theme.colors.textSecondary }]}>{item.description}</Text>
                            {item.context && (
                                <View style={[styles.contextContainer, { backgroundColor: theme.colors.background }]}>
                                    <Text style={[styles.contextText, { color: theme.colors.textSecondary }]}>
                                        <Ionicons name="bulb-outline" size={14} /> {item.context}
                                    </Text>
                                </View>
                            )}
                        </View>
                    ))}
                </View>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    card: {
        margin: 16,
        marginBottom: 8,
        borderRadius: 16,
        borderWidth: 1,
        overflow: 'hidden',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
    },
    headerTitleContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    headerTitle: {
        fontSize: 16,
        fontWeight: '600',
    },
    actionText: {
        fontSize: 14,
        fontWeight: '600',
    },
    content: {
        padding: 16,
        paddingTop: 0,
    },
    summary: {
        fontSize: 14,
        marginBottom: 16,
        lineHeight: 20,
    },
    itemContainer: {
        marginBottom: 12,
        paddingLeft: 12,
        borderLeftWidth: 4,
    },
    itemHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 4,
    },
    itemTitle: {
        fontSize: 15,
        fontWeight: '600',
    },
    itemDescription: {
        fontSize: 14,
        marginBottom: 6,
    },
    contextContainer: {
        padding: 8,
        borderRadius: 8,
    },
    contextText: {
        fontSize: 13,
        fontStyle: 'italic',
    },
});
