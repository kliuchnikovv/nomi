import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useAuth } from '../../auth/context';
import { useConnectors } from '../../settings/connectors/context';
import { generateStarterChips } from '../../../services/suggestionGenerator';

interface Chip {
    label: string;
    text: string;
}

interface Props {
    onChipPress: (text: string) => void;
    accentColor: string;
    textPrimaryColor: string;
    textSecondaryColor: string;
    surfaceColor: string;
    showChips?: boolean;
}

/**
 * Starter chips for the empty chat. Returns static, integration-aware chips, and
 * (on iOS, when `enabled` and `recentContext` is non-empty) replaces them with
 * topic-aware chips generated on-device from the user's recent activity.
 */
export function useChips(
    enabled: boolean = true,
    recentContext: string = '',
): Chip[] {
    const { integrations } = useConnectors();
    const [generated, setGenerated] = useState<Chip[] | null>(null);

    // Static, integration-aware fallback chips (used until/unless AFM produces some).
    const staticChips = useMemo(() => {
        const chips: Chip[] = [];
        const hasGmail = integrations.some(
            c => c.id === 'gmail' && c.connected,
        );
        const hasCalendar = integrations.some(
            c => c.id === 'calendar' && c.connected,
        );
        if (hasGmail)
            chips.push({
                label: '📧 Check email',
                text: 'Check my email and highlight important items',
            });
        if (hasCalendar)
            chips.push({
                label: '📅 Meetings',
                text: 'What do I have planned today?',
            });
        chips.push({ label: '💻 Write code', text: 'Help me write code' });
        chips.push({ label: '🔍 Find info', text: 'Find information about' });
        return chips.slice(0, 4);
    }, [integrations]);

    // On-device (iOS) generation of topic-aware starter chips; silent no-op otherwise.
    useEffect(() => {
        if (!enabled || !recentContext) {
            setGenerated(null);
            return;
        }
        let cancelled = false;
        generateStarterChips(recentContext)
            .then(items => {
                if (!cancelled && items.length > 0) {
                    setGenerated(items.map(t => ({ label: t, text: t })));
                }
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [enabled, recentContext]);

    return (generated ?? staticChips).slice(0, 4);
}

export function PersistentChatEmptyState({
    onChipPress,
    accentColor,
    textPrimaryColor,
    textSecondaryColor,
    surfaceColor,
    showChips = true,
}: Props) {
    const { user } = useAuth();
    const chips = useChips(showChips);
    const firstName = user?.name?.split(' ')[0] ?? 'friend';

    return (
        <View style={styles.container}>
            <Text style={styles.avatar}>✨</Text>
            <Text style={[styles.greeting, { color: textPrimaryColor }]}>
                Hello, {firstName}!
            </Text>
            <Text style={[styles.subtitle, { color: textSecondaryColor }]}>
                How can I help you today?
            </Text>
            {showChips && (
                <View style={styles.chips}>
                    {chips.map(chip => (
                        <TouchableOpacity
                            key={chip.label}
                            style={[
                                styles.chip,
                                {
                                    backgroundColor: surfaceColor,
                                    borderColor: accentColor + '40',
                                },
                            ]}
                            onPress={() => onChipPress(chip.text)}
                            activeOpacity={0.7}
                        >
                            <Text
                                style={[
                                    styles.chipText,
                                    { color: textPrimaryColor },
                                ]}
                            >
                                {chip.label}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
        gap: 8,
    },
    avatar: { fontSize: 56, marginBottom: 8 },
    greeting: { fontSize: 24, fontWeight: '700', textAlign: 'center' },
    subtitle: { fontSize: 16, textAlign: 'center', marginBottom: 16 },
    chips: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
        justifyContent: 'center',
        marginTop: 8,
    },
    chip: {
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 20,
        borderWidth: 1,
    },
    chipText: { fontSize: 14, fontWeight: '500' },
});
