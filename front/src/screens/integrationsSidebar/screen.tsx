import React, { useEffect, useMemo, useRef } from 'react';
import {
    ActivityIndicator,
    FlatList,
    Pressable,
    RefreshControl,
    Text,
    View,
} from 'react-native';
import { SharedValue } from 'react-native-reanimated';
import { Gesture } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createRightSidebarStyles, RightSidebarStyles } from './styles';
import { Plugin } from './models';
import { usePluginChats } from './context';
import { useTheme } from '../../context/ThemeContext';
import { Sidebar } from '../../components/DrawerSidebar';
import { ThemePalette } from '../../themes/types';
import { useMain } from '../main/context';
import { PluginIcon } from '../../components/PluginIcon';
import { INTEGRATION_REGISTRY } from '../../services/integrations/registry';

function PluginSection({
    plugin,
    totalUnread,
    styles,
    palette,
    onClose,
}: {
    plugin: Plugin;
    totalUnread: number;
    styles: RightSidebarStyles;
    palette: ThemePalette;
    onClose?: () => void;
}) {
    const { theme } = useTheme();
    const { setActivePluginView, setActivePluginIntegrationId, setRightSidebarVisible } = useMain();

    const metadata = INTEGRATION_REGISTRY[plugin.provider.toLowerCase()];
    const displayName = plugin.name;
    const iconColor = metadata?.color || theme.text;

    const handlePress = () => {
        setActivePluginView(plugin.provider);
        setActivePluginIntegrationId(plugin.id);
        setRightSidebarVisible(false);
        onClose?.();
    };

    return (
        <Pressable
            style={({ pressed }) => [
                styles.pluginHeader,
                pressed && { opacity: 0.7 },
            ]}
            onPress={handlePress}
        >
            <View style={styles.pluginHeaderRow}>
                <View style={styles.pluginHeaderLeft}>
                    <PluginIcon 
                        provider={plugin.provider} 
                        size={20} 
                        color={iconColor}
                    />
                    <Text style={styles.pluginName}>{displayName}</Text>
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


function RightSidebarContent({
    onClose,
    styles,
    palette,
}: {
    onClose?: () => void;
    styles: RightSidebarStyles;
    palette: ThemePalette;
}) {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();
    const { plugins, loading, refreshing, error, refresh } = usePluginChats();
    const sortedPlugins = useMemo(
        () => [...plugins].sort((a, b) => a.name.localeCompare(b.name)),
        [plugins],
    );

    if (error) {
        return (
            <View style={styles.root}>
                <View style={[styles.sectionHeader, { paddingTop: insets.top + 12 }]}>
                    <Text style={styles.sectionTitle}>Integrations</Text>
                </View>
                <View style={styles.emptyState}>
                    <Text style={styles.emptyText}>Error: {error}</Text>
                    <Pressable onPress={refresh} style={{ marginTop: 12 }}>
                        <Text style={[styles.emptyText, { textDecorationLine: 'underline' }]}>
                            Retry
                        </Text>
                    </Pressable>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.root}>
            <View style={{ paddingTop: insets.top - 25 }} />
            <View style={[styles.sectionHeader, { marginTop: 12 }]}>
                <Text style={styles.sectionTitle}>Integrations</Text>
            </View>

            {loading && plugins.length === 0 ? (
                <View style={styles.emptyState}>
                    <ActivityIndicator size="large" color={theme.accent} />
                </View>
            ) : (
                <FlatList
                    data={sortedPlugins}
                    keyExtractor={plugin => plugin.id}
                    style={{ flex: 1 }}
                    contentContainerStyle={[styles.pluginsList, plugins.length === 0 && { flex: 1 }]}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={refresh}
                            tintColor={theme.accent}
                            colors={[theme.accent]}
                        />
                    }
                    ListEmptyComponent={
                        <View style={[styles.emptyState, { flex: 1 }]}>
                            <Text style={styles.emptyText}>No integrations</Text>
                            <Text style={[styles.emptyText, { fontSize: 12, marginTop: 8 }]}>
                                Connect an integration to get started
                            </Text>
                        </View>
                    }
                    renderItem={({ item: plugin }) => (
                        <PluginSection
                            plugin={plugin}
                            totalUnread={plugin.chats.reduce((sum, chat) => sum + (chat.unreadCount || 0), 0)}
                            styles={styles}
                            palette={palette}
                            onClose={onClose}
                        />
                    )}
                />
            )}
        </View>
    );
}


export interface RightSidebarProps {
    variant: 'inline' | 'overlay';
    width: number;
    onClose?: () => void;
    translateX?: SharedValue<number>;
    dragGesture?: ReturnType<typeof Gesture.Pan>;
}

export default function RightSidebar({
    variant,
    width,
    onClose,
    translateX,
    dragGesture,
}: RightSidebarProps) {
    const { theme, palette } = useTheme();
    const { refresh } = usePluginChats();
    const styles = useMemo(() => createRightSidebarStyles(theme, palette), [theme, palette]);
    const hasRefreshed = useRef(false);

    // Refresh when sidebar becomes visible (only once)
    useEffect(() => {
        if (!hasRefreshed.current && (variant === 'inline' || (translateX && translateX.value === 0))) {
            refresh();
            hasRefreshed.current = true;
        }
    }, [variant, translateX, refresh]);

    return (
        <Sidebar
            side="right"
            variant={variant}
            width={width}
            onClose={onClose}
            translateX={translateX}
            dragGesture={dragGesture}
        >
            <RightSidebarContent
                onClose={onClose}
                styles={styles}
                palette={palette}
            />
        </Sidebar>
    );
}
