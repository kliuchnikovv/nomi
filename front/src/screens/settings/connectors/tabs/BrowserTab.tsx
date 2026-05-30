import {
    ActivityIndicator,
    Keyboard,
    KeyboardAvoidingView,
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

const ICLOUD_DOMAINS = ['icloud.com', 'me.com', 'mac.com'];
const isICloudEmail = (email: string) =>
    ICLOUD_DOMAINS.some(d => email.toLowerCase().endsWith(`@${d}`));

const GMAIL_DOMAINS = ['gmail.com', 'googlemail.com'];
const isGmailEmail = (email: string) =>
    GMAIL_DOMAINS.some(d => email.toLowerCase().endsWith(`@${d}`));

const MAILRU_DOMAINS = ['mail.ru', 'bk.ru', 'inbox.ru', 'list.ru'];
const isMailRuEmail = (email: string) =>
    MAILRU_DOMAINS.some(d => email.toLowerCase().endsWith(`@${d}`));

const OUTLOOK_DOMAINS = ['outlook.com', 'hotmail.com', 'live.com', 'msn.com'];
const isOutlookEmail = (email: string) =>
    OUTLOOK_DOMAINS.some(d => email.toLowerCase().endsWith(`@${d}`));

const YAHOO_DOMAINS = [
    'yahoo.com',
    'yahoo.co.uk',
    'yahoo.fr',
    'yahoo.de',
    'ymail.com',
];
const isYahooEmail = (email: string) =>
    YAHOO_DOMAINS.some(d => email.toLowerCase().endsWith(`@${d}`));

const YANDEX_DOMAINS = [
    'yandex.ru',
    'yandex.com',
    'ya.ru',
    'yandex.kz',
    'yandex.by',
];
const isYandexEmail = (email: string) =>
    YANDEX_DOMAINS.some(d => email.toLowerCase().endsWith(`@${d}`));

export function BrowserTab({ onSuccess }: { onSuccess?: () => void } = {}) {
    const { startOAuth, toggleTool, connectTelegram, connectImap } =
        useConnectors();
    const { theme, palette } = useTheme();
    const sharedStyles = useMemo(
        () => getStyles(theme, palette),
        [theme, palette],
    );

    // Local styles for Grid
    const styles = useMemo(
        () =>
            StyleSheet.create({
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
            }),
        [theme, palette],
    );

    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [telegramModalVisible, setTelegramModalVisible] = useState(false);
    const [telegramCode, setTelegramCode] = useState('');
    const [telegramLoading, setTelegramLoading] = useState(false);
    const [telegramError, setTelegramError] = useState<string | null>(null);

    const [imapModalVisible, setImapModalVisible] = useState(false);
    const [imapEmail, setImapEmail] = useState('');
    const [imapPassword, setImapPassword] = useState('');
    const [imapLoading, setImapLoading] = useState(false);
    const [imapError, setImapError] = useState<string | null>(null);

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
                            setErrorMsg(
                                'Reminders access was denied. Please enable it in Settings.',
                            );
                            return;
                        }
                    } else if (status === 'denied') {
                        setErrorMsg(
                            'Reminders access is denied. Please enable it in Settings → Privacy → Reminders.',
                        );
                        return;
                    }
                    // If 'authorized', continue to enable the integration
                }

                // Special handling for ios_health: request permission before enabling (iOS only)
                if (connector.id === 'ios_health' && Platform.OS === 'ios') {
                    const healthClient = new IOSHealthClient();

                    // Check current permission status
                    const status = await healthClient.checkPermissionStatus();

                    if (!status.available) {
                        setErrorMsg(
                            'HealthKit is not available on this device.',
                        );
                        return;
                    }

                    // Request permissions for all categories
                    const allCategories: Array<
                        | 'activity'
                        | 'heart'
                        | 'sleep'
                        | 'body'
                        | 'nutrition'
                        | 'workouts'
                    > = [
                        'activity',
                        'heart',
                        'sleep',
                        'body',
                        'nutrition',
                        'workouts',
                    ];

                    try {
                        const result = await healthClient.requestPermission(
                            allCategories,
                        );

                        if (!result.granted) {
                            setErrorMsg(
                                'Health data access was denied. Please enable it in Settings.',
                            );
                            return;
                        }

                        // If granted, continue to enable the integration
                    } catch (err) {
                        console.error(
                            '[BrowserTab] Failed to request health permissions',
                            err,
                        );
                        setErrorMsg(
                            'Failed to request health permissions. Please try again.',
                        );
                        return;
                    }
                }

                await toggleTool(connector.id, true);
                onSuccess?.();
            } catch (err) {
                console.warn(`Failed to enable ${connector.id}`, err);
                setErrorMsg(
                    err instanceof Error
                        ? err.message
                        : `Failed to enable ${connector.name}`,
                );
            }
            return;
        }

        if (metadata?.authType === 'api_key' && connector.id === 'telegram') {
            setTelegramCode('');
            setTelegramError(null);
            setTelegramModalVisible(true);
            return;
        }

        if (connector.id === 'imap') {
            setImapEmail('');
            setImapPassword('');
            setImapError(null);
            setImapModalVisible(true);
            return;
        }
        // Default: OAuth flow
        try {
            await startOAuth(connector.oauthProvider);
            onSuccess?.();
        } catch (err) {
            console.warn(
                `Failed to start ${connector.oauthProvider} OAuth`,
                err,
            );
            setErrorMsg(
                err instanceof Error
                    ? err.message
                    : `Failed to start ${connector.oauthProvider} OAuth`,
            );
        }
    };

    const handleImapSubmit = async () => {
        if (!imapEmail.includes('@')) {
            setImapError('Enter a valid email address');
            return;
        }
        if (!imapPassword) {
            setImapError('Enter your password');
            return;
        }
        setImapLoading(true);
        setImapError(null);
        try {
            await connectImap(imapEmail.trim(), imapPassword);
            setImapModalVisible(false);
            setImapEmail('');
            setImapPassword('');
            // Stagger outer modal close: iOS cannot handle two simultaneous Modal dismissals.
            // Dismissing both in the same React batch leaves a stuck UIView backdrop that
            // intercepts all touches, making the app appear frozen.
            if (onSuccess) {
                setTimeout(onSuccess, 350);
            }
        } catch (e) {
            const msg =
                (e instanceof Error ? e.message : '') || 'Connection failed';
            const lower = msg.toLowerCase();
            const isAuthError =
                lower.includes('login failed') ||
                lower.includes('authentication') ||
                lower.includes('invalid credentials') ||
                lower.includes('auth') ||
                lower.includes('password');

            if (isICloudEmail(imapEmail) && isAuthError) {
                setImapError(
                    'Login failed. iCloud requires an app-specific password — generate one at appleid.apple.com → Sign-In and Security.',
                );
            } else if (isGmailEmail(imapEmail)) {
                setImapError(
                    'Gmail requires an app password. Enable 2-step verification, then generate one at myaccount.google.com → Security → App passwords.',
                );
            } else if (isMailRuEmail(imapEmail) && isAuthError) {
                setImapError(
                    'Mail.ru requires an app password. Enable it in mail.ru Settings → Security → App passwords.',
                );
            } else if (isOutlookEmail(imapEmail) && isAuthError) {
                setImapError(
                    'Outlook/Hotmail requires an app password. Generate one at account.microsoft.com → Security → Advanced security options → App passwords.',
                );
            } else if (isYahooEmail(imapEmail) && isAuthError) {
                setImapError(
                    'Yahoo requires an app password. Generate one at login.yahoo.com → Account Security → Generate app password.',
                );
            } else if (isYandexEmail(imapEmail) && isAuthError) {
                setImapError(
                    'Yandex requires an app password. Enable it at passport.yandex.ru → Security → App passwords.',
                );
            } else {
                setImapError(msg);
            }
        } finally {
            setImapLoading(false);
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
            if (onSuccess) {
                setTimeout(onSuccess, 350);
            }
        } catch (e) {
            setTelegramError(
                e instanceof Error ? e.message : 'Failed to link Telegram',
            );
        } finally {
            setTelegramLoading(false);
        }
    };

    const SECTIONS: { title: string; ids: string[] }[] = [
        { title: 'Mail', ids: ['gmail', 'imap'] },
        { title: 'Calendars', ids: ['calendar', 'ios_calendar'] },
        { title: 'Messengers', ids: ['telegram'] },
        { title: 'Tools', ids: ['github', 'ios_reminders', 'jules'] },
        { title: 'Other', ids: [] }, // catch-all below
    ];

    const knownIds = new Set(SECTIONS.flatMap(s => s.ids));
    const otherConnectors = CONNECTORS.filter(c => !knownIds.has(c.id));

    const renderSection = (title: string, connectors: Connector[]) => {
        if (connectors.length === 0) return null;
        return (
            <View key={title} style={{ marginBottom: 24 }}>
                <Text style={[sharedStyles.sectionTitle, { marginBottom: 12 }]}>
                    {title}
                </Text>
                <View style={styles.grid}>
                    {connectors.map(connector => (
                        <ConnectorCard
                            key={connector.id}
                            connector={connector}
                            onPress={() => handleConnectorPress(connector)}
                            styles={styles}
                            palette={palette}
                        />
                    ))}
                </View>
            </View>
        );
    };

    return (
        <ScrollView
            contentContainerStyle={[
                sharedStyles.scrollContent,
                { paddingTop: 12 },
            ]}
            showsVerticalScrollIndicator={false}
        >
            {SECTIONS.map(section => {
                const connectors =
                    section.ids.length > 0
                        ? section.ids.flatMap(id =>
                              CONNECTORS.filter(c => c.id === id),
                          )
                        : otherConnectors;
                return renderSection(section.title, connectors);
            })}

            {errorMsg && (
                <Text
                    style={[
                        sharedStyles.syncStatus,
                        { marginTop: 8, color: palette.red },
                    ]}
                >
                    {errorMsg}
                </Text>
            )}

            {/* IMAP Credentials Modal */}
            <Modal
                visible={imapModalVisible}
                transparent
                animationType="fade"
                onRequestClose={() => setImapModalVisible(false)}
            >
                <KeyboardAvoidingView
                    style={{ flex: 1 }}
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                >
                    <View style={modalStyles.overlay}>
                        <View
                            style={[
                                modalStyles.container,
                                { backgroundColor: theme.surface },
                            ]}
                        >
                            <Text
                                style={[
                                    modalStyles.title,
                                    { color: theme.text },
                                ]}
                            >
                                Connect Email
                            </Text>
                            <Text
                                style={[
                                    modalStyles.subtitle,
                                    { color: theme.fadedText },
                                ]}
                            >
                                Server settings will be detected automatically
                                based on your email domain.
                            </Text>

                            <TextInput
                                style={[
                                    modalStyles.input,
                                    {
                                        color: theme.text,
                                        backgroundColor: theme.surfaceHighlight,
                                        borderColor: imapError
                                            ? palette.red
                                            : theme.border,
                                        fontSize: 16,
                                        letterSpacing: 0,
                                        fontWeight: '400',
                                    },
                                ]}
                                value={imapEmail}
                                onChangeText={t => {
                                    setImapEmail(t);
                                    setImapError(null);
                                }}
                                placeholder="email@example.com"
                                placeholderTextColor={theme.fadedText}
                                keyboardType="email-address"
                                autoCapitalize="none"
                                autoCorrect={false}
                                autoFocus
                                textAlign="left"
                            />

                            <TextInput
                                style={[
                                    modalStyles.input,
                                    {
                                        color: theme.text,
                                        backgroundColor: theme.surfaceHighlight,
                                        borderColor: imapError
                                            ? palette.red
                                            : theme.border,
                                        fontSize: 16,
                                        letterSpacing: 0,
                                        fontWeight: '400',
                                        marginTop: 8,
                                    },
                                ]}
                                value={imapPassword}
                                onChangeText={t => {
                                    setImapPassword(t);
                                    setImapError(null);
                                }}
                                placeholder="Password or app password"
                                placeholderTextColor={theme.fadedText}
                                secureTextEntry
                                textAlign="left"
                                returnKeyType="go"
                                onSubmitEditing={handleImapSubmit}
                                blurOnSubmit={false}
                            />

                            {!imapError && isICloudEmail(imapEmail) && (
                                <Text
                                    style={[
                                        modalStyles.hint,
                                        { color: theme.fadedText },
                                    ]}
                                >
                                    {
                                        'iCloud requires an app-specific password.\nGenerate one at appleid.apple.com → Sign-In and Security.'
                                    }
                                </Text>
                            )}
                            {!imapError && isGmailEmail(imapEmail) && (
                                <Text
                                    style={[
                                        modalStyles.hint,
                                        { color: theme.fadedText },
                                    ]}
                                >
                                    {
                                        'For Gmail, use the Gmail card instead — it connects via OAuth without a password.\n\nIf you need IMAP specifically, generate an app password at myaccount.google.com → Security → App passwords (requires 2-step verification).'
                                    }
                                </Text>
                            )}
                            {!imapError && isMailRuEmail(imapEmail) && (
                                <Text
                                    style={[
                                        modalStyles.hint,
                                        { color: theme.fadedText },
                                    ]}
                                >
                                    {
                                        'Mail.ru requires an app password.\nGenerate one in mail.ru Settings → Security → App passwords.'
                                    }
                                </Text>
                            )}
                            {!imapError && isOutlookEmail(imapEmail) && (
                                <Text
                                    style={[
                                        modalStyles.hint,
                                        { color: theme.fadedText },
                                    ]}
                                >
                                    {
                                        'Outlook/Hotmail requires an app password.\nGenerate one at account.microsoft.com → Security → Advanced security options → App passwords.'
                                    }
                                </Text>
                            )}
                            {!imapError && isYahooEmail(imapEmail) && (
                                <Text
                                    style={[
                                        modalStyles.hint,
                                        { color: theme.fadedText },
                                    ]}
                                >
                                    {
                                        'Yahoo requires an app password.\nGenerate one at login.yahoo.com → Account Security → Generate app password.'
                                    }
                                </Text>
                            )}
                            {!imapError && isYandexEmail(imapEmail) && (
                                <Text
                                    style={[
                                        modalStyles.hint,
                                        { color: theme.fadedText },
                                    ]}
                                >
                                    {
                                        'Yandex requires an app password.\nGenerate one at passport.yandex.ru → Security → App passwords.'
                                    }
                                </Text>
                            )}

                            {imapError && (
                                <Text
                                    style={[
                                        modalStyles.error,
                                        { color: palette.red },
                                    ]}
                                >
                                    {imapError}
                                </Text>
                            )}

                            <View style={modalStyles.buttons}>
                                <Pressable
                                    style={[
                                        modalStyles.button,
                                        {
                                            backgroundColor:
                                                theme.surfaceHighlight,
                                        },
                                    ]}
                                    onPress={() => setImapModalVisible(false)}
                                    disabled={imapLoading}
                                >
                                    <Text
                                        style={[
                                            modalStyles.buttonText,
                                            { color: theme.text },
                                        ]}
                                    >
                                        Cancel
                                    </Text>
                                </Pressable>
                                <Pressable
                                    style={[
                                        modalStyles.button,
                                        {
                                            backgroundColor: theme.accent,
                                            opacity: imapLoading ? 0.6 : 1,
                                        },
                                    ]}
                                    onPressIn={() => {
                                        Keyboard.dismiss();
                                        handleImapSubmit();
                                    }}
                                    disabled={imapLoading}
                                >
                                    {imapLoading ? (
                                        <ActivityIndicator
                                            color="#fff"
                                            size="small"
                                        />
                                    ) : (
                                        <Text
                                            style={[
                                                modalStyles.buttonText,
                                                { color: '#fff' },
                                            ]}
                                        >
                                            Connect
                                        </Text>
                                    )}
                                </Pressable>
                            </View>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>

            {/* Telegram Code Input Modal */}
            <Modal
                visible={telegramModalVisible}
                transparent
                animationType="fade"
                onRequestClose={() => setTelegramModalVisible(false)}
            >
                <View style={modalStyles.overlay}>
                    <View
                        style={[
                            modalStyles.container,
                            { backgroundColor: theme.surface },
                        ]}
                    >
                        <Text
                            style={[modalStyles.title, { color: theme.text }]}
                        >
                            Connect Telegram
                        </Text>
                        <Text
                            style={[
                                modalStyles.subtitle,
                                { color: theme.fadedText },
                            ]}
                        >
                            Send{' '}
                            <Text style={{ fontWeight: '700' }}>/start</Text> to{' '}
                            <Text style={{ fontWeight: '700' }}>
                                @genie_bot
                            </Text>{' '}
                            in Telegram, then enter the 6-digit code here.
                        </Text>

                        <TextInput
                            style={[
                                modalStyles.input,
                                {
                                    color: theme.text,
                                    backgroundColor: theme.surfaceHighlight,
                                    borderColor: telegramError
                                        ? palette.red
                                        : theme.border,
                                },
                            ]}
                            value={telegramCode}
                            onChangeText={t => {
                                setTelegramCode(
                                    t.replace(/[^0-9]/g, '').slice(0, 6),
                                );
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
                            <Text
                                style={[
                                    modalStyles.error,
                                    { color: palette.red },
                                ]}
                            >
                                {telegramError}
                            </Text>
                        )}

                        <View style={modalStyles.buttons}>
                            <Pressable
                                style={[
                                    modalStyles.button,
                                    { backgroundColor: theme.surfaceHighlight },
                                ]}
                                onPress={() => setTelegramModalVisible(false)}
                                disabled={telegramLoading}
                            >
                                <Text
                                    style={[
                                        modalStyles.buttonText,
                                        { color: theme.text },
                                    ]}
                                >
                                    Cancel
                                </Text>
                            </Pressable>
                            <Pressable
                                style={[
                                    modalStyles.button,
                                    {
                                        backgroundColor: '#0088cc',
                                        opacity:
                                            telegramCode.length !== 6 ||
                                            telegramLoading
                                                ? 0.5
                                                : 1,
                                    },
                                ]}
                                onPress={handleTelegramSubmit}
                                disabled={
                                    telegramCode.length !== 6 || telegramLoading
                                }
                            >
                                {telegramLoading ? (
                                    <ActivityIndicator
                                        color="#fff"
                                        size="small"
                                    />
                                ) : (
                                    <Text
                                        style={[
                                            modalStyles.buttonText,
                                            { color: '#fff' },
                                        ]}
                                    >
                                        Connect
                                    </Text>
                                )}
                            </Pressable>
                        </View>
                    </View>
                </View>
            </Modal>
        </ScrollView>
    );
}

const ConnectorCard = ({
    connector,
    onPress,
    styles,
    palette,
}: {
    connector: Connector;
    onPress: () => void;
    styles: any;
    palette: any;
}) => (
    <Pressable
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
        onPress={onPress}
    >
        <View
            style={[
                styles.iconBubble,
                {
                    backgroundColor:
                        palette[connector.colorKey] || palette.blue,
                },
            ]}
        >
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
    hint: {
        fontSize: 12,
        textAlign: 'center',
        marginBottom: 8,
        lineHeight: 17,
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
