import React, { useState } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ActivityIndicator,
    Platform,
} from 'react-native';
import {
    NavArrowLeft,
    NavArrowRight,
    NavArrowDown,
    Refresh,
} from 'iconoir-react-native';
import { useTheme } from '../../../context/ThemeContext';
import { DatePickerModal } from './DatePickerModal';
import {
    MONTHS_SHORT_EN,
    WEEKDAYS_EN,
    shiftDateString,
    todayString,
} from '../dateUtils';

interface Props {
    date: string; // YYYY-MM-DD
    onPrev: () => void;
    onNext: () => void;
    onPickDate: (date: string) => void;
    isSyncing?: boolean;
    onSync?: () => void;
}

function getLabel(date: string): string {
    const today = todayString();
    if (date === today) return 'Today';
    if (date === shiftDateString(today, -1)) return 'Yesterday';
    if (date === shiftDateString(today, 1)) return 'Tomorrow';

    const d = new Date(`${date}T00:00:00`);
    const weekday = WEEKDAYS_EN[d.getDay()];
    const day = d.getDate();
    const month = MONTHS_SHORT_EN[d.getMonth()];
    return `${weekday}, ${day} ${month}`;
}

export function DocumentHeader({
    date,
    onPrev,
    onNext,
    onPickDate,
    isSyncing,
    onSync,
}: Props) {
    const { theme } = useTheme();
    const [pickerOpen, setPickerOpen] = useState(false);
    const label = getLabel(date);
    const showSync = Platform.OS === 'ios' && onSync;

    return (
        <View
            style={[
                styles.container,
                { backgroundColor: theme.background + 'D0' },
            ]}
        >
            <TouchableOpacity
                onPress={onPrev}
                style={[styles.arrowBtn, { backgroundColor: theme.surface }]}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
                <NavArrowLeft
                    width={20}
                    height={20}
                    color={theme.textPrimary}
                />
            </TouchableOpacity>

            <TouchableOpacity
                onPress={() => setPickerOpen(true)}
                style={[styles.labelPill, { backgroundColor: theme.surface }]}
                activeOpacity={0.7}
            >
                <Text style={[styles.labelText, { color: theme.textPrimary }]}>
                    {label}
                </Text>
                <NavArrowDown
                    width={14}
                    height={14}
                    color={theme.textSecondary}
                />
            </TouchableOpacity>

            <View style={styles.rightGroup}>
                {showSync && (
                    <TouchableOpacity
                        onPress={onSync}
                        disabled={isSyncing}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={[
                            styles.arrowBtn,
                            { backgroundColor: theme.surface, marginRight: 8 },
                        ]}
                        activeOpacity={0.7}
                    >
                        {isSyncing ? (
                            <ActivityIndicator
                                size="small"
                                color={theme.textPrimary}
                            />
                        ) : (
                            <Refresh
                                width={18}
                                height={18}
                                color={theme.textPrimary}
                            />
                        )}
                    </TouchableOpacity>
                )}
                <TouchableOpacity
                    onPress={onNext}
                    style={[
                        styles.arrowBtn,
                        { backgroundColor: theme.surface },
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

            <DatePickerModal
                visible={pickerOpen}
                initialDate={date}
                onConfirm={d => {
                    setPickerOpen(false);
                    onPickDate(d);
                }}
                onCancel={() => setPickerOpen(false)}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 10,
        paddingHorizontal: 12,
        gap: 8,
    },
    arrowBtn: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    labelPill: {
        flex: 1,
        height: 36,
        borderRadius: 18,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingHorizontal: 14,
    },
    labelText: {
        fontSize: 15,
        fontWeight: '600',
    },
    rightGroup: {
        flexDirection: 'row',
        alignItems: 'center',
    },
});
