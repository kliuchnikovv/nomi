import React, { useState, useMemo } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useTheme } from '../../../context/ThemeContext';
import { createStyles, createMarkdownStyles } from './dynamicStyles';
import Markdown from 'react-native-markdown-display';
import { createMarkdownRules } from './markdownRules';
import Clipboard from '@react-native-clipboard/clipboard';
import { Brain, NavArrowDown } from 'iconoir-react-native';
import { MaterialCommunityIcons as Icon } from '@expo/vector-icons';

// Glyph map of the icon font, used to skip rendering unknown names (which would
// otherwise show a broken "?" box).
const MCI_GLYPHS: Record<string, number> =
    (Icon as any).getRawGlyphMap?.() ?? {};
const hasGlyph = (name?: string): boolean =>
    !!name && MCI_GLYPHS[name] !== undefined;

export function ToolCallsSection({ toolCalls }: { toolCalls: any[] }) {
    const [expanded, setExpanded] = useState(false);
    const { theme, palette } = useTheme();
    const styles = useMemo(
        () => createStyles(theme, palette),
        [theme, palette],
    );

    if (!toolCalls || toolCalls.length === 0) {
        return null;
    }

    return (
        <View style={styles.toolCallsContainer}>
            <Pressable
                onPress={() => setExpanded(!expanded)}
                style={({ pressed }) => [
                    styles.toolCallsHeader,
                    pressed && { opacity: 0.7 },
                ]}
            >
                <Text style={styles.toolCallsHeaderText}>Tool calls</Text>
                <Text style={styles.toolCallsExpandIcon}>
                    <NavArrowDown
                        width={12}
                        height={12}
                        color={theme.textSecondary}
                        style={{
                            transform: [
                                { rotate: expanded ? '0deg' : '-90deg' },
                            ],
                        }}
                    />
                </Text>
            </Pressable>
            {expanded && (
                <View style={styles.toolCallsList}>
                    {toolCalls.map((toolCall, index) => (
                        <View key={index} style={styles.toolCallItem}>
                            <Text style={styles.toolCallName}>
                                {toolCall.name === 'delegate_task_to_member'
                                    ? 'Delegating...'
                                    : toolCall.name}
                            </Text>
                            {toolCall.arguments && (
                                <ScrollView
                                    style={styles.toolCallScrollable}
                                    nestedScrollEnabled={true}
                                    persistentScrollbar={true}
                                    indicatorStyle="white"
                                >
                                    <Text style={styles.toolCallArgs}>
                                        {typeof toolCall.arguments === 'string'
                                            ? toolCall.arguments
                                            : JSON.stringify(
                                                  toolCall.arguments,
                                                  null,
                                                  2,
                                              )}
                                    </Text>
                                </ScrollView>
                            )}
                            {toolCall.result && (
                                <View style={{ marginTop: 8 }}>
                                    <Text
                                        style={{
                                            fontSize: 12,
                                            fontWeight: '600',
                                            color: theme.textSecondary,
                                            marginBottom: 4,
                                        }}
                                    >
                                        Result:
                                    </Text>
                                    <ScrollView
                                        style={styles.toolCallScrollable}
                                        nestedScrollEnabled={true}
                                        persistentScrollbar={true}
                                        indicatorStyle="white"
                                    >
                                        <Text style={styles.toolCallArgs}>
                                            {typeof toolCall.result === 'string'
                                                ? toolCall.result
                                                : JSON.stringify(
                                                      toolCall.result,
                                                      null,
                                                      2,
                                                  )}
                                        </Text>
                                    </ScrollView>
                                </View>
                            )}
                        </View>
                    ))}
                </View>
            )}
        </View>
    );
}

// Single tool call component for inline rendering
export function SingleToolCall({ toolCall }: { toolCall: any }) {
    const [expanded, setExpanded] = useState(false);
    const { theme, palette } = useTheme();
    const styles = useMemo(
        () => createStyles(theme, palette),
        [theme, palette],
    );

    if (!toolCall) return null;

    return (
        <View style={styles.singleToolCallContainer}>
            <Pressable
                onPress={() => setExpanded(!expanded)}
                style={({ pressed }) => [
                    styles.singleToolCallHeader,
                    pressed && { opacity: 0.7 },
                ]}
            >
                <View
                    style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        flexShrink: 1,
                    }}
                >
                    {hasGlyph(toolCall.icon) ? (
                        <Icon
                            name={toolCall.icon}
                            size={14}
                            color={theme.textSecondary}
                            style={{ marginRight: 6 }}
                        />
                    ) : null}
                    <Text style={styles.singleToolCallName} numberOfLines={1}>
                        {toolCall.name === 'delegate_task_to_member'
                            ? 'Delegating...'
                            : toolCall.name}
                    </Text>
                </View>
                <Text style={styles.toolCallsExpandIcon}>
                    <NavArrowDown
                        width={12}
                        height={12}
                        color={theme.textSecondary}
                        style={{
                            transform: [
                                { rotate: expanded ? '0deg' : '-90deg' },
                            ],
                        }}
                    />
                </Text>
            </Pressable>
            {expanded && (
                <View style={styles.singleToolCallDetails}>
                    {toolCall.arguments && (
                        <ScrollView
                            style={styles.toolCallScrollable}
                            nestedScrollEnabled={true}
                            persistentScrollbar={true}
                            indicatorStyle="white"
                        >
                            <Text style={styles.toolCallArgs}>
                                {typeof toolCall.arguments === 'string'
                                    ? toolCall.arguments
                                    : JSON.stringify(
                                          toolCall.arguments,
                                          null,
                                          2,
                                      )}
                            </Text>
                        </ScrollView>
                    )}
                    {toolCall.result && (
                        <View style={{ marginTop: 4 }}>
                            <Text
                                style={{
                                    fontSize: 11,
                                    fontWeight: '600',
                                    color: theme.textSecondary,
                                    marginBottom: 2,
                                }}
                            >
                                Result:
                            </Text>
                            <ScrollView
                                style={styles.toolCallScrollable}
                                nestedScrollEnabled={true}
                                persistentScrollbar={true}
                                indicatorStyle="white"
                            >
                                <Text style={styles.toolCallArgs}>
                                    {typeof toolCall.result === 'string'
                                        ? toolCall.result
                                        : JSON.stringify(
                                              toolCall.result,
                                              null,
                                              2,
                                          )}
                                </Text>
                            </ScrollView>
                        </View>
                    )}
                </View>
            )}
        </View>
    );
}

