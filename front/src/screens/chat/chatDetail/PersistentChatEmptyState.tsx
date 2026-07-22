import React, { useMemo } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Text } from '@genie/ds';
import { useTheme } from '../../../context/ThemeContext';
import { useAuth } from '../../auth/context';
import { useConnectors } from '../../settings/connectors/context';

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

// `_enabled` is accepted for call-site compatibility; AFM generation removed.
export function useChips(_enabled: boolean = true): Chip[] {
    const { integrations } = useConnectors();

    // Static, integration-aware starter chips for the empty chat.
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

    return staticChips;
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
    const { descriptor } = useTheme();
    const chips = useChips(showChips);
    const firstName = user?.name?.split(' ')[0] ?? 'friend';

    return (
        <View style={styles.container}>
            <Text theme={descriptor} style={styles.avatar}>
                ✨
            </Text>
            <Text
                theme={descriptor}
                variant="title"
                weight="700"
                align="center"
                style={[styles.greeting, { color: textPrimaryColor }]}
            >
                Hello, {firstName}!
            </Text>
            <Text
                theme={descriptor}
                variant="body"
                align="center"
                style={[styles.subtitle, { color: textSecondaryColor }]}
            >
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
                                theme={descriptor}
                                variant="body"
                                weight="500"
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
