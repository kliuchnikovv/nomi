import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    Text,
    TextInput,
    View,
    StyleSheet,
} from 'react-native';
import React, { useMemo, useState } from 'react';
import { Mail, Calendar, Github, Sparks, WarningCircle } from 'iconoir-react-native';
import { useConnectors } from '../context';
import { useTheme } from '../../../../context/ThemeContext';
import { getStyles } from '../styles';
import { CONNECTORS, Connector } from '../models';
import { pluginsApi } from '../../../../apiClient';
import { integrationStorage } from '../../../../services/integrations/IntegrationStorage';

export function BrowserTab() {
    const { integrations, startOAuth, toggleTool, getIntegrations } = useConnectors();
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
        julesInputContainer: {
            marginTop: 16,
            width: '100%',
            backgroundColor: theme.surfaceHighlight,
            padding: 16,
            borderRadius: 16,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: theme.border,
        },
        inputLabel: {
            color: theme.text,
            marginBottom: 8,
            fontWeight: '600',
        },
        input: {
            backgroundColor: 'rgba(0,0,0,0.2)',
            color: theme.text,
            borderRadius: 8,
            padding: 12,
            marginBottom: 12,
        },
        connectBtn: {
            backgroundColor: palette.blue,
            padding: 12,
            borderRadius: 8,
            alignItems: 'center',
        },
        connectBtnText: {
            color: '#fff',
            fontWeight: 'bold',
        }
    }), [theme, palette]);

    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    // OAuth Handlers
    const handleOAuth = async (provider: string) => {
        setErrorMsg(null);
        try {
            await startOAuth(provider);
        } catch (err) {
            console.warn(`Failed to start ${provider} OAuth`, err);
            setErrorMsg(err instanceof Error ? err.message : `Failed to start ${provider} OAuth`);
        }
    };

    // Jules Logic
    const [showJulesInput, setShowJulesInput] = useState(false);
    const [julesApiKey, setJulesApiKey] = useState('');
    const [isConnectingJules, setIsConnectingJules] = useState(false);

    const submitJulesKey = async () => {
        if (!julesApiKey.trim()) return;
        setIsConnectingJules(true);
        setErrorMsg(null);
        try {
            await integrationStorage.createIntegration(
                {
                    provider: 'jules',
                    name: 'Jules',
                    enabled: true,
                    accountEmail: 'API Key',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    id: 'jules', // Use fixed ID for singleton service
                },
                {
                    accessToken: julesApiKey,
                }
            );

            // Optionally try to sync with backend if needed, but it's not critical for client-side tool
            try {
                await pluginsApi.connectJules(julesApiKey);
            } catch (e) {
                console.log('Backend sync for Jules failed (expected if moving to local-only):', e);
            }

            await getIntegrations();
            setShowJulesInput(false);
            setJulesApiKey('');
        } catch (e) {
            setErrorMsg(e instanceof Error ? e.message : 'Failed to connect');
        } finally {
            setIsConnectingJules(false);
        }
    };

    // Disabled Tools
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
                        onPress={() => {
                            if (connector.id === 'jules') {
                                setShowJulesInput(!showJulesInput);
                            } else {
                                handleOAuth(connector.oauthProvider);
                            }
                        }}
                        styles={styles}
                        palette={palette}
                    />
                ))}
            </View>

            {showJulesInput && (
                <View style={styles.julesInputContainer}>
                    <Text style={styles.inputLabel}>Enter Jules API Key:</Text>
                    <TextInput
                        style={styles.input}
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
                            ...styles.connectBtn,
                            opacity: (!julesApiKey.trim() || isConnectingJules) ? 0.5 : (pressed ? 0.8 : 1),
                        })}
                    >
                        {isConnectingJules ? (
                            <ActivityIndicator color="#fff" />
                        ) : (
                            <Text style={styles.connectBtnText}>Connect</Text>
                        )}
                    </Pressable>
                </View>
            )}

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
            {connector.glyph === 'mail' && <Mail width={32} height={32} color="#fff" strokeWidth={2} />}
            {connector.glyph === 'gmail' && <Mail width={32} height={32} color="#fff" strokeWidth={2} />}
            {connector.glyph === 'calendar' && <Calendar width={32} height={32} color="#fff" strokeWidth={2} />}
            {connector.glyph === 'github' && <Github width={32} height={32} color="#fff" strokeWidth={2} />}
            {connector.glyph === 'jules' && <Sparks width={32} height={32} color="#fff" strokeWidth={2} />}
            {connector.glyph !== 'mail' && connector.glyph !== 'gmail' && connector.glyph !== 'calendar' && connector.glyph !== 'github' && connector.glyph !== 'jules' && <WarningCircle width={32} height={32} color="#fff" strokeWidth={2} />}
        </View>
        <Text style={styles.title}>{connector.name}</Text>
    </Pressable>
);
