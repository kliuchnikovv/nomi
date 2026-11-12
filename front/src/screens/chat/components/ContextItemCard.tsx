/**
 * Context Item Card Component
 *
 * Displays notifications when items (emails, documents, images) are added to chat context.
 * Users can remove items from context by clicking X button.
 */

import React from 'react';
import {
    View,
    TouchableOpacity,
    StyleSheet,
    Pressable,
    Linking,
    Alert,
} from 'react-native';
import { Text } from '@nomi/ds';
import { useTheme } from '../../../context/ThemeContext';
import { Ionicons } from '@expo/vector-icons';

export interface ContextItem {
    id: string;
    sourceType:
        | 'email'
        | 'document'
        | 'image'
        | 'task'
        | 'note'
        | 'calendar_event'
        | 'github_repo'
        | 'location';
    title: string;
    preview?: string;
    metadata?: Record<string, any>;
    addedAt: number;
}

interface ContextItemCardProps {
    item: ContextItem;
    onRemove?: (id: string) => void;
    removable?: boolean; // If false, don't show remove button
}

export const ContextItemCard = ({
    item,
    onRemove,
    removable = true,
}: ContextItemCardProps) => {
    const { theme, descriptor } = useTheme();

    const getSourceDetails = () => {
        switch (item.sourceType) {
            case 'email':
                return {
                    icon: 'mail' as const,
                    label: 'Email',
                    color: '#EA4335',
                };
            case 'document':
                return {
                    icon: 'document-text' as const,
                    label: 'Document',
                    color: '#4285F4',
                };
            case 'image':
                return {
                    icon: 'image' as const,
                    label: 'Image',
                    color: '#34A853',
                };
            case 'task':
                return {
                    icon: 'checkmark-circle' as const,
                    label: 'Task',
                    color: '#FBBC04',
                };
            case 'note':
                return {
                    icon: 'document' as const,
                    label: 'Note',
                    color: '#9C27B0',
                };
            case 'calendar_event':
                return {
                    icon: 'calendar' as const,
                    label: 'Calendar',
                    color: '#4285F4',
                };
            case 'github_repo':
                return {
                    icon: 'logo-github' as const,
                    label: 'GitHub',
                    color: theme.textPrimary ?? '#FFFFFF',
                };
            case 'location':
                return {
                    icon: 'location' as const,
                    label: 'Location',
                    color: '#34A853',
                };
            default:
                return {
                    icon: 'apps' as const,
                    label: 'Item',
                    color: theme.textSecondary || '#888888',
                };
        }
    };

    const formatEventDate = (start: string): string => {
        try {
            const date = new Date(start);
            return date.toLocaleString(undefined, {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
            });
        } catch {
            return start;
        }
    };

    const { icon, label, color } = getSourceDetails();

    const truncateText = (text: string, maxLength: number = 17): string => {
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength) + '...';
    };

    // For GitHub repos, split owner/repo into separate display parts
    const githubParts =
        item.sourceType === 'github_repo' && item.title.includes('/')
            ? {
                  owner: item.title.split('/')[0],
                  repo: item.title.split('/')[1],
              }
            : null;

    const displayName = githubParts
        ? truncateText(githubParts.repo)
        : truncateText(item.title);

    if (item.sourceType === 'location') {
        const lat = item.metadata?.lat;
        const lon = item.metadata?.lon;
        const address = item.metadata?.address ?? item.title;
        return (
            <Pressable
                style={[
                    styles.container,
                    {
                        backgroundColor: theme.surface,
                        borderColor: theme.border,
                    },
                ]}
                onPress={() => {
                    if (lat != null && lon != null) {
                        Linking.openURL(
                            `maps://?ll=${lat},${lon}&q=${encodeURIComponent(
                                item.title,
                            )}`,
                        ).catch(() =>
                            Linking.openURL(
                                `https://maps.google.com/?q=${lat},${lon}`,
                            ),
                        );
                    }
                }}
                onLongPress={() => Alert.alert(item.title, address)}
            >
                <View style={styles.content}>
                    <View
                        style={[
                            styles.iconContainer,
                            { backgroundColor: `${color}15` },
                        ]}
                    >
                        <Ionicons name={icon} size={18} color={color} />
                    </View>
                    <View style={styles.textContent}>
                        <Text
                            theme={descriptor}
                            tone="primary"
                            style={styles.title}
                            numberOfLines={2}
                        >
                            {item.title}
                        </Text>
                    </View>
                </View>
            </Pressable>
        );
    }

    return (
        <View
            style={[
                styles.container,
                { backgroundColor: theme.surface, borderColor: theme.border },
            ]}
        >
            {removable && (
                <TouchableOpacity
                    onPress={() => onRemove && onRemove(item.id)}
                    style={styles.removeButton}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                    <Ionicons
                        name="close-circle"
                        size={20}
                        color={theme.textSecondary || '#888888'}
                    />
                </TouchableOpacity>
            )}

            <View style={styles.content}>
                {/* Icon and title */}
                <View
                    style={[
                        styles.iconContainer,
                        { backgroundColor: `${color}15` },
                    ]}
                >
                    <Ionicons name={icon} size={18} color={color} />
                </View>
                <View style={styles.textContent}>
                    <Text
                        theme={descriptor}
                        tone="primary"
                        style={styles.title}
                        numberOfLines={1}
                    >
                        {displayName}
                    </Text>
                    {item.sourceType === 'calendar_event' &&
                        item.metadata?.start && (
                            <Text
                                theme={descriptor}
                                tone="secondary"
                                style={styles.subtitle}
                                numberOfLines={1}
                            >
                                {formatEventDate(item.metadata.start)}
                            </Text>
                        )}
                    {githubParts && (
                        <Text
                            theme={descriptor}
                            tone="secondary"
                            style={styles.subtitle}
                            numberOfLines={1}
                        >
                            {githubParts.owner}
                        </Text>
                    )}
                </View>
            </View>
        </View>
    );
};

