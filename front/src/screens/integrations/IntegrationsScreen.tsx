import React, { useMemo, useRef } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Pressable,
    RefreshControl,
    Text,
    View,
    StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePluginChats } from '../integrationsSidebar/context';
import { useTheme } from '../../context/ThemeContext';
import { Plugin } from '../integrationsSidebar/models';
import { useMain } from '../main/context';
import { PluginIcon } from '../../components/PluginIcon';
import { INTEGRATION_REGISTRY } from '../../services/integrations/registry';

function PluginSection({
    plugin,
    totalUnread,
    onPress,
}: {
    plugin: Plugin;
    totalUnread: number;
    onPress: () => void;
}) {
    const { theme } = useTheme();
    const { setActivePluginView, setActivePluginIntegrationId } = useMain();

    const metadata = INTEGRATION_REGISTRY[plugin.provider.toLowerCase()];
    const displayName = plugin.name;
    const iconColor = metadata?.color || theme.text;

    return (
        <Pressable
            style={({ pressed }) => [
                styles.pluginItem,
                { backgroundColor: theme.surface, borderColor: theme.border },
                pressed && { opacity: 0.7 },
            ]}
            onPress={onPress}
        >
            <View style={styles.pluginItemRow}>
                <View style={styles.pluginItemLeft}>
                    <PluginIcon
                        provider={plugin.provider}
                        size={24}
                        color={iconColor}
                    />
                    <Text style={[styles.pluginName, { color: theme.textPrimary }]}>{displayName}</Text>
                    {totalUnread > 0 && (
                        <View style={[styles.unreadBadge, { backgroundColor: iconColor }]}>
                            <Text style={styles.unreadBadgeText}>{totalUnread}</Text>
                        </View>
                    )}
                </View>
            </View>
        </Pressable>
    );
}

export function IntegrationsScreen() {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const { plugins, loading, refreshing, error, refresh } = usePluginChats();
    const { setActivePluginView, setActivePluginIntegrationId } = useMain();
    const hasRefreshed = useRef(false);

    const sortedPlugins = useMemo(
        () => [...plugins].sort((a, b) => a.name.localeCompare(b.name)),
        [plugins],
    );

    const handlePluginPress = (plugin: Plugin) => {
        setActivePluginView(plugin.provider);
        setActivePluginIntegrationId(plugin.id);
    };

    return (
        <View style={[styles.container, { backgroundColor: theme.background }]}>
            <View style={[styles.header, { paddingTop: insets.top }]}>
                <Text style={[styles.title, { color: theme.textPrimary }]}>Integrations</Text>
            </View>

            {error ? (
                <View style={styles.emptyState}>
                    <Text style={[styles.emptyText, { color: theme.textSecondary }]}>Error: {error}</Text>
                    <Pressable onPress={refresh} style={styles.retryButton}>
                        <Text style={[styles.retryButtonText, { color: theme.accent }]}>Retry</Text>
                    </Pressable>
                </View>
            ) : loading && plugins.length === 0 ? (
                <View style={styles.emptyState}>
                    <ActivityIndicator size="large" color={theme.accent} />
                </View>
            ) : (
                <FlatList
                    data={sortedPlugins}
                    keyExtractor={(plugin) => plugin.id}
                    style={styles.list}
                    contentContainerStyle={[styles.listContent, plugins.length === 0 && { flex: 1 }]}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={refresh}
                            tintColor={theme.accent}
                            colors={[theme.accent]}
                        />
                    }
                    ListEmptyComponent={
                        <View style={styles.emptyState}>
                            <Text style={[styles.emptyText, { color: theme.textSecondary }]}>No integrations</Text>
                            <Text style={[styles.emptyText, { fontSize: 13, marginTop: 8, color: theme.textSecondary }]}>
                                Connect an integration to get started
                            </Text>
                        </View>
                    }
                    renderItem={({ item: plugin }) => (
                        <PluginSection
                            plugin={plugin}
                            totalUnread={plugin.chats.reduce((sum, chat) => sum + (chat.unreadCount || 0), 0)}
                            onPress={() => handlePluginPress(plugin)}
                        />
                    )}
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
        paddingHorizontal: 16,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: 'transparent',
    },
    title: {
        fontSize: 32,
        fontWeight: '700',
    },
    list: {
        flex: 1,
    },
    listContent: {
        paddingHorizontal: 16,
        paddingBottom: 16,
    },
    pluginItem: {
        paddingVertical: 16,
        paddingHorizontal: 16,
        borderRadius: 12,
        borderWidth: 1,
        marginBottom: 12,
    },
    pluginItemRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    pluginItemLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        gap: 12,
    },
    pluginName: {
        fontSize: 16,
        fontWeight: '600',
        flex: 1,
    },
    unreadBadge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
        minWidth: 24,
        alignItems: 'center',
        justifyContent: 'center',
    },
    unreadBadgeText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '700',
    },
    emptyState: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 32,
    },
    emptyText: {
        fontSize: 16,
        textAlign: 'center',
    },
    retryButton: {
        marginTop: 16,
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 8,
    },
    retryButtonText: {
        fontSize: 14,
        fontWeight: '600',
    },
});
