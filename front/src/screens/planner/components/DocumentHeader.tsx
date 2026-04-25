import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { useTheme } from '../../../context/ThemeContext';

interface Props {
    date: string;     // YYYY-MM-DD
    onPrev: () => void;
    onNext: () => void;
    isSyncing?: boolean;
    onSync?: () => void;
}

const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_EN = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function todayString(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function shiftDateString(base: string, delta: number): string {
    const d = new Date(`${base}T00:00:00`);
    d.setDate(d.getDate() + delta);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function getLabel(date: string): string {
    const today = todayString();
    if (date === today) return 'Today';
    if (date === shiftDateString(today, -1)) return 'Yesterday';
    if (date === shiftDateString(today, 1)) return 'Tomorrow';

    const d = new Date(`${date}T00:00:00`);
    const weekday = WEEKDAYS_EN[d.getDay()];
    const day = d.getDate();
    const month = MONTHS_EN[d.getMonth()];
    return `${weekday}, ${day} ${month}`;
}

export function DocumentHeader({ date, onPrev, onNext, isSyncing, onSync }: Props) {
    const { theme } = useTheme();
    const label = getLabel(date);
    const showSync = Platform.OS === 'ios' && onSync;

    return (
        <View style={[styles.container, { borderColor: theme.border }]}>
            <TouchableOpacity
                onPress={onPrev}
                style={styles.arrowBtn}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
                <Text style={styles.arrow}>‹</Text>
            </TouchableOpacity>

            <Text style={[styles.label, { color: '#007AFF' }]}>
                {label}
            </Text>

            <View style={styles.rightGroup}>
                {showSync && (
                    <TouchableOpacity
                        onPress={onSync}
                        disabled={isSyncing}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={styles.syncBtn}
                    >
                        {isSyncing
                            ? <ActivityIndicator size="small" color="#007AFF" />
                            : <Text style={[styles.syncIcon, { color: '#007AFF' }]}>↻</Text>
                        }
                    </TouchableOpacity>
                )}
                <TouchableOpacity
                    onPress={onNext}
                    style={styles.arrowBtn}
                    activeOpacity={0.7}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                    <Text style={styles.arrow}>›</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 10,
        paddingHorizontal: 4,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    arrowBtn: {
        paddingHorizontal: 12,
        paddingVertical: 4,
        minWidth: 44,
        alignItems: 'center',
    },
    arrow: {
        fontSize: 26,
        fontWeight: '300',
        color: '#007AFF',
        lineHeight: 30,
    },
    label: {
        fontSize: 17,
        fontWeight: '600',
        flex: 1,
        textAlign: 'center',
    },
    rightGroup: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    syncBtn: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        minWidth: 32,
        alignItems: 'center',
        justifyContent: 'center',
    },
    syncIcon: {
        fontSize: 20,
        fontWeight: '400',
    },
});
