import React, { useState } from 'react';
import {
    View,
    Text,
    ScrollView,
    TextInput,
    TouchableOpacity,
    ActivityIndicator,
    StyleSheet,
    Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../../context/ThemeContext';
import { DayPlan } from '../types';
import { PlanBlockCard } from './PlanBlockCard';

interface PlanTimelineViewProps {
    plan: DayPlan;
    onApprove: () => void;
    onRequestChange: (change: string) => void;
}

export function PlanTimelineView({ plan, onApprove, onRequestChange }: PlanTimelineViewProps) {
    const { theme } = useTheme();
    const [changeText, setChangeText] = useState('');

    const handleSubmitChange = () => {
        const text = changeText.trim();
        if (!text) return;
        onRequestChange(text);
        setChangeText('');
    };

    return (
        <View style={[styles.container, { backgroundColor: theme.background }]}>
            {/* Status indicator */}
            {plan.status === 'replanning' && (
                <View style={[styles.statusRow, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                    <ActivityIndicator size="small" color={theme.accent} />
                    <Text style={[styles.statusText, { color: theme.textSecondary }]}>
                        Replanning your day...
                    </Text>
                </View>
            )}

            {/* Timeline */}
            <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
            >
                {(plan.blocks ?? []).length === 0 ? (
                    <View style={styles.emptyState}>
                        <Ionicons name="calendar-outline" size={40} color={theme.textSecondary} />
                        <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                            No blocks yet
                        </Text>
                    </View>
                ) : (
                    (plan.blocks ?? []).map((block) => (
                        <PlanBlockCard key={block.id} block={block} />
                    ))
                )}
            </ScrollView>

            {/* Actions based on status */}
            {plan.status === 'review' && (
                <View style={[styles.reviewActions, { borderColor: theme.border }]}>
                    <TouchableOpacity
                        onPress={onApprove}
                        style={[styles.approveBtn, { backgroundColor: theme.accent }]}
                        activeOpacity={0.8}
                    >
                        <Ionicons name="checkmark-circle" size={18} color="#fff" />
                        <Text style={styles.approveBtnText}>Approve & Save to Reminders</Text>
                    </TouchableOpacity>

                    <View style={[styles.changeInputRow, { borderColor: theme.border, backgroundColor: theme.surface }]}>
                        <TextInput
                            style={[styles.changeInput, { color: theme.textPrimary }]}
                            placeholder="Request a change..."
                            placeholderTextColor={theme.textSecondary}
                            value={changeText}
                            onChangeText={setChangeText}
                            multiline
                            returnKeyType="send"
                            onSubmitEditing={handleSubmitChange}
                        />
                        <TouchableOpacity
                            onPress={handleSubmitChange}
                            disabled={!changeText.trim()}
                            activeOpacity={0.7}
                            style={[
                                styles.sendBtn,
                                {
                                    backgroundColor: changeText.trim() ? theme.accent : theme.border,
                                },
                            ]}
                        >
                            <Ionicons name="arrow-up" size={16} color="#fff" />
                        </TouchableOpacity>
                    </View>
                </View>
            )}

            {plan.status === 'committed' && (
                <View style={[styles.reportSection, { borderColor: theme.border }]}>
                    <Text style={[styles.reportLabel, { color: theme.textSecondary }]}>
                        Report a change
                    </Text>
                    <View style={[styles.changeInputRow, { borderColor: theme.border, backgroundColor: theme.surface }]}>
                        <TextInput
                            style={[styles.changeInput, { color: theme.textPrimary }]}
                            placeholder="e.g. Задержался на 30 минут..."
                            placeholderTextColor={theme.textSecondary}
                            value={changeText}
                            onChangeText={setChangeText}
                            multiline
                            returnKeyType="send"
                            onSubmitEditing={handleSubmitChange}
                        />
                        <TouchableOpacity
                            onPress={handleSubmitChange}
                            disabled={!changeText.trim()}
                            activeOpacity={0.7}
                            style={[
                                styles.sendBtn,
                                {
                                    backgroundColor: changeText.trim() ? theme.accent : theme.border,
                                },
                            ]}
                        >
                            <Ionicons name="arrow-up" size={16} color="#fff" />
                        </TouchableOpacity>
                    </View>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        padding: 12,
        borderRadius: 10,
        borderWidth: 1,
        marginHorizontal: 16,
        marginBottom: 8,
    },
    statusText: {
        fontSize: 14,
    },
    scroll: {
        flex: 1,
    },
    scrollContent: {
        padding: 16,
        gap: 8,
    },
    emptyState: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 48,
        gap: 12,
    },
    emptyText: {
        fontSize: 15,
    },
    reviewActions: {
        borderTopWidth: 1,
        padding: 12,
        gap: 8,
    },
    approveBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        borderRadius: 12,
        paddingVertical: 13,
    },
    approveBtnText: {
        color: '#fff',
        fontSize: 15,
        fontWeight: '700',
    },
    changeInputRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        borderRadius: 12,
        borderWidth: 1,
        paddingHorizontal: 12,
        paddingVertical: Platform.OS === 'ios' ? 8 : 4,
        gap: 8,
    },
    changeInput: {
        flex: 1,
        fontSize: 15,
        maxHeight: 80,
    },
    sendBtn: {
        width: 30,
        height: 30,
        borderRadius: 15,
        justifyContent: 'center',
        alignItems: 'center',
    },
    reportSection: {
        borderTopWidth: 1,
        padding: 12,
        gap: 6,
    },
    reportLabel: {
        fontSize: 12,
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: 0.6,
    },
});