// Reasoning block component for inline thinking display
export function ReasoningBlock({ reasoning }: { reasoning: string }) {
    const [expanded, setExpanded] = useState(false);
    const { theme, palette } = useTheme();
    const styles = useMemo(
        () => createStyles(theme, palette),
        [theme, palette],
    );

    if (!reasoning) return null;

    return (
        <View style={styles.reasoningContainer}>
            <Pressable
                onPress={() => setExpanded(!expanded)}
                style={({ pressed }) => [
                    styles.reasoningHeader,
                    pressed && { opacity: 0.7 },
                ]}
            >
                <View
                    style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        flexShrink: 1,
                    }}
                >
                    <Icon
                        name="thought-bubble-outline"
                        size={14}
                        color={theme.textSecondary}
                        style={{ marginRight: 6 }}
                    />
                    <Text style={styles.reasoningHeaderText}>Thinking...</Text>
                </View>
                <Text style={styles.toolCallsExpandIcon}>
                    <NavArrowDown
                        width={12}
                        height={12}
                        color={theme.textSecondary}
                        style={{
                            transform: [
                                { rotate: expanded ? '0deg' : '-90deg' },
                            ],
                        }}
                    />
                </Text>
            </Pressable>
            {expanded && (
                <View style={styles.reasoningContent}>
                    <Text style={styles.reasoningText}>{reasoning}</Text>
                </View>
            )}
        </View>
    );
}

// Agent thinking block - shows team member agent responses as collapsible "thinking"
// This displays other agents' work as internal reflections, not direct messages
export function AgentThinkingBlock({
    agentName,
    text,
}: {
    agentName: string;
    text: string;
}) {
    const [expanded, setExpanded] = useState(false);
    const { theme, palette } = useTheme();
    const styles = useMemo(
        () => createStyles(theme, palette),
        [theme, palette],
    );
    const markdownStyles = useMemo(() => createMarkdownStyles(theme), [theme]);

    const handleCodeCopy = (code: string) => {
        Clipboard.setString(code);
    };

    const markdownRules = useMemo(
        () => createMarkdownRules(handleCodeCopy),
        [],
    );

    if (!text) return null;

    return (
        <View style={styles.agentThinkingContainer}>
            <Pressable
                onPress={() => setExpanded(!expanded)}
                style={({ pressed }) => [
                    styles.agentThinkingHeader,
                    pressed && { opacity: 0.7 },
                ]}
            >
                <Text style={styles.agentThinkingHeaderText}>
                    <Brain width={16} height={16} color={theme.textSecondary} />{' '}
                    Thinking
                </Text>
                <Text style={styles.toolCallsExpandIcon}>
                    <NavArrowDown
                        width={12}
                        height={12}
                        color={theme.textSecondary}
                        style={{
                            transform: [
                                { rotate: expanded ? '0deg' : '-90deg' },
                            ],
                        }}
                    />
                </Text>
            </Pressable>
            {expanded && (
                <View style={styles.agentThinkingContent}>
                    <Markdown
                        style={markdownStyles as any}
                        rules={markdownRules}
                    >
                        {text}
                    </Markdown>
                </View>
            )}
        </View>
    );
}

// Legacy alias for backward compatibility
export const MemberResponseBlock = AgentThinkingBlock;

// Collapsible steps container for grouping internal parts
export function CollapsibleSteps({
    children,
    defaultExpanded = false,
    icon,
}: {
    children: React.ReactNode;
    defaultExpanded?: boolean;
    icon?: string;
}) {
    const [expanded, setExpanded] = useState(defaultExpanded);
    const { theme, palette } = useTheme();
    const styles = useMemo(
        () => createStyles(theme, palette),
        [theme, palette],
    );

    return (
        <View style={styles.collapsibleStepsContainer}>
            <Pressable
                onPress={() => setExpanded(!expanded)}
                style={({ pressed }) => [
                    styles.collapsibleStepsHeader,
                    pressed && { opacity: 0.7 },
                ]}
            >
                <View
                    style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        flexShrink: 1,
                    }}
                >
                    {hasGlyph(icon) ? (
                        <Icon
                            name={
                                icon as React.ComponentProps<
                                    typeof Icon
                                >['name']
                            }
                            size={14}
                            color={theme.textSecondary}
                            style={{ marginRight: 6 }}
                        />
                    ) : null}
                    <Text style={styles.collapsibleStepsHeaderText}>
                        Details
                    </Text>
                </View>
                <Text style={styles.toolCallsExpandIcon}>
                    <NavArrowDown
                        width={12}
                        height={12}
                        color={theme.textSecondary}
                        style={{
                            transform: [
                                { rotate: expanded ? '0deg' : '-90deg' },
                            ],
                        }}
                    />
                </Text>
            </Pressable>
            {expanded && (
                <View style={styles.collapsibleStepsContent}>{children}</View>
            )}
        </View>
    );
}
