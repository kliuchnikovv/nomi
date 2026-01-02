import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Linking } from 'react-native';
import { useTheme } from '../../../context/ThemeContext'; // Adjusted path
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

import { briefingApi } from '../../../apiClient';

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

    // Load real briefing data
    const loadBriefing = async () => {
        setLoading(true);
        try {
            const result = await briefingApi.getBriefing();
            if (result && !result.error) {
                setData(result);
                setExpanded(true);
            } else {
                console.error("Briefing error:", result?.error);
            }
        } catch (e) {
            console.error("Failed to load briefing:", e);
        } finally {
            setLoading(false);
        }
    };

    if (!data && !loading) {
        return (
            <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <TouchableOpacity onPress={loadBriefing} style={styles.header}>
                    <View style={styles.headerTitleContainer}>
                        <Ionicons name="sunny" size={24} color={theme.primary} />
                        <Text style={[styles.headerTitle, { color: theme.text }]}>Morning Briefing</Text>
                    </View>
                    <Text style={[styles.actionText, { color: theme.primary }]}>Prepare</Text>
                </TouchableOpacity>
            </View>
        );
    }

    return (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <TouchableOpacity onPress={() => setExpanded(!expanded)} style={styles.header}>
                <View style={styles.headerTitleContainer}>
                    <Ionicons name="sunny" size={24} color={theme.primary} />
                    <Text style={[styles.headerTitle, { color: theme.text }]}>
                        {loading ? "Preparing..." : data?.headline || "Your Focus Today"}
                    </Text>
                </View>
                {loading ? <ActivityIndicator size="small" color={theme.primary} /> :
                    <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={20} color={theme.textSecondary} />
                }
            </TouchableOpacity>

            {expanded && data && (
                <View style={styles.content}>
                    <Text style={[styles.summary, { color: theme.textSecondary }]}>{data.summary}</Text>

                    {data.items.map((item) => (
                        <View key={item.id} style={[styles.itemContainer, { borderLeftColor: item.priority === 'CRITICAL' ? theme.error : theme.info }]}>
                            <View style={styles.itemHeader}>
                                <Text style={[styles.itemTitle, { color: theme.text }]}>{item.title}</Text>
                                {item.source_link && (
                                    <TouchableOpacity onPress={() => Linking.openURL(item.source_link!)}>
                                        <Ionicons name="link" size={16} color={theme.primary} />
                                    </TouchableOpacity>
                                )}
                            </View>
                            <Text style={[styles.itemDescription, { color: theme.textSecondary }]}>{item.description}</Text>
                            {item.context && (
                                <View style={[styles.contextContainer, { backgroundColor: theme.background }]}>
                                    <Text style={[styles.contextText, { color: theme.textSecondary }]}>
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
