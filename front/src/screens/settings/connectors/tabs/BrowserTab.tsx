import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    Text,
    TextInput,
    View,
    StyleSheet,
    Modal,
    Platform,
} from 'react-native';
import React, { useMemo, useState } from 'react';
import { PluginIcon } from '../../../../components/PluginIcon';
import { useConnectors } from '../context';
import { useTheme } from '../../../../context/ThemeContext';
import { getStyles } from '../styles';
import { CONNECTORS, Connector } from '../models';
import { getIntegrationMetadata } from '../../../../services/integrations/registry';
import { IOSRemindersClient } from '../../../../services/integrations/clients/IOSRemindersClient';
import { IOSHealthClient } from '../../../../services/integrations/clients/IOSHealthClient';

export function BrowserTab() {
    const { integrations, startOAuth, toggleTool, getIntegrations, connectTelegram } = useConnectors();
    const { theme, palette } = useTheme();
    const sharedStyles = useMemo(() => getStyles(theme, palette), [theme, palette]);

    // Local styles for Grid
    const styles = useMemo(() => StyleSheet.create({
        grid: {
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 16,
            paddingVertical: 8,
            paddingHorizontal: 4,
        },
        card: {
            backgroundColor: theme.surfaceHighlight,
            borderRadius: 16,
            padding: 16,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: theme.border,
            width: '47%',
            height: 140,
        },
        cardPressed: {
            opacity: 0.8,
            backgroundColor: theme.surfaceAlt,
        },
        iconBubble: {
            width: 56,
            height: 56,
            borderRadius: 28,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 12,
        },
        title: {
            color: theme.text,
            fontWeight: '600',
            fontSize: 16,
            textAlign: 'center',
        },
        description: {
            color: theme.fadedText,
            fontSize: 12,
            textAlign: 'center',
            marginTop: 4,
        },
    }), [theme, palette]);

    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [telegramModalVisible, setTelegramModalVisible] = useState(false);
    const [telegramCode, setTelegramCode] = useState('');
    const [telegramLoading, setTelegramLoading] = useState(false);
    const [telegramError, setTelegramError] = useState<string | null>(null);

    // Handle connector press — Telegram gets a code input, others start OAuth, client-only just enable
    const handleConnectorPress = async (connector: Connector) => {
        setErrorMsg(null);
        const metadata = getIntegrationMetadata(connector.id);
        
        // Client-only integrations (no auth) - request permissions if needed
        if (metadata?.authType === 'none') {
            try {
                // Special handling for ios_reminders: request permission before enabling (iOS only)
                if (connector.id === 'ios_reminders' && Platform.OS === 'ios') {
                    const client = new IOSRemindersClient();

                    // Check current permission status
                    const status = await client.checkPermissionStatus();

                    if (status === 'notDetermined') {
                        // Request permission - this shows the iOS system prompt
                        const granted = await client.requestPermission();

                        if (!granted) {
                            setErrorMsg('Reminders access was denied. Please enable it in Settings.');
                            return;
                        }
                    } else if (status === 'denied') {
                        setErrorMsg('Reminders access is denied. Please enable it in Settings → Privacy → Reminders.');
                        return;
                    }
                    // If 'authorized', continue to enable the integration
                }

                // Special handling for ios_health: request permission before enabling (iOS only)
                if (connector.id === 'ios_health' && Platform.OS === 'ios') {
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/b9378a78-49c7-400b-ab56-9b516cc8a8fb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'front/src/screens/settings/connectors/tabs/BrowserTab.tsx:111',message:'Attempting to enable ios_health',data:{connectorId:connector.id,platformOS:Platform.OS},timestamp:Date.now()})}).catch(()=>{});
                    // #endregion
                    const healthClient = new IOSHealthClient();

                    // Check current permission status
                    const status = await healthClient.checkPermissionStatus();

                    if (!status.available) {
                        setErrorMsg('HealthKit is not available on this device.');
                        return;
                    }

                    // Request permissions for all categories
                    const allCategories: Array<'activity' | 'heart' | 'sleep' | 'body' | 'nutrition' | 'workouts'> = [
                        'activity',
                        'heart',
                        'sleep',
                        'body',
                        'nutrition',
                        'workouts'
                    ];

                    try {
                        const result = await healthClient.requestPermission(allCategories);

                        if (!result.granted) {
                            setErrorMsg('Health data access was denied. Please enable it in Settings.');
                            return;
                        }

                        // If granted, continue to enable the integration
                    } catch (err) {
                        console.error('[BrowserTab] Failed to request health permissions', err);
                        setErrorMsg('Failed to request health permissions. Please try again.');
                        return;
                    }
                }

                await toggleTool(connector.id, true);
            } catch (err) {
                console.warn(`Failed to enable ${connector.id}`, err);
                setErrorMsg(err instanceof Error ? err.message : `Failed to enable ${connector.name}`);
            }
            return;
        }
        
        if (metadata?.authType === 'api_key' && connector.id === 'telegram') {
            // Show Telegram code input modal
            setTelegramCode('');
            setTelegramError(null);
            setTelegramModalVisible(true);
            return;
        }
        // Default: OAuth flow
        try {
            await startOAuth(connector.oauthProvider);
        } catch (err) {
            console.warn(`Failed to start ${connector.oauthProvider} OAuth`, err);
            setErrorMsg(err instanceof Error ? err.message : `Failed to start ${connector.oauthProvider} OAuth`);
        }
    };

    const handleTelegramSubmit = async () => {
        if (telegramCode.length !== 6) {
            setTelegramError('Enter a 6-digit code');
            return;
        }
        setTelegramLoading(true);
        setTelegramError(null);
        try {
            await connectTelegram(telegramCode);
            setTelegramModalVisible(false);
            setTelegramCode('');
        } catch (e) {
            setTelegramError(e instanceof Error ? e.message : 'Failed to link Telegram');
        } finally {
            setTelegramLoading(false);
        }
    };

    // Disabled Tools
    const otherIntegrations = useMemo(
        () => integrations.filter(p =>
            p.provider !== 'gmail' &&
            p.provider !== 'imap' &&
            p.provider !== 'calendar' &&
            p.provider !== 'github' &&
            p.provider !== 'telegram' &&
            p.provider !== 'ios_calendar' &&
            p.provider !== 'ios_reminders' &&
            p.provider !== 'ios_contacts'
        ),
        [integrations],
    );
    const disabledTools = otherIntegrations.filter(t => !t.connected);

    const handleEnableTool = async (id: string) => {
        try {
            await toggleTool(id, true);
        } catch (e) {
            console.warn('Failed to enable tool', e);
        }
    };

    const getConnectorDetails = (provider: string) => {
        return CONNECTORS.find(c =>
            c.id.toLowerCase() === provider.toLowerCase()
            || c.toolKey.toLowerCase() === provider.toLowerCase()
            || c.oauthProvider.toLowerCase() === provider.toLowerCase()
        );
    };

    return (
        <ScrollView
            contentContainerStyle={sharedStyles.scrollContent}
            showsVerticalScrollIndicator={false}
        >
            <Text style={[sharedStyles.sectionTitle, { marginBottom: 16 }]}>Add New Integration</Text>

            <View style={styles.grid}>
                {CONNECTORS.map((connector) => (
                    <ConnectorCard
                        key={connector.id}
                        connector={connector}
                        onPress={() => handleConnectorPress(connector)}
                        styles={styles}
                        palette={palette}
                    />
                ))}
            </View>

            {disabledTools.length > 0 && (
                <>
                    <Text style={[sharedStyles.sectionTitle, { marginTop: 24, marginBottom: 16 }]}>Available Tools</Text>
                    <View style={styles.grid}>
                        {disabledTools.map((tool) => {
                            const details = getConnectorDetails(tool.provider);
                            // Synthesize a connector object
                            const connector: Connector = {
                                id: tool.id,
                                name: tool.name,
                                toolKey: tool.provider,
                                oauthProvider: tool.provider,
                                colorKey: details?.colorKey || 'blue',
                                glyph: details?.glyph || 'application',
                            };
                            return (
                                <ConnectorCard
                                    key={tool.id}
                                    connector={connector}
                                    onPress={() => handleEnableTool(tool.id)}
                                    styles={styles}
                                    palette={palette}
                                />
                            );
                        })}
                    </View>
                </>
            )}

            {errorMsg && (
                <Text style={[sharedStyles.syncStatus, { marginTop: 20, color: palette.red }]}>{errorMsg}</Text>
            )}

            {/* Telegram Code Input Modal */}
            <Modal
                visible={telegramModalVisible}
                transparent
                animationType="fade"
                onRequestClose={() => setTelegramModalVisible(false)}
            >
                <View style={modalStyles.overlay}>
                    <View style={[modalStyles.container, { backgroundColor: theme.surface }]}>
                        <Text style={[modalStyles.title, { color: theme.text }]}>Connect Telegram</Text>
                        <Text style={[modalStyles.subtitle, { color: theme.fadedText }]}>
                            Send <Text style={{ fontWeight: '700' }}>/start</Text> to <Text style={{ fontWeight: '700' }}>@genie_bot</Text> in Telegram, then enter the 6-digit code here.
                        </Text>

                        <TextInput
                            style={[modalStyles.input, {
                                color: theme.text,
                                backgroundColor: theme.surfaceHighlight,
                                borderColor: telegramError ? palette.red : theme.border,
                            }]}
                            value={telegramCode}
                            onChangeText={(t) => {
                                setTelegramCode(t.replace(/[^0-9]/g, '').slice(0, 6));
                                setTelegramError(null);
                            }}
                            placeholder="000000"
                            placeholderTextColor={theme.fadedText}
                            keyboardType="number-pad"
                            maxLength={6}
                            autoFocus
                            textAlign="center"
                        />

                        {telegramError && (
                            <Text style={[modalStyles.error, { color: palette.red }]}>{telegramError}</Text>
                        )}

                        <View style={modalStyles.buttons}>
                            <Pressable
                                style={[modalStyles.button, { backgroundColor: theme.surfaceHighlight }]}
                                onPress={() => setTelegramModalVisible(false)}
                                disabled={telegramLoading}
                            >
                                <Text style={[modalStyles.buttonText, { color: theme.text }]}>Cancel</Text>
                            </Pressable>
                            <Pressable
                                style={[modalStyles.button, {
                                    backgroundColor: '#0088cc',
                                    opacity: telegramCode.length !== 6 || telegramLoading ? 0.5 : 1,
                                }]}
                                onPress={handleTelegramSubmit}
                                disabled={telegramCode.length !== 6 || telegramLoading}
                            >
                                {telegramLoading ? (
                                    <ActivityIndicator color="#fff" size="small" />
                                ) : (
                                    <Text style={[modalStyles.buttonText, { color: '#fff' }]}>Connect</Text>
                                )}
                            </Pressable>
                        </View>
                    </View>
                </View>
            </Modal>
        </ScrollView>
    );
}

