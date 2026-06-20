import React, { useEffect, useMemo, useState } from 'react';
import {
    Alert,
    Modal,
    Pressable,
    RefreshControl,
    ScrollView,
    Text,
    View,
    StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Xmark, NavArrowLeft } from 'iconoir-react-native';
import { usePluginChats } from '../integrationsSidebar/context';
import { useTheme } from '../../context/ThemeContext';
import { useMain } from '../main/context';
import { useConnectors } from '../settings/connectors/context';
import { Integration } from '../settings/connectors/models';
import { getClientPlugin } from '../../plugins/clientRegistry';
import { arePluginsRegistered } from '../../plugins/registerClientPlugins';
import { PluginIcon } from '../../components/PluginIcon';
import { ContextMenu, ContextMenuItem } from '../../components/ContextMenu';
import { BrowserTab } from '../settings/connectors/tabs/BrowserTab';
import { INTEGRATION_REGISTRY } from '../../services/integrations/registry';

// UI grouping for the integrations list. Categories come from the integrations
// registry (one source of truth for provider metadata); this map only decides
// which categories collapse into a single visible section.
const SECTION_CATEGORIES: { title: string; categories: string[] }[] = [
    { title: 'Mail', categories: ['email'] },
    { title: 'Calendars', categories: ['calendar'] },
    { title: 'Messengers', categories: ['messaging'] },
    {
        title: 'Tools',
        categories: ['development', 'productivity', 'social', 'health'],
    },
];

const SECTIONS: { title: string; ids: string[] }[] = SECTION_CATEGORIES.map(
    ({ title, categories }) => ({
        title,
        ids: Object.values(INTEGRATION_REGISTRY)
            .filter(m => m.category != null && categories.includes(m.category))
            .map(m => m.id),
    }),
);
const KNOWN_IDS = new Set(SECTIONS.flatMap(s => s.ids));

