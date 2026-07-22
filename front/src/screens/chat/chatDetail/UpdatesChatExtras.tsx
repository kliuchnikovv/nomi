/**
 * UpdatesChatExtras — proactive source badge + Discuss / Dismiss buttons,
 * rendered under each proactive assistant message in the Updates chat. Wired
 * into ChatDetailScreen via renderMessageWithExtras. Self-hides when
 * message.meta?.source !== 'proactive', so it is safe to render for any message.
 */

import React, { useState } from 'react';
import { View, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { Text } from '@genie/ds';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../../../context/ThemeContext';
import { useMain } from '../../main/context';
import { eventsApi } from '../../../apiClient';
import type { Message, ProactiveMeta } from '../../main/models';
import type { ChatStackParamList } from '../../../navigation/types';
import { emptyChatID } from '../../main/context';

type NavProp = NativeStackNavigationProp<ChatStackParamList, 'ChatDetail'>;

/** Map event_type → human-readable source label shown in the badge. */
function sourceLabel(eventType?: ProactiveMeta['event_type']): string {
    switch (eventType) {
        case 'calendar_upcoming':
            return '📅 Calendar';
        case 'email_new':
            return '✉️ Email';
        case 'reminder_due':
            return '✅ Reminder';
        case 'daily_brief':
            return '☀️ Daily brief';
        case 'health_anomaly':
            return '❤️ Health';
        case 'watch_reminder':
            return '⏰ Reminder';
        default:
            return '🔔 Update';
    }
}

interface Props {
    message: Message;
    /** The chat ID of the Updates chat (used for context when opening a Discuss thread). */
    chatId: string;
}

export function UpdatesChatExtras({ message, chatId }: Props) {
    const { theme, descriptor } = useTheme();
    const { createNewChat, setPendingInitialMessage } = useMain();
    const navigation = useNavigation<NavProp>();
    const [dismissed, setDismissed] = useState(false);

    const meta = message.meta;

    // Only render for proactive assistant messages
    if (!meta || meta.source !== 'proactive') return null;

    const eventId = meta.event_id;
    const label = sourceLabel(meta.event_type);
    const deepLink = meta.deep_link;

    function handleOpen() {
        if (!deepLink) return;
        // Internal nomi:// routes navigate in-app; everything else launches the
        // matching native app (Calendar, Reminders, …). A missing/unhandled
        // native scheme fails softly via the catch.
        if (deepLink.startsWith('nomi://')) {
            const route = deepLink.slice('nomi://'.length);
            if (route === 'planning') {
                navigation.getParent()?.navigate('Planning' as never);
            }
            return;
        }
        Linking.openURL(deepLink).catch(() => {});
    }

    async function handleDiscuss() {
        if (eventId) {
            try {
                await eventsApi.setState(eventId, 'discussed');
            } catch (e) {
                // Non-fatal: state endpoint may 404 until Go PR lands
                console.warn(
                    '[UpdatesChatExtras] setState(discussed) failed:',
                    e,
                );
            }
        }
        // Open a new agent chat pre-seeded with the proactive message text.
        // ChatContext consumes pendingInitialMessage on activeChatID change.
        setPendingInitialMessage(message.text);
        createNewChat();
        navigation.replace('ChatDetail', { chatId: emptyChatID });
    }

    async function handleDismiss() {
        if (eventId) {
            try {
                await eventsApi.setState(eventId, 'dismissed');
            } catch (e) {
                console.warn(
                    '[UpdatesChatExtras] setState(dismissed) failed:',
                    e,
                );
            }
        }
        setDismissed(true);
    }

    return (
        <View style={styles.wrapper}>
            {/* Source badge */}
            <View
                style={[
                    styles.badge,
                    {
                        backgroundColor: `${theme.accent}18`,
                        borderColor: `${theme.accent}40`,
                    },
                ]}
            >
                <Text
                    theme={descriptor}
                    style={[styles.badgeText, { color: theme.accent }]}
                >
                    {label}
                </Text>
            </View>

            {/* Dismissed overlay */}
            {dismissed ? (
                <Text
                    theme={descriptor}
                    style={[
                        styles.dismissedText,
                        { color: theme.textSecondary },
                    ]}
                >
                    Dismissed
                </Text>
            ) : (
                <View style={styles.buttonRow}>
                    {deepLink ? (
                        <TouchableOpacity
                            style={[
                                styles.btn,
                                styles.dismissBtn,
                                { borderColor: theme.border },
                            ]}
                            onPress={handleOpen}
                            activeOpacity={0.8}
                        >
                            <Text
                                theme={descriptor}
                                style={[
                                    styles.dismissText,
                                    { color: theme.accent },
                                ]}
                            >
                                Open
                            </Text>
                        </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity
                        style={[
                            styles.btn,
                            styles.discussBtn,
                            { backgroundColor: theme.accent },
                        ]}
                        onPress={handleDiscuss}
                        activeOpacity={0.8}
                    >
                        <Text theme={descriptor} style={styles.discussText}>
                            Discuss
                        </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[
                            styles.btn,
                            styles.dismissBtn,
                            { borderColor: theme.border },
                        ]}
                        onPress={handleDismiss}
                        activeOpacity={0.8}
                    >
                        <Text
                            theme={descriptor}
                            style={[
                                styles.dismissText,
                                { color: theme.textSecondary },
                            ]}
                        >
                            Dismiss
                        </Text>
                    </TouchableOpacity>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        marginTop: 6,
        marginBottom: 2,
        gap: 6,
        alignItems: 'flex-start',
    },
    badge: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 10,
        borderWidth: 1,
    },
    badgeText: {
        fontSize: 11,
        fontWeight: '600',
    },
    buttonRow: {
        flexDirection: 'row',
        gap: 8,
    },
    btn: {
        paddingHorizontal: 14,
        paddingVertical: 6,
        borderRadius: 14,
    },
    discussBtn: {
        // background set inline via theme.accent
    },
    dismissBtn: {
        borderWidth: 1,
    },
    discussText: {
        fontSize: 13,
        fontWeight: '600',
        color: '#fff',
    },
    dismissText: {
        fontSize: 13,
        fontWeight: '600',
    },
    dismissedText: {
        fontSize: 12,
        fontStyle: 'italic',
    },
});