const ConnectorCard = ({ connector, onPress, styles, palette }: {
    connector: Connector;
    onPress: () => void;
    styles: any;
    palette: any;
}) => (
    <Pressable
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        onPress={onPress}
    >
        <View style={[styles.iconBubble, { backgroundColor: palette[connector.colorKey] || palette.blue }]}>
            <PluginIcon provider={connector.id} size={32} color="#fff" />
        </View>
        <Text style={styles.title}>{connector.name}</Text>
    </Pressable>
);

const modalStyles = StyleSheet.create({
    overlay: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.5)',
        padding: 32,
    },
    container: {
        width: '100%',
        maxWidth: 360,
        borderRadius: 20,
        padding: 24,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 12,
        elevation: 8,
    },
    title: {
        fontSize: 20,
        fontWeight: '700',
        textAlign: 'center',
        marginBottom: 8,
    },
    subtitle: {
        fontSize: 14,
        textAlign: 'center',
        lineHeight: 20,
        marginBottom: 20,
    },
    input: {
        fontSize: 28,
        fontWeight: '700',
        letterSpacing: 8,
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderRadius: 12,
        borderWidth: 1.5,
        marginBottom: 8,
    },
    error: {
        fontSize: 13,
        textAlign: 'center',
        marginBottom: 8,
    },
    buttons: {
        flexDirection: 'row',
        gap: 12,
        marginTop: 12,
    },
    button: {
        flex: 1,
        paddingVertical: 14,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    buttonText: {
        fontSize: 16,
        fontWeight: '600',
    },
});
