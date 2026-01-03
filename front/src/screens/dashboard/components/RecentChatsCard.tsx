import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, LayoutAnimation, Platform, UIManager } from 'react-native';
import { useTheme } from '../../../context/ThemeContext';
import { Ionicons } from '@expo/vector-icons';

interface Chat {
    id: string;
    title?: string;
    updated_at?: string;
    icon?: string;
}

interface RecentChatsCardProps {
    chats: Chat[];
    onChatPress: (chatId: string) => void;
}

if (Platform.OS === 'android') {
    if (UIManager.setLayoutAnimationEnabledExperimental) {
        UIManager.setLayoutAnimationEnabledExperimental(true);
    }
}

export const RecentChatsCard = ({ chats, onChatPress }: RecentChatsCardProps) => {
    const { theme } = useTheme();
    const [collapsed, setCollapsed] = React.useState(false);

    const toggleCollapse = () => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setCollapsed(!collapsed);
    };

    const formatTime = (timestamp?: string) => {
        if (!timestamp) return '';
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now.getTime() - date.getTime();
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days}d ago`;
        if (hours > 0) return `${hours}h ago`;
        return 'Just now';
    };

    const getIconName = (iconName?: string) => {
        const iconMap: { [key: string]: string } = {
            'd20': 'dice',
            'sparkles': 'sparkles',
            'code': 'code-slash',
            'plane': 'airplane',
        };
        return (iconMap[iconName || ''] || 'chatbubble') as any;
    };

    return (
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <View style={styles.header}>
                <TouchableOpacity onPress={toggleCollapse} style={styles.headerTitleContainer}>
                    <Text style={[styles.headerTitle, { color: theme.text }]}>Recent Chats</Text>
                    <Ionicons
                        name={collapsed ? "chevron-down" : "chevron-up"}
                        size={20}
                        color={theme.textSecondary}
                        style={{ marginLeft: 8 }}
                    />
                </TouchableOpacity>
            </View>

            {!collapsed && (
                chats.length === 0 ? (
                    <View style={styles.emptyState}>
                        <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                            No chats yet. Create your first!
                        </Text>
                    </View>
                ) : (
                    <FlatList
                        data={chats}
                        keyExtractor={(item) => item.id}
                        scrollEnabled={false}
                        renderItem={({ item }) => (
                            <TouchableOpacity
                                style={[styles.chatItem, { borderBottomColor: theme.border }]}
                                onPress={() => onChatPress(item.id)}
                            >
                                <View style={[styles.iconContainer, { backgroundColor: theme.background }]}>
                                    <Ionicons
                                        name={getIconName(item.icon)}
                                        size={20}
                                        color={theme.primary}
                                    />
                                </View>
                                <View style={styles.chatContent}>
                                    <Text style={[styles.chatTitle, { color: theme.text }]} numberOfLines={1}>
                                        {item.title || 'New Chat'}
                                    </Text>
                                    <Text style={[styles.chatTime, { color: theme.textSecondary }]}>
                                        {formatTime(item.updated_at)}
                                    </Text>
                                </View>
                                <Ionicons name="chevron-forward" size={20} color={theme.textSecondary} />
                            </TouchableOpacity>
                        )}
                    />
                )
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    card: {
        marginHorizontal: 16,
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
        paddingBottom: 12,
    },
    headerTitleContainer: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '600',
    },
    emptyState: {
        padding: 32,
        alignItems: 'center',
    },
    emptyText: {
        fontSize: 14,
    },
    chatItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
    },
    iconContainer: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    chatContent: {
        flex: 1,
    },
    chatTitle: {
        fontSize: 15,
        fontWeight: '500',
        marginBottom: 2,
    },
    chatTime: {
        fontSize: 12,
    },
});