function IntegrationItem({
    integration,
    unreadCount,
    onPress,
    onLongPress,
}: {
    integration: Integration;
    unreadCount: number;
    onPress: (() => void) | null;
    onLongPress: () => void;
}) {
    const { theme } = useTheme();
    const metadata = INTEGRATION_REGISTRY[integration.provider.toLowerCase()];
    const iconColor = metadata?.color || theme.text;
    const tappable = onPress !== null;

    return (
        <Pressable
            style={({ pressed }: { pressed: boolean }) => [
                styles.pluginItem,
                { backgroundColor: theme.surface, borderColor: theme.border },
                pressed && tappable && { opacity: 0.7 },
            ]}
            onPress={tappable ? onPress : undefined}
            onLongPress={onLongPress}
            delayLongPress={400}
        >
            <View style={styles.pluginItemRow}>
                <View style={styles.pluginItemLeft}>
                    <PluginIcon
                        provider={integration.provider}
                        size={24}
                        color={iconColor}
                    />
                    <View style={styles.nameBlock}>
                        <Text
                            style={[
                                styles.pluginName,
                                { color: theme.textPrimary },
                            ]}
                        >
                            {integration.name}
                        </Text>
                        {!integration.connected && (
                            <Text
                                style={[
                                    styles.disabledLabel,
                                    { color: theme.textSecondary },
                                ]}
                            >
                                Disabled
                            </Text>
                        )}
                    </View>
                    {unreadCount > 0 && (
                        <View
                            style={[
                                styles.unreadBadge,
                                { backgroundColor: iconColor },
                            ]}
                        >
                            <Text style={styles.unreadBadgeText}>
                                {unreadCount}
                            </Text>
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
    const navigation = useNavigation();
    const { plugins, refreshing, refresh } = usePluginChats();
    const { integrations, toggleTool, deleteIntegration } = useConnectors();
    const { setActivePluginView, setActivePluginIntegrationId } = useMain();

    const [addOpen, setAddOpen] = useState(false);
    const [menuVisible, setMenuVisible] = useState(false);
    const [menuTarget, setMenuTarget] = useState<Integration | null>(null);

    // Re-render once plugins are registered (they load async after mount)
    const [pluginsReady, setPluginsReady] = useState(arePluginsRegistered);
    useEffect(() => {
        if (pluginsReady) return;
        const id = setInterval(() => {
            if (arePluginsRegistered()) {
                setPluginsReady(true);
                clearInterval(id);
            }
        }, 100);
        return () => clearInterval(id);
    }, [pluginsReady]);

    // Group connected integrations by category
    const sections = useMemo(() => {
        const byProvider = new Map<string, Integration>();
        for (const i of integrations) {
            // Allow multiple accounts per provider (gmail, imap) — use first for display,
            // but collect all so each account gets its own row
            if (!byProvider.has(`${i.provider}_${i.id}`)) {
                byProvider.set(`${i.provider}_${i.id}`, i);
            }
        }
        const all = Array.from(byProvider.values());

        const result: { title: string; items: Integration[] }[] = [];

        for (const section of SECTIONS) {
            const items = section.ids.flatMap(id =>
                all.filter(i => i.provider.toLowerCase() === id),
            );
            if (items.length > 0) result.push({ title: section.title, items });
        }

        // Catch-all for unknown providers
        const other = all.filter(i => !KNOWN_IDS.has(i.provider.toLowerCase()));
        if (other.length > 0) result.push({ title: 'Other', items: other });

        return result;
    }, [integrations, pluginsReady]);

    const getUnreadCount = (provider: string): number => {
        const plugin = plugins.find(
            p => p.provider.toLowerCase() === provider.toLowerCase(),
        );
        if (!plugin) return 0;
        return plugin.chats.reduce(
            (sum, chat) => sum + (chat.unreadCount || 0),
            0,
        );
    };

    const handlePress = (integration: Integration) => {
        setActivePluginView(integration.provider);
        setActivePluginIntegrationId(integration.id);
    };

    const handleLongPress = (integration: Integration) => {
        setMenuTarget(integration);
        setMenuVisible(true);
    };

    const handleToggle = async () => {
        if (!menuTarget) return;
        await toggleTool(menuTarget.id, !menuTarget.connected);
        setMenuTarget(prev =>
            prev ? { ...prev, connected: !prev.connected } : null,
        );
    };

    const handleDelete = () => {
        if (!menuTarget) return;
        setMenuVisible(false);
        Alert.alert('Remove Integration', `Remove ${menuTarget.name}?`, [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Remove',
                style: 'destructive',
                onPress: () => deleteIntegration(menuTarget.id),
            },
        ]);
    };

    const contextMenuItems: ContextMenuItem[] = menuTarget
        ? [
              {
                  id: 'toggle',
                  label: menuTarget.connected ? 'Enabled' : 'Disabled',
                  isSwitch: true,
                  switchValue: menuTarget.connected,
                  onPress: handleToggle,
              },
              {
                  id: 'delete',
                  label: 'Remove',
                  destructive: true,
                  onPress: handleDelete,
              },
          ]
        : [];

    const isEmpty = sections.length === 0;

    return (
        <View style={[styles.container, { backgroundColor: theme.background }]}>
            <View style={[styles.header, { paddingTop: insets.top }]}>
                {navigation.canGoBack() && (
                    <Pressable
                        onPress={() => navigation.goBack()}
                        style={styles.backBtn}
                        hitSlop={12}
                    >
                        <NavArrowLeft
                            width={24}
                            height={24}
                            color={theme.textPrimary}
                        />
                    </Pressable>
                )}
                <Text style={[styles.title, { color: theme.textPrimary }]}>
                    Integrations
                </Text>
                <Pressable
                    onPress={() => setAddOpen(true)}
                    style={[styles.addBtn, { backgroundColor: theme.accent }]}
                >
                    <Text style={styles.addBtnText}>+ Add</Text>
                </Pressable>
            </View>

            <ScrollView
                style={styles.list}
                contentContainerStyle={[
                    styles.listContent,
                    isEmpty && styles.listEmpty,
                ]}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={refresh}
                        tintColor={theme.accent}
                        colors={[theme.accent]}
                    />
                }
            >
                {isEmpty ? (
                    <View style={styles.emptyState}>
                        <Text
                            style={[
                                styles.emptyText,
                                { color: theme.textSecondary },
                            ]}
                        >
                            No integrations
                        </Text>
                        <Text
                            style={[
                                styles.emptySubText,
                                { color: theme.textSecondary },
                            ]}
                        >
                            Tap "+ Add" to connect an integration
                        </Text>
                    </View>
                ) : (
                    sections.map(section => (
                        <View key={section.title}>
                            <Text
                                style={[
                                    styles.sectionHeader,
                                    { color: theme.textSecondary },
                                ]}
                            >
                                {section.title}
                            </Text>
                            {section.items.map(item => {
                                const hasScreen = !!getClientPlugin(
                                    item.provider,
                                )?.MainComponent;
                                return (
                                    <IntegrationItem
                                        key={item.id}
                                        integration={item}
                                        unreadCount={getUnreadCount(
                                            item.provider,
                                        )}
                                        onPress={
                                            hasScreen
                                                ? () => handlePress(item)
                                                : null
                                        }
                                        onLongPress={() =>
                                            handleLongPress(item)
                                        }
                                    />
                                );
                            })}
                        </View>
                    ))
                )}
            </ScrollView>

            {/* Long-press context menu */}
            <ContextMenu
                visible={menuVisible}
                onClose={() => setMenuVisible(false)}
                items={contextMenuItems}
                title={menuTarget?.name}
                position="center"
            />

            {/* Add integration bottom sheet */}
            <Modal
                visible={addOpen}
                animationType="slide"
                transparent
                onRequestClose={() => setAddOpen(false)}
            >
                <View style={styles.modalOverlay}>
                    <Pressable
                        style={styles.modalBackdrop}
                        onPress={() => setAddOpen(false)}
                    />
                    <View
                        style={[
                            styles.modalSheet,
                            { backgroundColor: theme.background },
                        ]}
                    >
                        <View
                            style={[
                                styles.modalHeader,
                                { borderBottomColor: theme.border },
                            ]}
                        >
                            <Text
                                style={[
                                    styles.modalTitle,
                                    { color: theme.textPrimary },
                                ]}
                            >
                                Add Integration
                            </Text>
                            <Pressable
                                onPress={() => setAddOpen(false)}
                                style={styles.closeBtn}
                            >
                                <Xmark
                                    width={22}
                                    height={22}
                                    color={theme.fadedText}
                                />
                            </Pressable>
                        </View>
                        <View
                            style={[
                                styles.modalBody,
                                { paddingBottom: insets.bottom },
                            ]}
                        >
                            <BrowserTab onSuccess={() => setAddOpen(false)} />
                        </View>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingBottom: 16,
        gap: 4,
    },
    backBtn: {
        marginRight: 4,
    },
    title: {
        flex: 1,
        fontSize: 32,
        fontWeight: '700',
    },
    addBtn: {
        paddingHorizontal: 14,
        paddingVertical: 7,
        borderRadius: 8,
    },
    addBtnText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#fff',
    },
    list: {
        flex: 1,
    },
    listContent: {
        paddingHorizontal: 16,
        paddingBottom: 16,
    },
    listEmpty: {
        flex: 1,
    },
    sectionHeader: {
        fontSize: 13,
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginTop: 16,
        marginBottom: 8,
    },
    pluginItem: {
        paddingVertical: 16,
        paddingHorizontal: 16,
        borderRadius: 12,
        borderWidth: 1,
        marginBottom: 8,
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
    nameBlock: {
        flex: 1,
    },
    pluginName: {
        fontSize: 16,
        fontWeight: '600',
    },
    disabledLabel: {
        fontSize: 12,
        marginTop: 2,
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
    emptySubText: {
        fontSize: 13,
        marginTop: 8,
        textAlign: 'center',
    },
    // Modal
    modalOverlay: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    modalBackdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.5)',
    },
    modalSheet: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        height: '85%',
    },
    modalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    modalTitle: {
        flex: 1,
        fontSize: 18,
        fontWeight: '700',
    },
    closeBtn: {
        padding: 4,
    },
    modalBody: {
        flex: 1,
        paddingHorizontal: 16,
    },
});
