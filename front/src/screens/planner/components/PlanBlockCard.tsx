import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../context/ThemeContext';
import { PlanBlock, PlanBlockType } from '../types';

interface PlanBlockCardProps {
    block: PlanBlock;
}

function getBlockIcon(type: PlanBlockType): string {
    switch (type) {
        case 'task': return 'checkmark-circle-outline';
        case 'travel': return 'car-outline';
        case 'buffer': return 'time-outline';
        case 'break': return 'cafe-outline';
        default: return 'ellipse-outline';
    }
}

export function PlanBlockCard({ block }: PlanBlockCardProps) {
    const { theme, palette } = useTheme();

    const getBlockBg = (): string => {
        switch (block.type) {
            case 'task': return theme.accent;
            case 'travel': return palette.blue;
            case 'break': return theme.surface;
            case 'buffer': return 'transparent';
            default: return theme.surface;
        }
    };

    const getBlockBorder = (): string => {
        switch (block.type) {
            case 'task': return theme.accent;
            case 'travel': return palette.blue;
            case 'break': return theme.border;
            case 'buffer': return theme.border;
            default: return theme.border;
        }
    };

    const getTextColor = (): string => {
        switch (block.type) {
            case 'task': return '#fff';
            case 'travel': return '#fff';
            default: return theme.textPrimary;
        }
    };

    const getSubTextColor = (): string => {
        switch (block.type) {
            case 'task': return 'rgba(255,255,255,0.75)';
            case 'travel': return 'rgba(255,255,255,0.75)';
            default: return theme.textSecondary;
        }
    };

    const bgColor = getBlockBg();
    const borderColor = getBlockBorder();
    const textColor = getTextColor();
    const subTextColor = getSubTextColor();
    const isTransparent = block.type === 'buffer';

    return (
        <View style={styles.wrapper}>
            {/* Travel connector shown above the card when travel_before_min > 0 */}
            {block.travel_before_min > 0 && (
                <View style={styles.travelConnector}>
                    <View style={[styles.connectorLine, { backgroundColor: theme.border }]} />
                    <View style={[styles.connectorBadge, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                        <Ionicons name="car-outline" size={12} color={theme.textSecondary} />
                        <Text style={[styles.connectorText, { color: theme.textSecondary }]}>
                            {block.travel_before_min} min
                        </Text>
                    </View>
                    <View style={[styles.connectorLine, { backgroundColor: theme.border }]} />
                </View>
            )}

            <View
                style={[
                    styles.card,
                    {
                        backgroundColor: bgColor,
                        borderColor,
                        borderStyle: isTransparent ? 'dashed' : 'solid',
                    },
                ]}
            >
                <View style={styles.timeRow}>
                    <View style={styles.iconWrap}>
                        <Ionicons
                            name={getBlockIcon(block.type) as any}
                            size={14}
                            color={textColor}
                        />
                    </View>
                    <Text style={[styles.timeText, { color: textColor }]}>
                        {block.start} – {block.end}
                    </Text>
                    <Text style={[styles.durationBadge, { color: subTextColor }]}>
                        {block.duration_min} min
                    </Text>
                </View>

                <Text style={[styles.title, { color: textColor }]} numberOfLines={2}>
                    {block.title}
                </Text>

                {block.location && (
                    <View style={styles.locationRow}>
                        <Ionicons name="location-outline" size={12} color={subTextColor} />
                        <Text style={[styles.locationText, { color: subTextColor }]} numberOfLines={1}>
                            {block.location}
                        </Text>
                    </View>
                )}

                {block.notes && (
                    <Text style={[styles.notes, { color: subTextColor }]} numberOfLines={2}>
                        {block.notes}
                    </Text>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        gap: 0,
    },
    travelConnector: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        marginVertical: 4,
        gap: 6,
    },
    connectorLine: {
        flex: 1,
        height: 1,
    },
    connectorBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        borderRadius: 8,
        borderWidth: 1,
        paddingHorizontal: 8,
        paddingVertical: 3,
    },
    connectorText: {
        fontSize: 11,
    },
    card: {
        borderRadius: 14,
        borderWidth: 1,
        padding: 12,
        gap: 4,
    },
    timeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    iconWrap: {
        opacity: 0.85,
    },
    timeText: {
        fontSize: 12,
        fontWeight: '600',
        flex: 1,
    },
    durationBadge: {
        fontSize: 11,
    },
    title: {
        fontSize: 15,
        fontWeight: '600',
    },
    locationRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        marginTop: 2,
    },
    locationText: {
        fontSize: 12,
        flex: 1,
    },
    notes: {
        fontSize: 12,
        marginTop: 2,
    },
});
