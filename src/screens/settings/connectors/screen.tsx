import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    Switch,
    Text,
    TextInput,
    View,
} from 'react-native';
import { styles } from './styles.tsx';
import React from 'react';
import { Props, CONNECTORS } from './models.tsx';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { NavArrowRight } from 'iconoir-react-native';
import { useConnectors } from './context.tsx';
import { oneDarkPalette } from '../../../themes/oneDark.ts';
import { pluginsApi } from '../../../apiClient.ts';


export default function ConnectorScreenDialog({ onClose }: Props) {
    const { integrations } = useConnectors();
    const [gmailSyncing, setGmailSyncing] = React.useState(false);
    const [gmailMessage, setGmailMessage] = React.useState<string | null>(null);
    const [imapSyncing, setImapSyncing] = React.useState(false);
    const [imapMessage, setImapMessage] = React.useState<string | null>(null);
    const [imapConfig, setImapConfig] = React.useState({ host: '', username: '', password: '' });
    const gmailIntegration = React.useMemo(
        () => integrations.find(p => p.provider === 'gmail'),
        [integrations],
    );

    const handleGmailSync = async () => {
        setGmailMessage(null);
        if (!gmailIntegration) {
            setGmailMessage('Gmail plugin is not available');
            return;
        }
        if (!gmailIntegration.connected) {
            setGmailMessage('Enable Gmail plugin first');
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

    const handleImapSync = async () => {
        setImapMessage(null);
        if (!imapConfig.host || !imapConfig.username || !imapConfig.password) {
            setImapMessage('Please provide host, username, and password');
            return;
        }
        setImapSyncing(true);
        try {
            const response = await pluginsApi.syncImap(imapConfig);
            setImapMessage(response?.status ? `Status: ${response.status}` : 'Sync triggered');
        } catch (error) {
            setImapMessage(error instanceof Error ? error.message : 'Failed to sync IMAP');
        } finally {
            setImapSyncing(false);
        }
    };

    // Получаем enabled tools и disabled tools отдельно
    const enabledTools = integrations.filter(t => t.connected);
    const disabledTools = integrations.filter(t => !t.connected);

    const getConnectorDetails = (provider: string) => {
        return CONNECTORS.find(c =>
            c.id.toLowerCase() === provider.toLowerCase()
            || c.toolKey.toLowerCase() === provider.toLowerCase()
            || c.oauthProvider.toLowerCase() === provider.toLowerCase()
        );
    };

    const hasImapPlugin = integrations.some(p => p.provider === 'imap');

    return (
        <View style={styles.overlay} pointerEvents="box-none">
            <Pressable style={styles.backdrop} onPress={onClose} />
            <View style={styles.sheet}>
                <Text style={styles.dialogTitle}>Apps & connectors</Text>
                <ScrollView
                    contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator={false}
                >
                    {enabledTools.length > 0 && (
                        <>
                            <Text style={styles.sectionTitle}>Включено</Text>
                            <View style={styles.card}>
                                {enabledTools.map((integration, i) => {
                                    const details = getConnectorDetails(integration.provider);
                                    return (
                                        <View key={integration.id}>
                                            <Item
                                                name={integration.name}
                                                enabled={true}
                                                glyph={details?.glyph || 'application'}
                                                color={details?.color || oneDarkPalette.blue}
                                                configID={integration.id}
                                                statusText={integration.state?.email || integration.state?.account_email}
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
                                                color={details?.color || oneDarkPalette.blue}
                                                configID={integration.id}
                                                statusText={integration.state?.email || integration.state?.account_email}
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

                    {gmailIntegration && (
                        <>
                            <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Inbox plugins</Text>
                            <View style={styles.card}>
                                <View style={styles.syncRow}>
                                    <View style={styles.syncTextBlock}>
                                        <Text style={styles.rowTitle}>Gmail</Text>
                                        <Text style={styles.statusText}>Trigger a Gmail inbox sync</Text>
                                    </View>
                                    <Pressable
                                        style={[styles.syncButton, gmailSyncing && styles.syncButtonDisabled]}
                                        onPress={handleGmailSync}
                                        disabled={gmailSyncing}
                                    >
                                        {gmailSyncing ? (
                                            <ActivityIndicator size="small" color={oneDarkPalette.black} />
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

                    {hasImapPlugin && (
                        <View style={[styles.card, { marginTop: 12 }]}>
                            <View style={styles.syncTextBlock}>
                                <Text style={styles.rowTitle}>Generic IMAP</Text>
                                <Text style={styles.statusText}>Provide credentials to sync via IMAP</Text>
                            </View>
                            <View style={styles.inputGroup}>
                                <Text style={styles.inputLabel}>Host</Text>
                                <TextInput
                                    placeholder="imap.example.com"
                                    placeholderTextColor="rgba(171, 178, 191, 0.5)"
                                    style={styles.syncInput}
                                    value={imapConfig.host}
                                    onChangeText={text => setImapConfig(prev => ({ ...prev, host: text }))}
                                    autoCapitalize="none"
                                />
                            </View>
                            <View style={styles.inputGroup}>
                                <Text style={styles.inputLabel}>Username</Text>
                                <TextInput
                                    placeholder="user@example.com"
                                    placeholderTextColor="rgba(171, 178, 191, 0.5)"
                                    style={styles.syncInput}
                                    value={imapConfig.username}
                                    onChangeText={text => setImapConfig(prev => ({ ...prev, username: text }))}
                                    autoCapitalize="none"
                                />
                            </View>
                            <View style={styles.inputGroup}>
                                <Text style={styles.inputLabel}>Password</Text>
                                <TextInput
                                    placeholder="••••••••"
                                    placeholderTextColor="rgba(171, 178, 191, 0.5)"
                                    style={styles.syncInput}
                                    value={imapConfig.password}
                                    onChangeText={text => setImapConfig(prev => ({ ...prev, password: text }))}
                                    secureTextEntry
                                />
                            </View>
                            <Pressable
                                style={[styles.syncButton, imapSyncing && styles.syncButtonDisabled]}
                                onPress={handleImapSync}
                                disabled={imapSyncing}
                            >
                                {imapSyncing ? (
                                    <ActivityIndicator size="small" color={oneDarkPalette.black} />
                                ) : (
                                    <Text style={styles.syncButtonText}>Sync IMAP</Text>
                                )}
                            </Pressable>
                            {imapMessage && (
                                <Text style={styles.syncStatus}>{imapMessage}</Text>
                            )}
                        </View>
                    )}

                    {enabledTools.length === 0 && disabledTools.length === 0 && (
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


const Item = ({ name, enabled, color, glyph, configID, statusText }: {
    name: string;
    enabled: boolean;
    glyph: string;
    color: string;
    configID: string;
    statusText?: string | null;
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
                            true: '#61afef',
                            false: 'rgba(171, 178, 191, 0.3)',
                        }}
                        thumbColor="#fff"
                    />
                )}
            </View>
            <NavArrowRight
                width={22}
                height={22}
                color={'rgba(171, 178, 191, 0.8)'}
            />
        </View>
    );
};
