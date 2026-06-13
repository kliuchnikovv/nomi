import React, { useCallback, useEffect, useState } from 'react';
import {
    View,
    Text,
    ScrollView,
    StyleSheet,
    ActivityIndicator,
    TouchableOpacity,
    TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import { tasksApi } from '../../apiClient';
import type {
    AgentTask,
    AgentTaskEvent,
    AgentTaskStep,
    AgentTaskStatus,
} from '../main/models';
import type { DashboardStackParamList } from '../../navigation/types';
import { statusColor, statusLabel } from './status';

type Nav = NativeStackNavigationProp<DashboardStackParamList, 'TaskDetail'>;
type Rt = RouteProp<DashboardStackParamList, 'TaskDetail'>;

const ACTIVE: AgentTaskStatus[] = [
    'planning',
    'running',
    'waiting_input',
    'paused',
];

function eventLine(e: AgentTaskEvent): string {
    const p = e.payload ?? {};
    switch (e.kind) {
        case 'plan_update':
            return `Planned ${Array.isArray(p.plan) ? p.plan.length : 0} steps`;
        case 'step_started':
            return `Started: ${p.title ?? ''}`;
        case 'step_done':
            return `Finished step${
                typeof p.step_id === 'number' ? ` ${p.step_id + 1}` : ''
            }`;
        case 'done':
            return 'Task completed';
        case 'log':
            return p.message ?? '';
        case 'approval_request':
            return `Approval requested: ${p.title ?? ''}`;
        case 'error':
            return `Error: ${p.error ?? p.reason ?? 'unknown'}`;
        default:
            return e.kind;
    }
}

function stepIcon(status: AgentTaskStep['status']): {
    name: keyof typeof Ionicons.glyphMap;
    key: 'done' | 'running' | 'pending';
} {
    if (status === 'done') return { name: 'checkmark-circle', key: 'done' };
    if (status === 'running') return { name: 'sync', key: 'running' };
    return { name: 'ellipse-outline', key: 'pending' };
}

function fmtTime(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export const TaskDetailScreen = () => {
    const navigation = useNavigation<Nav>();
    const route = useRoute<Rt>();
    const { taskId } = route.params;
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();

    const [task, setTask] = useState<AgentTask | null>(null);
    const [events, setEvents] = useState<AgentTaskEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [steerText, setSteerText] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try {
            const res = await tasksApi.get(taskId);
            if (res) {
                setTask(res.task);
                setEvents(res.events ?? []);
            }
        } catch {
            // keep last-known state on transient errors
        } finally {
            setLoading(false);
        }
    }, [taskId]);

    useEffect(() => {
        load();
    }, [load]);

    useEffect(() => {
        if (!task || !ACTIVE.includes(task.status)) return;
        const interval = setInterval(load, 3000);
        return () => clearInterval(interval);
    }, [task, load]);

    const plan = task?.plan ?? [];
    const isActive = task ? ACTIVE.includes(task.status) : false;

    // The pending approval is the latest approval_request while waiting_input.
    const pendingApproval =
        task?.status === 'waiting_input'
            ? [...events].reverse().find(e => e.kind === 'approval_request')
            : undefined;

    const onSteer = useCallback(async () => {
        const text = steerText.trim();
        if (!text || busy) return;
        setBusy(true);
        try {
            await tasksApi.steer(taskId, text);
            setSteerText('');
            await load();
        } finally {
            setBusy(false);
        }
    }, [steerText, busy, taskId, load]);

    const onApprove = useCallback(
        async (approved: boolean) => {
            if (!pendingApproval || busy) return;
            setBusy(true);
            try {
                await tasksApi.approve(
                    taskId,
                    pendingApproval.payload?.request_id ?? '',
                    approved,
                );
                await load();
            } finally {
                setBusy(false);
            }
        },
        [pendingApproval, busy, taskId, load],
    );

    return (
        <View
            style={[
                styles.container,
                { backgroundColor: theme.background, paddingTop: insets.top },
            ]}
        >
            <View style={styles.header}>
                <TouchableOpacity
                    onPress={() => navigation.goBack()}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel="Back"
                >
                    <Ionicons
                        name="chevron-back"
                        size={26}
                        color={theme.textPrimary}
                    />
                </TouchableOpacity>
                <Text
                    style={[styles.headerTitle, { color: theme.textPrimary }]}
                    numberOfLines={1}
                >
                    Task
                </Text>
                <View style={styles.headerSpacer} />
            </View>

            {loading && !task ? (
                <ActivityIndicator style={styles.loader} color={theme.accent} />
            ) : !task ? (
                <Text
                    style={[styles.emptyText, { color: theme.textSecondary }]}
                >
                    Task not found.
                </Text>
            ) : (
                <ScrollView
                    contentContainerStyle={{
                        padding: 16,
                        paddingBottom: insets.bottom + 24,
                        gap: 20,
                    }}
                >
                    {/* Goal + status */}
                    <View>
                        <Text
                            style={[styles.goal, { color: theme.textPrimary }]}
                        >
                            {task.goal}
                        </Text>
                        <View style={styles.statusRow}>
                            <View
                                style={[
                                    styles.dot,
                                    {
                                        backgroundColor: statusColor(
                                            task.status,
                                            theme,
                                        ),
                                    },
                                ]}
                            />
                            <Text
                                style={[
                                    styles.statusText,
                                    { color: theme.textSecondary },
                                ]}
                            >
                                {statusLabel(task.status)}
                            </Text>
                        </View>
                    </View>

                    {/* Approval gate */}
                    {pendingApproval && (
                        <View
                            style={[
                                styles.approval,
                                {
                                    backgroundColor: theme.surface,
                                    borderColor: statusColor(
                                        'failed',
                                        theme,
                                    ),
                                },
                            ]}
                        >
                            <Text
                                style={[
                                    styles.approvalTitle,
                                    { color: theme.textPrimary },
                                ]}
                            >
                                Approval needed
                            </Text>
                            <Text
                                style={[
                                    styles.approvalBody,
                                    { color: theme.textSecondary },
                                ]}
                            >
                                {pendingApproval.payload?.title ??
                                    'A risky step needs your confirmation.'}
                            </Text>
                            <View style={styles.approvalActions}>
                                <TouchableOpacity
                                    disabled={busy}
                                    onPress={() => onApprove(false)}
                                    style={[
                                        styles.btn,
                                        { borderColor: theme.border },
                                    ]}
                                >
                                    <Text style={{ color: theme.textPrimary }}>
                                        Reject
                                    </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    disabled={busy}
                                    onPress={() => onApprove(true)}
                                    style={[
                                        styles.btn,
                                        { backgroundColor: theme.accent },
                                    ]}
                                >
                                    <Text style={{ color: '#fff' }}>
                                        Approve
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    )}

                    {/* Plan checklist */}
                    {plan.length > 0 && (
                        <View style={{ gap: 8 }}>
                            <Text
                                style={[
                                    styles.section,
                                    { color: theme.textSecondary },
                                ]}
                            >
                                PLAN
                            </Text>
                            {plan.map(step => {
                                const ic = stepIcon(step.status);
                                const color =
                                    ic.key === 'done'
                                        ? statusColor('done', theme)
                                        : ic.key === 'running'
                                        ? theme.accent
                                        : theme.textSecondary;
                                return (
                                    <View key={step.id} style={styles.stepRow}>
                                        <Ionicons
                                            name={ic.name}
                                            size={18}
                                            color={color}
                                        />
                                        <Text
                                            style={[
                                                styles.stepTitle,
                                                {
                                                    color:
                                                        step.status ===
                                                        'pending'
                                                            ? theme.textSecondary
                                                            : theme.textPrimary,
                                                },
                                            ]}
                                        >
                                            {step.title}
                                        </Text>
                                    </View>
                                );
                            })}
                        </View>
                    )}

                    {/* Activity log */}
                    {events.length > 0 && (
                        <View style={{ gap: 6 }}>
                            <Text
                                style={[
                                    styles.section,
                                    { color: theme.textSecondary },
                                ]}
                            >
                                ACTIVITY
                            </Text>
                            {events.map(e => (
                                <View key={e.id} style={styles.logRow}>
                                    <Text
                                        style={[
                                            styles.logTime,
                                            { color: theme.textSecondary },
                                        ]}
                                    >
                                        {fmtTime(e.created_at)}
                                    </Text>
                                    <Text
                                        style={[
                                            styles.logText,
                                            { color: theme.textPrimary },
                                        ]}
                                    >
                                        {eventLine(e)}
                                    </Text>
                                </View>
                            ))}
                        </View>
                    )}

                    {/* Final result */}
                    {task.result ? (
                        <View style={{ gap: 6 }}>
                            <Text
                                style={[
                                    styles.section,
                                    { color: theme.textSecondary },
                                ]}
                            >
                                RESULT
                            </Text>
                            <Text
                                style={[
                                    styles.result,
                                    { color: theme.textPrimary },
                                ]}
                            >
                                {task.result}
                            </Text>
                        </View>
                    ) : null}
                </ScrollView>
            )}

            {/* Steering input — guide the task while it runs */}
            {task && isActive && (
                <View
                    style={[
                        styles.steerBar,
                        {
                            borderTopColor: theme.border,
                            paddingBottom: insets.bottom + 8,
                            backgroundColor: theme.background,
                        },
                    ]}
                >
                    <TextInput
                        style={[
                            styles.steerInput,
                            {
                                backgroundColor: theme.surface,
                                color: theme.textPrimary,
                            },
                        ]}
                        placeholder="Guide the agent…"
                        placeholderTextColor={theme.textSecondary}
                        value={steerText}
                        onChangeText={setSteerText}
                        editable={!busy}
                        onSubmitEditing={onSteer}
                        returnKeyType="send"
                    />
                    <TouchableOpacity
                        onPress={onSteer}
                        disabled={busy || !steerText.trim()}
                        style={[
                            styles.steerSend,
                            {
                                backgroundColor: steerText.trim()
                                    ? theme.accent
                                    : theme.border,
                            },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel="Send guidance"
                    >
                        <Ionicons name="arrow-up" size={18} color="#fff" />
                    </TouchableOpacity>
                </View>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        gap: 12,
    },
    headerTitle: { fontSize: 20, fontWeight: '700' },
    headerSpacer: { flex: 1 },
    loader: { flex: 1 },
    emptyText: { fontSize: 15, textAlign: 'center', marginTop: 40 },
    goal: { fontSize: 18, fontWeight: '700' },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 8,
    },
    dot: { width: 10, height: 10, borderRadius: 5 },
    statusText: { fontSize: 14 },
    section: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5 },
    stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    stepTitle: { fontSize: 15, flex: 1 },
    logRow: { flexDirection: 'row', gap: 10 },
    logTime: { fontSize: 12, width: 44 },
    logText: { fontSize: 13, flex: 1 },
    result: { fontSize: 14, lineHeight: 20 },
    approval: {
        borderWidth: 1,
        borderRadius: 12,
        padding: 14,
        gap: 8,
    },
    approvalTitle: { fontSize: 15, fontWeight: '700' },
    approvalBody: { fontSize: 13 },
    approvalActions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: 10,
        marginTop: 4,
    },
    btn: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 10,
        borderWidth: StyleSheet.hairlineWidth,
    },
    steerBar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 12,
        paddingTop: 8,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    steerInput: {
        flex: 1,
        borderRadius: 20,
        paddingHorizontal: 14,
        paddingVertical: 8,
        fontSize: 15,
    },
    steerSend: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
