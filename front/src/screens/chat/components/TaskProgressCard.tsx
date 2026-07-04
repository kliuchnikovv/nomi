import React, { useMemo, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    TextInput,
    ActivityIndicator,
    ScrollView,
    Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { useTheme } from '../../../context/ThemeContext';
import { tasksApi } from '../../../apiClient';
import type { AgentTaskStatus, AgentTaskStep } from '../../main/models';
import { statusColor, statusLabel } from '../../tasks/status';
import { createMarkdownStyles } from '../message/dynamicStyles';
import { createMarkdownRules } from '../message/markdownRules';

/** The slice of an AgentTask carried in a task_progress message's metadata. */
export type TaskProgressMeta = {
    task_id: string;
    goal?: string;
    status?: AgentTaskStatus;
    plan?: AgentTaskStep[] | null;
    finished?: boolean;
    result?: string;
    agent?: string;
    approvalRequestId?: string;
    clarify?: { requestId: string; question: string; options: string[] };
};

export const ACTIVE_TASK_STATUSES: AgentTaskStatus[] = [
    'planning',
    'running',
    'waiting_input',
    'paused',
];

/** True while a task is still running (shown docked above the composer). */
export function isTaskActive(meta: TaskProgressMeta): boolean {
    return (
        !meta.finished &&
        ACTIVE_TASK_STATUSES.includes(
            (meta.status ?? 'running') as AgentTaskStatus,
        )
    );
}

function stepIcon(status: AgentTaskStep['status']): {
    name: keyof typeof Ionicons.glyphMap;
    key: 'done' | 'running' | 'pending';
} {
    if (status === 'done') return { name: 'checkmark-circle', key: 'done' };
    if (status === 'running') return { name: 'sync', key: 'running' };
    return { name: 'ellipse-outline', key: 'pending' };
}

/**
 * An interactive, self-contained card rendered inline in the chat thread for a
 * background AgentTask spawned from that chat. Shows live progress and lets the
 * user approve/reject risky steps, stop the task, and steer it — all without
 * leaving the conversation. Actions call tasksApi directly; status updates
 * arrive as task_progress frames that re-render this card.
 */
export const TaskProgressCard: React.FC<{
    task: TaskProgressMeta;
    /** Docked above the composer (pinned) rather than inline in the thread. */
    docked?: boolean;
}> = ({ task, docked = false }) => {
    const { theme } = useTheme();
    const [busy, setBusy] = useState(false);
    const [steerText, setSteerText] = useState('');
    const [clarifyText, setClarifyText] = useState('');
    const markdownStyles = useMemo(() => createMarkdownStyles(theme), [theme]);
    const markdownRules = useMemo(
        () =>
            createMarkdownRules({
                onCodeCopy: () => {},
                onLinkPress: () => {},
                onLinkCopy: () => {},
            }),
        [],
    );

    const status = (task.status ?? 'running') as AgentTaskStatus;
    const plan = task.plan ?? [];
    const active = !task.finished && ACTIVE_TASK_STATUSES.includes(status);
    const doneCount = plan.filter(s => s.status === 'done').length;
    const failColor = statusColor('failed', theme);

    const run = async (fn: () => Promise<unknown>) => {
        if (busy) return;
        setBusy(true);
        try {
            await fn();
        } catch {
            // Best-effort: the next task_progress frame reflects the real state.
        } finally {
            setBusy(false);
        }
    };

    const onApprove = (approved: boolean) => {
        const reqId = task.approvalRequestId;
        if (!reqId) return;
        run(() => tasksApi.approve(task.task_id, reqId, approved));
    };
    const onClarify = (answer: string) => {
        const reqId = task.clarify?.requestId;
        const trimmed = answer.trim();
        if (!reqId || !trimmed) return;
        run(async () => {
            await tasksApi.answerClarify(task.task_id, reqId, trimmed);
            setClarifyText('');
        });
    };
    const onStop = () => run(() => tasksApi.stop(task.task_id));
    const onSteer = () => {
        const msg = steerText.trim();
        if (!msg) return;
        run(async () => {
            await tasksApi.steer(task.task_id, msg);
            setSteerText('');
        });
    };

    const showApproval =
        active && status === 'waiting_input' && !!task.approvalRequestId;
    const showClarify = active && status === 'waiting_input' && !!task.clarify;

    // Collapse to a compact 2-3 line summary (docked only). Approval/clarify
    // gates stay visible even when collapsed since they need user action.
    const [collapsed, setCollapsed] = useState(false);
    const collapsible = docked;
    const isCollapsed = collapsible && collapsed;
    const runningStep = plan.find(s => s.status === 'running');
    const summaryLine =
        runningStep?.title ||
        (plan.length ? `${doneCount}/${plan.length} steps done` : '');

    // Pan on the handle/header: drag down collapses, drag up expands (docked).
    const pan = useMemo(
        () =>
            Gesture.Pan().onEnd(e => {
                'worklet';
                if (e.translationY > 24) runOnJS(setCollapsed)(true);
                else if (e.translationY < -24) runOnJS(setCollapsed)(false);
            }),
        [],
    );

    const hasActions = showApproval || showClarify || (active && !isCollapsed);

    const header = (
        <View style={styles.headerRow}>
            <Ionicons name="construct" size={15} color={theme.accent} />
            <Text style={[styles.headerLabel, { color: theme.textSecondary }]}>
                Background task
            </Text>
            <View style={styles.headerSpacer} />
            <View style={styles.statusRow}>
                <View
                    style={[
                        styles.dot,
                        { backgroundColor: statusColor(status, theme) },
                    ]}
                />
                <Text
                    style={[styles.statusText, { color: theme.textSecondary }]}
                >
                    {statusLabel(status)}
                </Text>
            </View>
        </View>
    );

    // Compact 2-line summary shown when the docked card is collapsed.
    const summary =
        task.goal || summaryLine ? (
            <Text
                style={[styles.summaryLine, { color: theme.textSecondary }]}
                numberOfLines={2}
            >
                {[task.goal, summaryLine].filter(Boolean).join(' — ')}
            </Text>
        ) : null;

    // Scrollable body: goal, plan checklist, and (finished) markdown result.
    const body = (
        <>
            {task.goal ? (
                <Markdown style={markdownStyles as any} rules={markdownRules}>
                    {task.goal}
                </Markdown>
            ) : null}

            {plan.length > 0 && (
                <View style={styles.plan}>
                    <Text
                        style={[styles.section, { color: theme.textSecondary }]}
                    >
                        {`STEPS ${doneCount}/${plan.length}`}
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
                                    size={16}
                                    color={color}
                                />
                                <Text
                                    style={[
                                        styles.stepTitle,
                                        {
                                            color:
                                                step.status === 'pending'
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

            {!active && task.result ? (
                <Markdown style={markdownStyles as any} rules={markdownRules}>
                    {task.result}
                </Markdown>
            ) : null}
        </>
    );

    // Fixed action area (never scrolls away): approval, clarify, steer/stop.
    const actions = (
        <>
            {showApproval && (
                <View style={[styles.approval, { borderColor: failColor }]}>
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
                        A risky step needs your confirmation.
                    </Text>
                    <View style={styles.actionsRow}>
                        <TouchableOpacity
                            disabled={busy}
                            onPress={() => onApprove(false)}
                            style={[styles.btn, { borderColor: theme.border }]}
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
                            <Text style={{ color: '#fff' }}>Approve</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            )}

            {showClarify && task.clarify && (
                <View style={[styles.clarify, { borderColor: theme.accent }]}>
                    <Markdown
                        style={markdownStyles as any}
                        rules={markdownRules}
                    >
                        {task.clarify.question || 'The agent has a question.'}
                    </Markdown>
                    {task.clarify.options.length > 0 && (
                        <View style={styles.optionsRow}>
                            {task.clarify.options.map(option => (
                                <TouchableOpacity
                                    key={option}
                                    disabled={busy}
                                    onPress={() => onClarify(option)}
                                    style={[
                                        styles.optionBtn,
                                        { borderColor: theme.border },
                                    ]}
                                >
                                    <Text style={{ color: theme.textPrimary }}>
                                        {option}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    )}
                    <View style={styles.controls}>
                        <TextInput
                            style={[
                                styles.steerInput,
                                {
                                    backgroundColor: theme.background,
                                    color: theme.textPrimary,
                                    borderColor: theme.border,
                                },
                            ]}
                            placeholder="Type an answer…"
                            placeholderTextColor={theme.textSecondary}
                            value={clarifyText}
                            onChangeText={setClarifyText}
                            editable={!busy}
                            onSubmitEditing={() => onClarify(clarifyText)}
                            returnKeyType="send"
                        />
                        <TouchableOpacity
                            onPress={() => onClarify(clarifyText)}
                            disabled={busy || !clarifyText.trim()}
                            style={[
                                styles.iconBtn,
                                {
                                    backgroundColor: clarifyText.trim()
                                        ? theme.accent
                                        : theme.border,
                                },
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel="Send answer"
                        >
                            <Ionicons name="arrow-up" size={16} color="#fff" />
                        </TouchableOpacity>
                    </View>
                </View>
            )}

            {active && !isCollapsed && (
                <View style={styles.controls}>
                    <TextInput
                        style={[
                            styles.steerInput,
                            {
                                backgroundColor: theme.background,
                                color: theme.textPrimary,
                                borderColor: theme.border,
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
                            styles.iconBtn,
                            {
                                backgroundColor: steerText.trim()
                                    ? theme.accent
                                    : theme.border,
                            },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel="Send guidance"
                    >
                        <Ionicons name="arrow-up" size={16} color="#fff" />
                    </TouchableOpacity>
                    <TouchableOpacity
                        onPress={onStop}
                        disabled={busy}
                        style={[styles.stopBtn, { borderColor: failColor }]}
                        accessibilityRole="button"
                        accessibilityLabel="Stop task"
                    >
                        {busy ? (
                            <ActivityIndicator size="small" color={failColor} />
                        ) : (
                            <Ionicons name="stop" size={15} color={failColor} />
                        )}
                    </TouchableOpacity>
                </View>
            )}
        </>
    );

    // Docked variant: fixed drag-handle + header on top (never scroll), a
    // scrollable body, and a fixed action area. Drag the handle to collapse.
    if (docked) {
        return (
            <View
                style={[
                    styles.card,
                    styles.cardDocked,
                    {
                        backgroundColor:
                            theme.surfaceHighlight ?? theme.surface,
                        borderColor: theme.accent,
                    },
                ]}
            >
                <GestureDetector gesture={pan}>
                    <View style={styles.handleZone}>
                        <View style={styles.handle} />
                        {header}
                    </View>
                </GestureDetector>
                {isCollapsed ? (
                    <View style={styles.dockedCollapsed}>{summary}</View>
                ) : (
                    <ScrollView
                        style={styles.dockedScroll}
                        contentContainerStyle={styles.dockedScrollContent}
                        keyboardShouldPersistTaps="handled"
                    >
                        {body}
                    </ScrollView>
                )}
                {hasActions ? (
                    <View style={styles.dockedActions}>{actions}</View>
                ) : null}
            </View>
        );
    }

    // Inline variant (finished task, in the chat thread): plain card, no handle.
    return (
        <View
            style={[
                styles.card,
                { backgroundColor: theme.surface, borderColor: theme.border },
            ]}
        >
            {header}
            {body}
            {actions}
        </View>
    );
};

const styles = StyleSheet.create({
    card: {
        borderRadius: 14,
        borderWidth: 1,
        padding: 12,
        marginVertical: 6,
        marginHorizontal: 8,
        gap: 10,
    },
    // Docked above the composer: flush margins, no padding/gap of its own
    // (the fixed handle/header, the scrollable body, and the fixed action area
    // each supply their own). The body ScrollView is height-capped, not the card.
    cardDocked: {
        marginHorizontal: 8,
        marginVertical: 0,
        padding: 0,
    },
    handleZone: {
        paddingTop: 8,
        paddingBottom: 6,
        paddingHorizontal: 12,
        gap: 8,
    },
    handle: {
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: '#8E8E93',
        alignSelf: 'center',
    },
    dockedScroll: {
        maxHeight: Math.round(Dimensions.get('window').height * 0.4),
    },
    dockedScrollContent: { paddingHorizontal: 12, paddingBottom: 10, gap: 10 },
    dockedCollapsed: { paddingHorizontal: 12, paddingBottom: 10 },
    dockedActions: {
        paddingHorizontal: 12,
        paddingBottom: 12,
        paddingTop: 4,
        gap: 10,
    },
    summaryLine: { fontSize: 13, lineHeight: 18 },
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    headerLabel: {
        fontSize: 12,
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    headerSpacer: { flex: 1 },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    statusText: { fontSize: 12, fontWeight: '500' },
    goal: { fontSize: 15, fontWeight: '600', lineHeight: 20 },
    plan: { gap: 6 },
    section: {
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 0.5,
    },
    stepRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    stepTitle: { fontSize: 13, flex: 1 },
    approval: {
        borderWidth: 1,
        borderRadius: 10,
        padding: 10,
        gap: 6,
    },
    approvalTitle: { fontSize: 14, fontWeight: '600' },
    approvalBody: { fontSize: 13 },
    actionsRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
    clarify: {
        borderWidth: 1,
        borderRadius: 10,
        padding: 10,
        gap: 8,
    },
    clarifyTitle: { fontSize: 14, fontWeight: '600' },
    optionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    optionBtn: {
        paddingVertical: 8,
        paddingHorizontal: 14,
        borderRadius: 8,
        borderWidth: 1,
    },
    btn: {
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 8,
        borderWidth: 1,
    },
    result: { fontSize: 13, lineHeight: 19 },
    controls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    steerInput: {
        flex: 1,
        borderWidth: 1,
        borderRadius: 18,
        paddingHorizontal: 14,
        paddingVertical: 8,
        fontSize: 14,
    },
    iconBtn: {
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
    },
    stopBtn: {
        width: 34,
        height: 34,
        borderRadius: 17,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
