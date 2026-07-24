import React, { useMemo, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { Text } from '@genie/ds';
import { MaterialCommunityIcons as Icon } from '@expo/vector-icons';
import { useTheme } from '../../../context/ThemeContext';
import { ToolCallContent, normalizeToolValue } from './ToolCallContent';
import type { ResolvedToolCall, ToolCardKind } from './discoveryToolAdapter';

type Props = {
    tool: ResolvedToolCall;
    variant: Exclude<ToolCardKind, 'generic'>;
};

const MCI_GLYPHS: Record<string, number> =
    (Icon as any).getRawGlyphMap?.() ?? {};
const hasGlyph = (name?: string): boolean =>
    !!name && MCI_GLYPHS[name] !== undefined;

function serviceColor(theme: any, variant: Props['variant']): string {
    if (variant === 'calendar') return theme.calendar ?? theme.accent;
    if (variant === 'email') return theme.email ?? theme.error ?? theme.accent;
    return theme.task ?? theme.success ?? theme.accent;
}

function defaultIcon(variant: Props['variant']): string {
    if (variant === 'calendar') return 'calendar-outline';
    if (variant === 'email') return 'email-outline';
    return 'check-circle-outline';
}

function formatEventTime(start: any, end: any): string | undefined {
    const s = parseDate(start);
    if (!s) return undefined;
    const e = parseDate(end);
    const day = s.toLocaleDateString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
    });
    const time = (d: Date) =>
        d.toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
        });
    return e ? `${day} · ${time(s)}–${time(e)}` : `${day} · ${time(s)}`;
}

function parseDate(value: any): Date | undefined {
    if (!value) return undefined;
    if (typeof value === 'string' || typeof value === 'number') {
        const d = new Date(value);
        return isNaN(d.getTime()) ? undefined : d;
    }
    if (typeof value === 'object') {
        // Google Calendar-style { dateTime, timeZone } or { date }
        if (value.dateTime) return parseDate(value.dateTime);
        if (value.date) return parseDate(value.date);
    }
    return undefined;
}

function firstLines(text: any, limit = 4): string | undefined {
    if (typeof text !== 'string' || !text.trim()) return undefined;
    return text.split('\n').slice(0, limit).join('\n').trim();
}

function shortenSubject(subject: any): string | undefined {
    if (typeof subject !== 'string' || !subject.trim()) return undefined;
    return subject.length > 40 ? subject.slice(0, 39) + '…' : subject;
}

function objectOrParsed(value: any): any {
    if (!value) return undefined;
    if (typeof value === 'string') {
        const norm = normalizeToolValue(value);
        return norm.kind === 'json' ? norm.json : undefined;
    }
    return typeof value === 'object' ? value : undefined;
}

type CardContent = {
    icon: string;
    title: string;
    subtitle?: string;
    status?: string;
    statusTone?: 'success' | 'muted' | 'accent';
    bodyPreview?: string;
    checklist?: { text: string; done?: boolean }[];
    actions: { label: string; primary?: boolean }[];
};

