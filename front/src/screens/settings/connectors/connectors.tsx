import React, { useState } from 'react';
import {
    Pressable,
    ScrollView,
    Switch,
    Text,
    View,
    ActivityIndicator,
} from 'react-native';
import { NavArrowRight } from 'iconoir-react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { styles } from './styles.tsx';
import { Props, CONNECTORS, Connector, Tool, Integration } from './models.tsx';
import { useConnectors } from './context.tsx';
import { tokyoNight, tokyoNightTheme } from '../../../themes/tokyoNight';

const palette = tokyoNightTheme.palette;

export default function ConnectorsDialog({ visible, onClose }: Props) {
    const { tools, integrations, toggleTool } = useConnectors();
    const [loadingId, setLoadingId] = useState<string | null>(null);

    const handleToggle = async (integrationId: string, enabled: boolean) => {
        setLoadingId(integrationId);
        try {
            await toggleTool(integrationId, enabled);
        } finally {
            setLoadingId(null);
        }
    };

    const Item = ({ c }: { c: Connector }) => {
        // Find integration config for this connector
        // We match by provider name (normalized)
        const integration = integrations.find(i => i.provider.toLowerCase() === c.oauthProvider.toLowerCase());

        // If no integration found, it means backend doesn't support it or hasn't returned it yet.
        // But we can still show it if we want to allow connecting.
        // However, toggleTool needs an ID.
        // If integration exists, we use its ID.
        // If not, we can't really toggle it unless we have a way to "initiate" it without ID.
        // But the API requires ID for toggleTool (which calls connectIntegration with provider).
        // Wait, toggleTool takes configID.
        // If we don't have an integration record, we can't pass an ID.
        // But `connectIntegration` takes `provider`.
        // Maybe we should update `toggleTool` to take `provider` instead of `id`?
        // Or `toggleTool` should handle the case where we only have provider.
        // Let's look at `context.tsx` again.
        // `toggleTool` finds config by ID.

        // If the integration is not in the list, we probably can't connect it yet via toggleTool as is.
        // But `integrations` list comes from `GET /integrations`. 
        // Does `GET /integrations` return ALL supported integrations or only connected ones?
        // The prompt says: "Returns a list of supported integrations and their connection status for the current user."
        // So it should return all supported integrations.

        if (!integration) return null;

        const isConnected = integration.connected;
        const isLoading = loadingId === integration.id;

        return (
            <View style={styles.row}>
                <View style={[styles.iconBubble, { backgroundColor: c.color }]}>
                    <Icon name={c.glyph} size={20} color={palette.bg} />
                </View>
                <View style={styles.titleBlock}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                        {c.name}
                    </Text>
                    {isConnected && (
                        <Text style={styles.statusText} numberOfLines={1}>
                            Connected
                        </Text>
                    )}
                </View>
                <View style={styles.switchWrap}>
                    {isLoading ? (
                        <ActivityIndicator size="small" color={palette.bg} />
                    ) : (
                        <Switch
                            value={isConnected}
                            onValueChange={value => handleToggle(integration.id, value)}
                            trackColor={{
                                true: palette.blue,
                                false: 'rgba(192, 202, 245, 0.3)',
                            }}
                            thumbColor={palette.bg}
                        />
                    )}
                </View>
            </View>
        );
    };

    if (!visible) return null;

    const connectedConnectors = CONNECTORS.filter(c => {
        const integration = integrations.find(i => i.provider.toLowerCase() === c.oauthProvider.toLowerCase());
        return integration?.connected;
    });

    const availableConnectors = CONNECTORS.filter(c => {
        const integration = integrations.find(i => i.provider.toLowerCase() === c.oauthProvider.toLowerCase());
        return !integration?.connected;
    });

    return (
        <View style={styles.overlay} pointerEvents="box-none">
            <Pressable style={styles.backdrop} onPress={onClose} />
            <View style={styles.sheet}>
                <Text style={styles.dialogTitle}>Apps & connectors</Text>
                <ScrollView
                    contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator={false}
                >
                    <Text style={styles.sectionTitle}>Connected</Text>
                    <View style={styles.card}>
                        {connectedConnectors.map((c, i) => (
                            <View key={c.id}>
                                <Item c={c} />
                                {i < connectedConnectors.length - 1 && (
                                    <View style={styles.divider} />
                                )}
                            </View>
                        ))}
                        {connectedConnectors.length === 0 && (
                            <View style={styles.emptyRow}>
                                <Text style={styles.emptyText}>
                                    No connected integrations
                                </Text>
                            </View>
                        )}
                    </View>

                    <Text style={[styles.sectionTitle, { marginTop: 16 }]}>
                        Available connectors
                    </Text>
                    <View style={styles.card}>
                        {availableConnectors.map((c, i) => (
                            <View key={c.id}>
                                <Item c={c} />
                                {i < availableConnectors.length - 1 && (
                                    <View style={styles.divider} />
                                )}
                            </View>
                        ))}
                    </View>
                </ScrollView>
            </View>
        </View>
    );
}
