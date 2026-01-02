import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    Switch,
    Text,
    View,
    TextInput,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { getStyles } from './styles.tsx';
import React, { useMemo } from 'react';
import { Props, CONNECTORS } from './models.tsx';
import { NavArrowRight, Mail, Calendar, WarningCircle, Trash, Github, Sparks } from 'iconoir-react-native';
import { useConnectors } from './context.tsx';
import { useTheme } from '../../../context/ThemeContext';
import { pluginsApi } from '../../../apiClient.ts';


export default function ConnectorScreenDialog({ onClose }: Props) {
    const { integrations, startOAuth, deleteIntegration, getIntegrations } = useConnectors();
    const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

    const { theme, palette } = useTheme();
    const styles = useMemo(() => getStyles(theme, palette), [theme, palette]);

    const gmailIntegrations = React.useMemo(
        () => integrations.filter(p => p.provider === 'gmail'),
        [integrations],
    );
    const calendarIntegrations = React.useMemo(
        () => integrations.filter(p => p.provider === 'calendar'),
        [integrations],
    );
    const githubIntegrations = React.useMemo(
        () => integrations.filter(p => p.provider === 'github'),
        [integrations],
    );
    const julesIntegrations = React.useMemo(
        () => integrations.filter(p => p.provider === 'jules'),
        [integrations],
    );
    const otherIntegrations = React.useMemo(
        () => integrations.filter(p => p.provider !== 'gmail' && p.provider !== 'imap' && p.provider !== 'calendar' && p.provider !== 'github' && p.provider !== 'jules'),
        [integrations],
    );


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
        setErrorMsg(null);
        try {
            await startOAuth('gmail');
        } catch (err) {
            console.warn('Failed to start Gmail OAuth', err);
            setErrorMsg(err instanceof Error ? err.message : 'Failed to start Gmail OAuth');
        }
    };

    const handleAddCalendarAccount = async () => {
        setErrorMsg(null);
        try {
            await startOAuth('calendar');
        } catch (err) {
            console.warn('Failed to start Google Calendar OAuth', err);
            setErrorMsg(err instanceof Error ? err.message : 'Failed to start Google Calendar OAuth');
        }
    };

    const handleAddGitHubAccount = async () => {
        setErrorMsg(null);
        try {
            await startOAuth('github');
        } catch (err) {
            console.warn('Failed to start GitHub OAuth', err);
            setErrorMsg(err instanceof Error ? err.message : 'Failed to start GitHub OAuth');
        }
    };

    const [showJulesInput, setShowJulesInput] = React.useState(false);
    const [julesApiKey, setJulesApiKey] = React.useState('');
    const [isConnectingJules, setIsConnectingJules] = React.useState(false);

    const handleAddJulesAccount = () => {
        setShowJulesInput(!showJulesInput);
        setErrorMsg(null);
    };

    const submitJulesKey = async () => {
        if (!julesApiKey.trim()) return;
        setIsConnectingJules(true);
        setErrorMsg(null);
        try {
            await pluginsApi.connectJules(julesApiKey);
            // Trigger sync immediately to fetch Jules sessions
            console.log('[Connectors] Triggering Jules sync...');
            const syncResult = await pluginsApi.syncJules();
            console.log('[Connectors] Jules sync result:', syncResult);
            await getIntegrations();
            setShowJulesInput(false);
            setJulesApiKey('');
        } catch (e) {
            setErrorMsg(e instanceof Error ? e.message : 'Failed to connect');
        } finally {
            setIsConnectingJules(false);
        }
    };

    return (
        <View style={styles.overlay} pointerEvents="box-none">
            <Pressable style={styles.backdrop} onPress={onClose} />
            <View style={styles.sheet}>
                <Text style={styles.dialogTitle}>Apps & connectors</Text>
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                >
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
                                            color={details?.colorKey ? palette[details.colorKey] : palette.blue}
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

                        <View style={styles.sectionHeaderRow}>
                            <Text style={styles.sectionTitle}>Google Calendar</Text>
                            <Pressable
                                style={styles.addAccountButton}
                                onPress={handleAddCalendarAccount}
                                accessibilityLabel="Add Google Calendar account"
                            >
                                <Text style={styles.addAccountButtonText}>Add account</Text>
                            </Pressable>
                        </View>
                        <View style={styles.card}>
                            {calendarIntegrations.map((integration, i) => {
                                const details = getConnectorDetails(integration.provider);
                                return (
                                    <View key={integration.id}>
                                        <Item
                                            name={integration.name}
                                            enabled={!!integration.connected}
                                            glyph={details?.glyph || 'calendar'}
                                            color={details?.colorKey ? palette[details.colorKey] : palette.green}
                                            configID={integration.id}
                                            statusText={getIntegrationStatus(integration)}
                                            onDelete={() => deleteIntegration(integration.id)}
                                        />
                                        {i < calendarIntegrations.length - 1 && (
                                            <View style={styles.divider} />
                                        )}
                                    </View>
                                );
                            })}
                            {calendarIntegrations.length === 0 && (
                                <View style={styles.emptyRow}>
                                    <Text style={styles.emptyText}>
                                        No Google Calendar accounts connected yet
                                    </Text>
                                </View>
                            )}
                        </View>

                        <View style={styles.sectionHeaderRow}>
                            <Text style={styles.sectionTitle}>GitHub</Text>
                            <Pressable
                                style={styles.addAccountButton}
                                onPress={handleAddGitHubAccount}
                                accessibilityLabel="Add GitHub account"
                            >
                                <Text style={styles.addAccountButtonText}>Add account</Text>
                            </Pressable>
                        </View>
                        <View style={styles.card}>
                            {githubIntegrations.map((integration, i) => {
                                const details = getConnectorDetails(integration.provider);
                                return (
                                    <View key={integration.id}>
                                        <Item
                                            name={integration.name}
                                            enabled={!!integration.connected}
                                            glyph={details?.glyph || 'github'}
                                            color={details?.colorKey ? palette[details.colorKey] : palette.magenta}
                                            configID={integration.id}
                                            statusText={getIntegrationStatus(integration)}
                                            onDelete={() => deleteIntegration(integration.id)}
                                        />
                                        {i < githubIntegrations.length - 1 && (
                                            <View style={styles.divider} />
                                        )}
                                    </View>
                                );
                            })}
                            {githubIntegrations.length === 0 && (
                                <View style={styles.emptyRow}>
                                    <Text style={styles.emptyText}>
                                        No GitHub accounts connected yet
                                    </Text>
                                </View>
                            )}
                        </View>

                        <View style={styles.sectionHeaderRow}>
                            <Text style={styles.sectionTitle}>Jules</Text>
                            <Pressable
                                style={styles.addAccountButton}
                                onPress={handleAddJulesAccount}
                                accessibilityLabel="Add Jules account"
                            >
                                <Text style={styles.addAccountButtonText}>{showJulesInput ? 'Cancel' : 'Add account'}</Text>
                            </Pressable>
                        </View>

                        {showJulesInput && (
                            <View style={[styles.card, { marginBottom: 16, padding: 12 }]}>
                                <Text style={{ color: palette.fg, marginBottom: 8 }}>Enter API Key:</Text>
                                <TextInput
                                    style={{
                                        backgroundColor: 'rgba(0,0,0,0.2)',
                                        color: palette.fg,
                                        borderRadius: 8,
                                        padding: 10,
                                        marginBottom: 12,
                                    }}
                                    value={julesApiKey}
                                    onChangeText={setJulesApiKey}
                                    placeholder="sk-..."
                                    placeholderTextColor="rgba(255,255,255,0.3)"
                                    autoCapitalize="none"
                                    secureTextEntry
                                />
                                <Pressable
                                    onPress={submitJulesKey}
                                    disabled={isConnectingJules || !julesApiKey.trim()}
                                    style={({ pressed }) => ({
                                        backgroundColor: pressed ? `${palette.blue}80` : palette.blue,
                                        padding: 12,
                                        borderRadius: 8,
                                        alignItems: 'center',
                                        opacity: (!julesApiKey.trim() || isConnectingJules) ? 0.5 : 1,
                                    })}
                                >
                                    {isConnectingJules ? (
                                        <ActivityIndicator color="#fff" />
                                    ) : (
                                        <Text style={{ color: '#fff', fontWeight: 'bold' }}>Connect</Text>
                                    )}
                                </Pressable>
                            </View>
                        )}

                        <View style={styles.card}>
                            {julesIntegrations.map((integration, i) => {
                                const details = getConnectorDetails(integration.provider);
                                return (
                                    <View key={integration.id}>
                                        <Item
                                            name={integration.name}
                                            enabled={!!integration.connected}
                                            glyph={details?.glyph || 'jules'}
                                            color={details?.colorKey ? palette[details.colorKey] : palette.orange}
                                            configID={integration.id}
                                            statusText={getIntegrationStatus(integration)}
                                            onDelete={() => deleteIntegration(integration.id)}
                                        />
                                        {i < julesIntegrations.length - 1 && (
                                            <View style={styles.divider} />
                                        )}
                                    </View>
                                );
                            })}
                            {julesIntegrations.length === 0 && !showJulesInput && (
                                <View style={styles.emptyRow}>
                                    <Text style={styles.emptyText}>
                                        No Jules accounts connected yet
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
                                                    color={details?.colorKey ? palette[details.colorKey] : palette.blue}
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
                                                    color={details?.colorKey ? palette[details.colorKey] : palette.blue}
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


                        {
                            enabledTools.length === 0 && disabledTools.length === 0 && gmailIntegrations.length === 0 && calendarIntegrations.length === 0 && (
                                <View style={styles.emptyRow}>
                                    <Text style={styles.emptyText}>
                                        Нет доступных интеграций
                                    </Text>
                                </View>
                            )
                        }
                        {
                            errorMsg && (
                                <Text style={[styles.syncStatus, { marginTop: 20 }]}>{errorMsg}</Text>
                            )
                        }
                    </ScrollView >
                </KeyboardAvoidingView>
            </View >
        </View >
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

    const { theme, palette } = useTheme();
    const styles = useMemo(() => getStyles(theme, palette), [theme, palette]);

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
                {glyph === 'mail' && <Mail width={20} height={20} color="#fff" strokeWidth={2} />}
                {glyph === 'gmail' && <Mail width={20} height={20} color="#fff" strokeWidth={2} />}
                {glyph === 'calendar' && <Calendar width={20} height={20} color="#fff" strokeWidth={2} />}
                {glyph === 'github' && <Github width={20} height={20} color="#fff" strokeWidth={2} />}
                {glyph === 'jules' && <Sparks width={20} height={20} color="#fff" strokeWidth={2} />}
                {glyph !== 'mail' && glyph !== 'gmail' && glyph !== 'calendar' && glyph !== 'github' && glyph !== 'jules' && <WarningCircle width={20} height={20} color="#fff" strokeWidth={2} />}
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
                            true: palette.blue,
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
                    <Trash width={20} height={20} color="rgba(192, 202, 245, 0.8)" strokeWidth={2} />
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