function buildContent(
    tool: ResolvedToolCall,
    variant: Props['variant'],
): CardContent {
    const args = objectOrParsed(tool.arguments) ?? {};
    const result = objectOrParsed(tool.result);
    const hasResult = result != null;
    const isError =
        (typeof tool.result === 'string' &&
            /^error/i.test(tool.result.trim())) ||
        (result && typeof result === 'object' && 'error' in result);

    if (variant === 'calendar') {
        const title = args.title || args.summary || tool.name;
        const subtitle =
            formatEventTime(args.start, args.end) ||
            (typeof args.location === 'string' ? args.location : undefined);
        const status = isError ? 'Error' : hasResult ? 'Created' : undefined;
        return {
            icon: hasGlyph(tool.icon) ? tool.icon! : defaultIcon('calendar'),
            title,
            subtitle,
            status,
            statusTone: isError ? 'muted' : hasResult ? 'success' : undefined,
            actions: [{ label: 'Open' }, { label: 'Edit' }],
        };
    }

    if (variant === 'email') {
        const subject = shortenSubject(args.subject) || tool.name;
        const to =
            typeof args.to === 'string'
                ? args.to
                : Array.isArray(args.to)
                ? args.to.join(', ')
                : undefined;
        const isDraft =
            /draft/i.test(tool.name) || tool.name === 'create_draft';
        const subtitle = isDraft
            ? `Draft${to ? ` · ${to}` : ''}`
            : to
            ? `To ${to}`
            : undefined;
        const status = isError
            ? 'Error'
            : hasResult
            ? isDraft
                ? 'Draft'
                : 'Sent'
            : undefined;
        return {
            icon: hasGlyph(tool.icon) ? tool.icon! : defaultIcon('email'),
            title: subject,
            subtitle,
            status,
            statusTone: isError ? 'muted' : 'success',
            bodyPreview: firstLines(args.body),
            actions: [
                { label: isDraft ? 'Send' : 'Open', primary: isDraft },
                { label: 'Edit' },
            ],
        };
    }

    // task
    const title = args.title || args.text || args.name || tool.name;
    const subtitle =
        args.list_name || args.list || (isError ? 'Failed' : undefined);
    const status = isError
        ? 'Error'
        : hasResult
        ? args.completed || /complete/i.test(tool.name)
            ? 'Done'
            : 'Created'
        : undefined;
    // Best-effort checklist from a list-style result.
    let checklist: { text: string; done?: boolean }[] | undefined;
    if (Array.isArray(result)) {
        checklist = result.slice(0, 5).map((item: any) => {
            if (typeof item === 'string') return { text: item };
            return {
                text: item?.title ?? item?.text ?? item?.name ?? String(item),
                done: Boolean(item?.completed ?? item?.done),
            };
        });
    }
    return {
        icon: hasGlyph(tool.icon) ? tool.icon! : defaultIcon('task'),
        title,
        subtitle,
        status,
        statusTone: isError ? 'muted' : 'success',
        checklist,
        actions: [{ label: 'Open' }, { label: 'Edit' }],
    };
}

