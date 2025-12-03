import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    Switch,
    Text,
    View,
} from 'react-native';
import { styles } from './styles.tsx';
import React from 'react';
import { Props, CONNECTORS } from './models.tsx';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { NavArrowRight } from 'iconoir-react-native';
import { useConnectors } from './context.tsx';
import { tokyoNightPalette } from '../../../themes/tokyoNight.ts';
import { pluginsApi } from '../../../apiClient.ts';


export default function ConnectorScreenDialog({ onClose }: Props) {
    const { integrations, startOAuth, deleteIntegration } = useConnectors();
    const [gmailSyncing, setGmailSyncing] = React.useState(false);
    const [gmailMessage, setGmailMessage] = React.useState<string | null>(null);
    const gmailIntegrations = React.useMemo(
        () => integrations.filter(p => p.provider === 'gmail'),
        [integrations],
    );
    const otherIntegrations = React.useMemo(
        () => integrations.filter(p => p.provider !== 'gmail' && p.provider !== 'imap'),
        [integrations],
    );
    const hasConnectedGmail = gmailIntegrations.some(p => p.connected);

    const handleGmailSync = async () => {
        setGmailMessage(null);
        if (gmailIntegrations.length === 0) {
            setGmailMessage('Gmail plugin is not available');
            return;
        }
        if (!hasConnectedGmail) {
            setGmailMessage('Connect Gmail first');
            return;
        }
        setGmailSyncing(true);
        try {
            const response = await pluginsApi.syncGmail();
            setGmailMessage(response?.message ? `Status: ${response.message}` : 'Sync triggered');
        } catch (error) {
            setGmailMessage(error instanceof Error ? error.message : 'Failed to sync Gmail');
        } finally {
            setGmailSyncing(false);
        }
    };

    // Получаем enabled tools и disabled tools отдельно
    const enabledTools = otherIntegrations.filter(t => t.connected);
    const disabledTools = otherIntegrations.filter(t => !t.connected);

    const getConnectorDetails = (provider: string) => {
        return CONNECTORS.find(c =>
            c.id.toLowerCase() === provider.toLowerCase()
            || c.toolKey.toLowerCase() === provider.toLowerCase()
            || c.oauthProvider.toLowerCase() === provider.toLowerCase()
        );
    };

    const getIntegrationStatus = (integration: (typeof integrations)[number]) => {
        return integration.state?.email
            || integration.state?.account_email
            || (integration.state as any)?.params?.account_email
            || integration.params?.account_email
            || (integration.info as any)?.account_email
            || null;
    };

    const handleAddGmailAccount = async () => {
        setGmailMessage(null);
        try {
            await startOAuth('gmail');
        } catch (err) {
            console.warn('Failed to start Gmail OAuth', err);
            setGmailMessage(err instanceof Error ? err.message : 'Failed to start Gmail OAuth');
        }
    };

    return (
        <View style={styles.overlay} pointerEvents="box-none">
            <Pressable style={styles.backdrop} onPress={onClose} />
            <View style={styles.sheet}>
                <Text style={styles.dialogTitle}>Apps & connectors</Text>
                <ScrollView
                    contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator={false}
                >
                    <View style={styles.sectionHeaderRow}>
                        <Text style={styles.sectionTitle}>Gmail accounts</Text>
                        <Pressable
                            style={styles.addAccountButton}
                            onPress={handleAddGmailAccount}
                            accessibilityLabel="Add Gmail account"
                        >
                            <Text style={styles.addAccountButtonText}>Add account</Text>
                        </Pressable>
                    </View>
                    <View style={styles.card}>
                        {gmailIntegrations.map((integration, i) => {
                            const details = getConnectorDetails(integration.provider);
                            return (
                                <View key={integration.id}>
                                    <Item
                                        name={integration.name}
                                        enabled={!!integration.connected}
                                        glyph={details?.glyph || 'application'}
                                        color={details?.color || tokyoNightPalette.blue}
                                        configID={integration.id}
                                        statusText={getIntegrationStatus(integration)}
                                        onDelete={() => deleteIntegration(integration.id)}
                                    />
                                    {i < gmailIntegrations.length - 1 && (
                                        <View style={styles.divider} />
                                    )}
                                </View>
                            );
                        })}
                        {gmailIntegrations.length === 0 && (
                            <View style={styles.emptyRow}>
                                <Text style={styles.emptyText}>
                                    No Gmail accounts connected yet
                                </Text>
                            </View>
                        )}
                    </View>

                    {enabledTools.length > 0 && (
                        <>
                            <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Enabled</Text>
                            <View style={styles.card}>
                                {enabledTools.map((integration, i) => {
                                    const details = getConnectorDetails(integration.provider);
                                    return (
                                        <View key={integration.id}>
                                            <Item
                                                name={integration.name}
                                                enabled={true}
                                                glyph={details?.glyph || 'application'}
                                                color={details?.color || tokyoNightPalette.blue}
                                                configID={integration.id}
                                                statusText={getIntegrationStatus(integration)}
                                            />
                                            {i < enabledTools.length - 1 && (
                                                <View style={styles.divider} />
                                            )}
                                        </View>
                                    );
                                })}
                            </View>
                        </>
                    )}

                    {disabledTools.length > 0 && (
                        <>
                            <Text style={[styles.sectionTitle, { marginTop: (enabledTools.length > 0 || disabledTools.length > 0) ? 16 : 0 }]}>
                                Доступные интеграции
                            </Text>
                            <View style={styles.card}>
                                {disabledTools.map((integration, i) => {
                                    const details = getConnectorDetails(integration.provider);
                                    return (
                                        <View key={integration.id}>
                                            <Item
                                                name={integration.name}
                                                enabled={false}
                                                glyph={details?.glyph || 'application'}
                                                color={details?.color || tokyoNightPalette.blue}
                                                configID={integration.id}
                                                statusText={getIntegrationStatus(integration)}
                                            />
                                            {i < disabledTools.length - 1 && (
                                                <View style={styles.divider} />
                                            )}
                                        </View>
                                    );
                                })}
                            </View>
                        </>
                    )}

                    {gmailIntegrations.length > 0 && (
                        <>
                            <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Inbox plugins</Text>
                            <View style={styles.card}>
                                <View style={styles.syncRow}>
                                    <View style={styles.syncTextBlock}>
                                        <Text style={styles.rowTitle}>Gmail</Text>
                                        <Text style={styles.statusText}>Sync all connected Gmail inboxes</Text>
                                    </View>
                                    <Pressable
                                        style={[styles.syncButton, gmailSyncing && styles.syncButtonDisabled]}
                                        onPress={handleGmailSync}
                                        disabled={gmailSyncing}
                                    >
                                        {gmailSyncing ? (
                                            <ActivityIndicator size="small" color={tokyoNightPalette.black} />
                                        ) : (
                                            <Text style={styles.syncButtonText}>Sync now</Text>
                                        )}
                                    </Pressable>
                                </View>
                                {gmailMessage && (
                                    <Text style={styles.syncStatus}>{gmailMessage}</Text>
                                )}
                            </View>
                        </>
                    )}

                    {enabledTools.length === 0 && disabledTools.length === 0 && gmailIntegrations.length === 0 && (
                        <View style={styles.emptyRow}>
                            <Text style={styles.emptyText}>
                                Нет доступных интеграций
                            </Text>
                        </View>
                    )}
                </ScrollView>
            </View>
        </View>
    );
}


