import React, { useEffect, useMemo, useState } from 'react';
import { Modal, View, TouchableOpacity, StyleSheet } from 'react-native';
import { NavArrowLeft, NavArrowRight } from 'iconoir-react-native';
import { Text } from '@genie/ds';
import { useTheme } from '../../../context/ThemeContext';
import {
    MONTHS_EN,
    WEEKDAYS_EN,
    formatDateString,
    todayString,
} from '../dateUtils';

interface Props {
    visible: boolean;
    initialDate: string; // YYYY-MM-DD
    onConfirm: (date: string) => void;
    onCancel: () => void;
}

function parseYMD(s: string): { y: number; m: number; d: number } {
    const [y, m, d] = s.split('-').map(Number);
    return { y, m: m - 1, d };
}

function daysInMonth(y: number, m: number): number {
    return new Date(y, m + 1, 0).getDate();
}

export function DatePickerModal({
    visible,
    initialDate,
    onConfirm,
    onCancel,
}: Props) {
    const { theme, descriptor } = useTheme();
    const [selected, setSelected] = useState(initialDate);
    const [viewYear, setViewYear] = useState(() => parseYMD(initialDate).y);
    const [viewMonth, setViewMonth] = useState(() => parseYMD(initialDate).m);

    useEffect(() => {
        if (visible) {
            const p = parseYMD(initialDate);
            setSelected(initialDate);
            setViewYear(p.y);
            setViewMonth(p.m);
        }
    }, [visible, initialDate]);

    const today = todayString();

    const grid = useMemo(() => {
        const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
        const total = daysInMonth(viewYear, viewMonth);
        const prevTotal = daysInMonth(viewYear, viewMonth - 1);
        const cells: { date: string; day: number; inMonth: boolean }[] = [];

        for (let i = firstWeekday - 1; i >= 0; i--) {
            const day = prevTotal - i;
            const prevMonth = viewMonth === 0 ? 11 : viewMonth - 1;
            const prevYear = viewMonth === 0 ? viewYear - 1 : viewYear;
            cells.push({
                date: formatDateString(prevYear, prevMonth, day),
                day,
                inMonth: false,
            });
        }
        for (let d = 1; d <= total; d++) {
            cells.push({
                date: formatDateString(viewYear, viewMonth, d),
                day: d,
                inMonth: true,
            });
        }
        // Always pad to 6 rows (42 cells) so the modal height stays constant
        // regardless of how many calendar weeks the month spans.
        const totalCells = 42;
        let trailingDay = 1;
        while (cells.length < totalCells) {
            const nextMonth = viewMonth === 11 ? 0 : viewMonth + 1;
            const nextYear = viewMonth === 11 ? viewYear + 1 : viewYear;
            cells.push({
                date: formatDateString(nextYear, nextMonth, trailingDay),
                day: trailingDay,
                inMonth: false,
            });
            trailingDay++;
        }
        return cells;
    }, [viewYear, viewMonth]);

    const goPrevMonth = () => {
        if (viewMonth === 0) {
            setViewMonth(11);
            setViewYear(viewYear - 1);
        } else {
            setViewMonth(viewMonth - 1);
        }
    };
    const goNextMonth = () => {
        if (viewMonth === 11) {
            setViewMonth(0);
            setViewYear(viewYear + 1);
        } else {
            setViewMonth(viewMonth + 1);
        }
    };

    const cardBg = theme.surface ?? theme.background;

    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={onCancel}
        >
            <View style={styles.backdrop}>
                <TouchableOpacity
                    style={StyleSheet.absoluteFillObject}
                    onPress={onCancel}
                    activeOpacity={1}
                />
                <View style={[styles.card, { backgroundColor: cardBg }]}>
                    <View style={styles.monthRow}>
                        <TouchableOpacity
                            onPress={goPrevMonth}
                            style={[
                                styles.monthArrow,
                                { backgroundColor: theme.background },
                            ]}
                            activeOpacity={0.7}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                            <NavArrowLeft
                                width={20}
                                height={20}
                                color={theme.textPrimary}
                            />
                        </TouchableOpacity>
                        <Text
                            theme={descriptor}
                            variant="body"
                            tone="primary"
                            weight="600"
                            style={styles.monthLabel}
                        >
                            {MONTHS_EN[viewMonth]} {viewYear}
                        </Text>
                        <TouchableOpacity
                            onPress={goNextMonth}
                            style={[
                                styles.monthArrow,
                                { backgroundColor: theme.background },
                            ]}
                            activeOpacity={0.7}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                            <NavArrowRight
                                width={20}
                                height={20}
                                color={theme.textPrimary}
                            />
                        </TouchableOpacity>
                    </View>

                    <View style={styles.weekRow}>
                        {WEEKDAYS_EN.map(w => (
                            <Text
                                key={w}
                                theme={descriptor}
                                variant="caption"
                                tone="secondary"
                                weight="600"
                                align="center"
                                style={styles.weekday}
                            >
                                {w}
                            </Text>
                        ))}
                    </View>

                    <View style={styles.grid}>
                        {grid.map((cell, idx) => {
                            const isSelected = cell.date === selected;
                            const isToday = cell.date === today;
                            const textColor = isSelected
                                ? theme.background
                                : cell.inMonth
                                ? theme.textPrimary
                                : theme.textSecondary;
                            return (
                                <TouchableOpacity
                                    key={idx}
                                    onPress={() => setSelected(cell.date)}
                                    style={styles.cellWrap}
                                    activeOpacity={0.7}
                                >
                                    <View
                                        style={[
                                            styles.cell,
                                            isSelected && {
                                                backgroundColor: theme.accent,
                                            },
                                            !isSelected &&
                                                isToday && {
                                                    borderWidth: 1,
                                                    borderColor: theme.accent,
                                                },
                                            !cell.inMonth &&
                                                !isSelected && {
                                                    opacity: 0.45,
                                                },
                                        ]}
                                    >
                                        <Text
                                            theme={descriptor}
                                            variant="body"
                                            weight="500"
                                            style={[
                                                styles.cellText,
                                                { color: textColor },
                                            ]}
                                        >
                                            {cell.day}
                                        </Text>
                                    </View>
                                </TouchableOpacity>
                            );
                        })}
                    </View>

                    <View style={styles.actions}>
                        <TouchableOpacity
                            style={[
                                styles.btn,
                                styles.cancelBtn,
                                { borderColor: theme.border },
                            ]}
                            onPress={onCancel}
                            activeOpacity={0.7}
                        >
                            <Text
                                theme={descriptor}
                                variant="body"
                                tone="secondary"
                                weight="600"
                                style={styles.btnText}
                            >
                                Cancel
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[
                                styles.btn,
                                { backgroundColor: theme.accent },
                            ]}
                            onPress={() => onConfirm(selected)}
                            activeOpacity={0.7}
                        >
                            <Text
                                theme={descriptor}
                                variant="body"
                                weight="600"
                                style={[
                                    styles.btnText,
                                    { color: theme.background },
                                ]}
                            >
                                Done
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const CELL_SIZE = 40;

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        justifyContent: 'flex-end',
        backgroundColor: 'rgba(0,0,0,0.35)',
    },
    card: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingTop: 20,
        paddingBottom: 36,
        paddingHorizontal: 16,
        gap: 16,
    },
    monthRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 4,
    },
    monthArrow: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    monthLabel: { fontSize: 17 },
    weekRow: {
        flexDirection: 'row',
    },
    weekday: {
        flex: 1,
    },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    cellWrap: {
        width: `${100 / 7}%`,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 2,
    },
    cell: {
        width: CELL_SIZE,
        height: CELL_SIZE,
        borderRadius: CELL_SIZE / 2,
        alignItems: 'center',
        justifyContent: 'center',
    },
    cellText: { fontSize: 15 },
    actions: {
        flexDirection: 'row',
        gap: 12,
        marginTop: 4,
    },
    btn: {
        flex: 1,
        paddingVertical: 14,
        borderRadius: 22,
        alignItems: 'center',
    },
    cancelBtn: {
        borderWidth: 1,
    },
    btnText: { fontSize: 16 },
});