export function ToolResultCard({ tool, variant }: Props) {
    const { theme, descriptor } = useTheme();
    const [expanded, setExpanded] = useState(false);
    const color = serviceColor(theme, variant);
    const content = useMemo(() => buildContent(tool, variant), [tool, variant]);

    const statusColor =
        content.statusTone === 'success'
            ? theme.success ?? color
            : content.statusTone === 'accent'
            ? theme.accentAlt
            : theme.textSecondary;

    return (
        <Animated.View
            entering={FadeInUp.duration(220)}
            style={[
                styles.card,
                {
                    backgroundColor: theme.surface,
                    borderColor: theme.border,
                },
            ]}
        >
            <Pressable
                onPress={() => setExpanded(v => !v)}
                style={({ pressed }) => [
                    styles.header,
                    pressed && { opacity: 0.85 },
                ]}
            >
                <View
                    style={[styles.iconChip, { backgroundColor: color + '28' }]}
                >
                    <Icon name={content.icon as any} size={16} color={color} />
                </View>
                <View style={styles.titleCol}>
                    <Text
                        theme={descriptor}
                        style={[styles.title, { color: theme.textPrimary }]}
                        numberOfLines={1}
                    >
                        {content.title}
                    </Text>
                    {content.subtitle ? (
                        <Text
                            theme={descriptor}
                            style={[
                                styles.subtitle,
                                { color: theme.textSecondary },
                            ]}
                            numberOfLines={1}
                        >
                            {content.subtitle}
                        </Text>
                    ) : null}
                </View>
                {content.status ? (
                    <View style={styles.statusRow}>
                        {content.statusTone === 'success' ? (
                            <Icon
                                name="check"
                                size={12}
                                color={statusColor}
                                style={{ marginRight: 3 }}
                            />
                        ) : null}
                        <Text
                            theme={descriptor}
                            style={[styles.status, { color: statusColor }]}
                        >
                            {content.status}
                        </Text>
                    </View>
                ) : null}
            </Pressable>

            {content.bodyPreview ? (
                <View
                    style={[
                        styles.bodyPreview,
                        {
                            backgroundColor:
                                theme.surfaceAlt ?? theme.background,
                        },
                    ]}
                >
                    <Text
                        theme={descriptor}
                        style={[
                            styles.bodyPreviewText,
                            { color: theme.textSecondary },
                        ]}
                        numberOfLines={4}
                    >
                        {content.bodyPreview}
                    </Text>
                </View>
            ) : null}

            {content.checklist && content.checklist.length > 0 ? (
                <View style={styles.checklist}>
                    {content.checklist.map((item, i) => (
                        <View key={i} style={styles.checkRow}>
                            <View
                                style={[
                                    styles.checkBox,
                                    {
                                        borderColor: item.done
                                            ? theme.success ?? color
                                            : theme.border,
                                    },
                                    item.done && {
                                        backgroundColor:
                                            (theme.success ?? color) + '22',
                                    },
                                ]}
                            >
                                {item.done ? (
                                    <Icon
                                        name="check"
                                        size={11}
                                        color={theme.success ?? color}
                                    />
                                ) : null}
                            </View>
                            <Text
                                theme={descriptor}
                                style={[
                                    styles.checkText,
                                    {
                                        color: item.done
                                            ? theme.textSecondary
                                            : theme.textPrimary,
                                    },
                                ]}
                                numberOfLines={1}
                            >
                                {item.text}
                            </Text>
                        </View>
                    ))}
                </View>
            ) : null}

            {expanded ? (
                <View
                    style={[styles.expanded, { borderTopColor: theme.border }]}
                >
                    {tool.arguments != null ? (
                        <ToolCallContent value={tool.arguments} />
                    ) : null}
                    {tool.result != null ? (
                        <ToolCallContent value={tool.result} label="Result:" />
                    ) : null}
                </View>
            ) : null}

            <View style={[styles.actionsRow, { borderTopColor: theme.border }]}>
                {content.actions.map((action, i) => (
                    <Pressable
                        key={action.label}
                        onPress={() => {
                            // MVP: actions are stubs — the real handlers
                            // (open event in Calendar app, send draft via
                            // ClientToolExecutor) come in a follow-up plan.
                            console.log(
                                '[ToolResultCard] action',
                                action.label,
                                tool.name,
                            );
                        }}
                        style={({ pressed }) => [
                            styles.action,
                            i > 0 && {
                                borderLeftWidth: StyleSheet.hairlineWidth,
                                borderLeftColor: theme.border,
                            },
                            pressed && { opacity: 0.7 },
                        ]}
                    >
                        <Text
                            theme={descriptor}
                            style={[
                                styles.actionText,
                                {
                                    color: action.primary
                                        ? theme.accentAlt
                                        : theme.textPrimary,
                                },
                            ]}
                        >
                            {action.label}
                        </Text>
                    </Pressable>
                ))}
            </View>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    card: {
        borderRadius: 16,
        borderWidth: 1,
        overflow: 'hidden',
        marginVertical: 6,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingTop: 12,
        paddingBottom: 12,
        gap: 10,
    },
    iconChip: {
        width: 28,
        height: 28,
        borderRadius: 9,
        alignItems: 'center',
        justifyContent: 'center',
    },
    titleCol: {
        flex: 1,
        minWidth: 0,
    },
    title: {
        fontSize: 15,
        fontWeight: '600',
        lineHeight: 18,
    },
    subtitle: {
        fontSize: 12.5,
        marginTop: 2,
        lineHeight: 15,
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    status: {
        fontSize: 12,
        fontWeight: '600',
    },
    bodyPreview: {
        marginHorizontal: 12,
        marginBottom: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 10,
    },
    bodyPreviewText: {
        fontSize: 13,
        lineHeight: 19,
    },
    checklist: {
        paddingHorizontal: 12,
        paddingBottom: 12,
        gap: 6,
    },
    checkRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    checkBox: {
        width: 16,
        height: 16,
        borderRadius: 4,
        borderWidth: 1.5,
        alignItems: 'center',
        justifyContent: 'center',
    },
    checkText: {
        fontSize: 13,
        flex: 1,
    },
    expanded: {
        borderTopWidth: 1,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    actionsRow: {
        flexDirection: 'row',
        borderTopWidth: 1,
    },
    action: {
        flex: 1,
        paddingVertical: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    actionText: {
        fontSize: 13,
        fontWeight: '600',
    },
});
