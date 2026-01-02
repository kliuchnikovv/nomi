import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    Switch,
    Text,
    View,
} from 'react-native';
import React, { useMemo } from 'react';
import { NavArrowRight, Mail, Calendar, WarningCircle, Trash, Github, Sparks } from 'iconoir-react-native';
import { useConnectors } from '../context';
import { useTheme } from '../../../../context/ThemeContext';
import { getStyles } from '../styles';
import { CONNECTORS } from '../models';

export function ConnectedTab() {
    const { integrations, deleteIntegration } = useConnectors();
    const { theme, palette } = useTheme();
    const styles = useMemo(() => getStyles(theme, palette), [theme, palette]);

    const gmailIntegrations = useMemo(
        () => integrations.filter(p => p.provider === 'gmail'),
        [integrations],
    );
    const calendarIntegrations = useMemo(
        () => integrations.filter(p => p.provider === 'calendar'),
        [integrations],
    );
    const githubIntegrations = useMemo(
        () => integrations.filter(p => p.provider === 'github'),
        [integrations],
    );
    const julesIntegrations = useMemo(
        () => integrations.filter(p => p.provider === 'jules'),
        [integrations],
    );
    const otherIntegrations = useMemo(
        () => integrations.filter(p =>
            p.provider !== 'gmail' &&
            p.provider !== 'imap' &&
            p.provider !== 'calendar' &&
            p.provider !== 'github' &&
            p.provider !== 'jules'
        ),
        [integrations],
    );
    const enabledTools = otherIntegrations.filter(t => t.connected);

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

    const renderSection = (title: string, items: typeof integrations, providerKey?: string) => {
        if (items.length === 0) return null;

        return (
            <View>
                <Text style={styles.sectionTitle}>{title}</Text>
                <View style={styles.card}>
                    {items.map((integration, i) => {
                        const details = getConnectorDetails(integration.provider);
                        // Fallback glyph/color if details not found
                        let glyph = details?.glyph;
                        let colorKey = details?.colorKey;

                        if (!glyph) {
                            if (providerKey === 'gmail') glyph = 'gmail';
                            else if (providerKey === 'calendar') glyph = 'calendar';
                            else if (providerKey === 'github') glyph = 'github';
                            else if (providerKey === 'jules') glyph = 'jules';
                            else glyph = 'application';
                        }

                        const color = colorKey ? palette[colorKey] : palette.blue;

                        return (
                            <View key={integration.id}>
                                <Item
                                    name={integration.name}
                                    enabled={!!integration.connected}
                                    glyph={glyph || 'application'}
                                    color={color}
                                    configID={integration.id}
                                    statusText={getIntegrationStatus(integration)}
                                    onDelete={() => deleteIntegration(integration.id)}
                                />
                                {i < items.length - 1 && (
                                    <View style={styles.divider} />
                                )}
                            </View>
                        );
                    })}
                </View>
            </View>
        );
    };

    const isEmpty = gmailIntegrations.length === 0 &&
        calendarIntegrations.length === 0 &&
        githubIntegrations.length === 0 &&
        julesIntegrations.length === 0 &&
        enabledTools.length === 0;

    return (
        <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
        >
            {renderSection('Gmail accounts', gmailIntegrations, 'gmail')}
            {renderSection('Google Calendar', calendarIntegrations, 'calendar')}
            {renderSection('GitHub', githubIntegrations, 'github')}
            {renderSection('Jules', julesIntegrations, 'jules')}
            {renderSection('Enabled Tools', enabledTools)}

            {isEmpty && (
                <View style={styles.emptyRow}>
                    <Text style={styles.emptyText}>
                        No connected integrations yet.
                    </Text>
                </View>
            )}
        </ScrollView>
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
