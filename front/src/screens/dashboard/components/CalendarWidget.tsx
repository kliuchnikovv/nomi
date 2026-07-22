import React from 'react';
import { View, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { Card, Text } from '@genie/ds';
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
    const { theme, descriptor } = useTheme();
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    const todayDate = today.getDate();
    const weeks = buildMonthGrid(year, month);

    const monthName = today.toLocaleDateString('en-US', { month: 'long' });

    const openCalendar = () => Linking.openURL('calshow://');

    return (
        <TouchableOpacity
            onPress={openCalendar}
            activeOpacity={0.8}
            style={{ flex: 1, borderRadius: descriptor.radius.lg }}
        >
            <Card
                theme={descriptor}
                padding="md"
                radius="lg"
                bordered
                style={styles.card}
            >
                <Text
                    theme={descriptor}
                    variant="caption"
                    tone="secondary"
                    weight="600"
                    style={styles.monthName}
                >
                    {monthName.toUpperCase()}
                </Text>

                <View style={styles.weekRow}>
                    {WEEKDAYS.map((d, i) => (
                        <View key={i} style={styles.weekdayCell}>
                            <Text
                                theme={descriptor}
                                variant="caption"
                                tone="secondary"
                                weight="600"
                                align="center"
                                style={styles.tinyText}
                            >
                                {d}
                            </Text>
                        </View>
                    ))}
                </View>

                {weeks.map((week, wi) => (
                    <View key={wi} style={styles.weekRow}>
                        {week.map((day, di) => {
                            const isToday = day === todayDate;
                            return (
                                <View
                                    key={di}
                                    style={[
                                        styles.dayCell,
                                        isToday && {
                                            backgroundColor: theme.accent,
                                        },
                                    ]}
                                >
                                    <Text
                                        theme={descriptor}
                                        variant="caption"
                                        align="center"
                                        style={{
                                            fontSize: 9,
                                            color: day
                                                ? isToday
                                                    ? theme.background
                                                    : theme.textPrimary
                                                : 'transparent',
                                        }}
                                    >
                                        {day ?? 0}
                                    </Text>
                                </View>
                            );
                        })}
                    </View>
                ))}
            </Card>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    card: { gap: 4 },
    monthName: { letterSpacing: 0.8, marginBottom: 2 },
    weekRow: { flexDirection: 'row', justifyContent: 'space-between' },
    weekdayCell: { flex: 1 },
    tinyText: { fontSize: 9 },
    dayCell: {
        flex: 1,
        aspectRatio: 1,
        borderRadius: 100,
        justifyContent: 'center',
        alignItems: 'center',
    },
});