const Item = ({ name, enabled, color, glyph, configID, statusText, onDelete }: {
    name: string;
    enabled: boolean;
    glyph: string;
    color: string;
    configID: string;
    statusText?: string | null;
    onDelete?: () => void;
}) => {
    const { toggleTool } = useConnectors();
    const [isLoading, setIsLoading] = React.useState(false);

    const handleToggle = async (newValue: boolean) => {
        if (isLoading) return;

        setIsLoading(true);
        try {
            await toggleTool(configID, newValue);
        } catch (error) {
            console.error('Failed to toggle tool', error);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <View style={styles.row}>
            <View style={[styles.iconBubble, { backgroundColor: color }]}>
                <Icon name={glyph} size={20} color="#fff" />
            </View>
            <View style={styles.titleBlock}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                    {name}
                </Text>
                {!!statusText && (
                    <Text style={styles.statusText} numberOfLines={1}>
                        {statusText}
                    </Text>
                )}
            </View>
            <View style={styles.switchWrap}>
                {isLoading ? (
                    <ActivityIndicator size="small" color="#fff" />
                ) : (
                    <Switch
                        value={enabled}
                        onValueChange={handleToggle}
                        trackColor={{
                            true: tokyoNightPalette.blue,
                            false: 'rgba(192, 202, 245, 0.3)',
                        }}
                        thumbColor="#fff"
                    />
                )}
            </View>
            {onDelete ? (
                <Pressable
                    onPress={onDelete}
                    style={({ pressed }) => ({ padding: 6, opacity: pressed ? 0.7 : 1 })}
                >
                    <Icon name="trash-can-outline" size={20} color="rgba(192, 202, 245, 0.8)" />
                </Pressable>
            ) : (
                <NavArrowRight
                    width={22}
                    height={22}
                    color={'rgba(192, 202, 245, 0.8)'}
                />
            )}
        </View>
    );
};
