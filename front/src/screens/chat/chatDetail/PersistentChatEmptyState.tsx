import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
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
}

function useChips(): Chip[] {
    const { integrations } = useConnectors();
    const chips: Chip[] = [];

    const hasGmail = integrations.some(c => c.id === 'gmail' && c.connected);
    const hasCalendar = integrations.some(c => c.id === 'calendar' && c.connected);

    if (hasGmail) chips.push({ label: '📧 Проверь почту', text: 'Проверь мою почту и выдели важное' });
    if (hasCalendar) chips.push({ label: '📅 Встречи', text: 'Что у меня запланировано сегодня?' });
    chips.push({ label: '💻 Напиши код', text: 'Помоги написать код' });
    chips.push({ label: '🔍 Найди информацию', text: 'Найди информацию о' });

    return chips.slice(0, 4);
}

export function PersistentChatEmptyState({ onChipPress, accentColor, textPrimaryColor, textSecondaryColor, surfaceColor }: Props) {
    const { user } = useAuth();
    const chips = useChips();
    const firstName = user?.name?.split(' ')[0] ?? 'там';

    return (
        <View style={styles.container}>
            <Text style={styles.avatar}>🧞</Text>
            <Text style={[styles.greeting, { color: textPrimaryColor }]}>
                Привет, {firstName}!
            </Text>
            <Text style={[styles.subtitle, { color: textSecondaryColor }]}>
                Чем могу помочь сегодня?
            </Text>
            <View style={styles.chips}>
                {chips.map(chip => (
                    <TouchableOpacity
                        key={chip.label}
                        style={[styles.chip, { backgroundColor: surfaceColor, borderColor: accentColor + '40' }]}
                        onPress={() => onChipPress(chip.text)}
                        activeOpacity={0.7}
                    >
                        <Text style={[styles.chipText, { color: textPrimaryColor }]}>{chip.label}</Text>
                    </TouchableOpacity>
                ))}
            </View>
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