interface ContextItemsListProps {
    items: ContextItem[];
    onRemove: (id: string) => void;
    onClearAll?: () => void;
}

export const ContextItemsList = ({
    items,
    onRemove,
    onClearAll,
}: ContextItemsListProps) => {
    const { theme, descriptor } = useTheme();

    if (items.length === 0) return null;

    return (
        <View
            style={[
                styles.listContainer,
                { backgroundColor: theme.background },
            ]}
        >
            <View style={styles.listHeader}>
                {onClearAll && (
                    <TouchableOpacity
                        onPress={onClearAll}
                        style={styles.clearButton}
                    >
                        <Text
                            theme={descriptor}
                            tone="accent"
                            style={styles.clearText}
                        >
                            Clean
                        </Text>
                    </TouchableOpacity>
                )}
            </View>

            {items.map((item, index) => (
                <ContextItemCard
                    key={item.id}
                    item={item}
                    onRemove={onRemove}
                />
            ))}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
        marginBottom: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 3,
        elevation: 2,
    },
    removeButton: {
        position: 'absolute',
        top: 8,
        right: 8,
        zIndex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.05)',
        borderRadius: 12,
        padding: 4,
    },
    content: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        flex: 1,
    },
    iconContainer: {
        width: 28,
        height: 28,
        borderRadius: 8,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 8,
    },
    textContent: {
        flex: 1,
    },
    title: {
        fontSize: 13,
        fontWeight: '500',
    },
    subtitle: {
        fontSize: 11,
        marginTop: 2,
    },
    listContainer: {
        marginHorizontal: 16,
        marginTop: 8,
        borderRadius: 16,
        padding: 12,
    },
    listHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 4,
        paddingBottom: 8,
        marginBottom: 4,
    },
    listTitle: {
        fontSize: 14,
        fontWeight: '600',
    },
    clearButton: {
        paddingHorizontal: 12,
        paddingVertical: 4,
    },
    clearText: {
        fontSize: 13,
        fontWeight: '600',
    },
});
