import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { useTheme } from '../../../context/ThemeContext';

// Monday-first: M T W T F S S
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function buildMonthGrid(year: number, month: number) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    // getDay() returns 0=Sun..6=Sat; convert to Monday-first (0=Mon..6=Sun)
    const rawDay = new Date(year, month, 1).getDay();
    const firstDayOfWeek = (rawDay + 6) % 7;
    const days: (number | null)[] = [];
    for (let i = 0; i < firstDayOfWeek; i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) days.push(d);
    while (days.length % 7 !== 0) days.push(null);
    const weeks: (number | null)[][] = [];
    for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
    return weeks;
}

export function CalendarWidget() {
    const { theme } = useTheme();
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    const todayDate = today.getDate();
    const weeks = buildMonthGrid(year, month);

    const monthName = today.toLocaleDateString('en-US', { month: 'long' });

    const openCalendar = () => Linking.openURL('calshow://');

    return (
        <TouchableOpacity
            style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
            onPress={openCalendar}
            activeOpacity={0.8}
        >
            <Text style={[styles.monthName, { color: theme.textSecondary }]}>
                {monthName}
            </Text>

            {/* Weekday headers */}
            <View style={styles.weekRow}>
                {WEEKDAYS.map((d, i) => (
                    <Text key={i} style={[styles.weekday, { color: theme.textSecondary }]}>{d}</Text>
                ))}
            </View>

            {/* Day grid */}
            {weeks.map((week, wi) => (
                <View key={wi} style={styles.weekRow}>
                    {week.map((day, di) => {
                        const isToday = day === todayDate;
                        return (
                            <View
                                key={di}
                                style={[
                                    styles.dayCell,
                                    isToday && { backgroundColor: theme.accent },
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.dayText,
                                        { color: day ? (isToday ? '#fff' : theme.textPrimary) : 'transparent' },
                                    ]}
                                >
                                    {day ?? 0}
                                </Text>
                            </View>
                        );
                    })}
                </View>
            ))}
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    card: {
        flex: 1,
        padding: 12,
        borderRadius: 16,
        borderWidth: 1,
        gap: 4,
    },
    monthName: {
        fontSize: 11,
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: 0.8,
        marginBottom: 2,
    },
    weekRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    weekday: {
        flex: 1,
        fontSize: 9,
        fontWeight: '600',
        textAlign: 'center',
    },
    dayCell: {
        flex: 1,
        aspectRatio: 1,
        borderRadius: 100,
        justifyContent: 'center',
        alignItems: 'center',
    },
    dayText: {
        fontSize: 9,
        textAlign: 'center',
    },
});
