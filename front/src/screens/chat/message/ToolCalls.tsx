import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { styles } from './styles';

export function ToolCallsSection({ toolCalls }: { toolCalls: any[] }) {
    const [expanded, setExpanded] = useState(false);

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
                <Text style={styles.toolCallsHeaderText}>
                    Tool calls
                </Text>
                <Text style={styles.toolCallsExpandIcon}>
                    {expanded ? '▼' : '▶'}
                </Text>
            </Pressable>
            {expanded && (
                <View style={styles.toolCallsList}>
                    {toolCalls.map((toolCall, index) => (
                        <View key={index} style={styles.toolCallItem}>
                            <Text style={styles.toolCallName}>
                                {toolCall.name}
                            </Text>
                            {toolCall.arguments && (
                                <Text style={styles.toolCallArgs}>
                                    {typeof toolCall.arguments === 'string'
                                        ? toolCall.arguments
                                        : JSON.stringify(toolCall.arguments, null, 2)}
                                </Text>
                            )}
                            {toolCall.result && (
                                <View style={{ marginTop: 8 }}>
                                    <Text style={{ fontSize: 12, fontWeight: '600', color: '#888', marginBottom: 4 }}>Result:</Text>
                                    <Text style={styles.toolCallArgs}>
                                        {typeof toolCall.result === 'string'
                                            ? toolCall.result
                                            : JSON.stringify(toolCall.result, null, 2)}
                                    </Text>
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
                <Text style={styles.singleToolCallName}>
                    {toolCall.name}
                </Text>
                <Text style={styles.toolCallsExpandIcon}>
                    {expanded ? '▼' : '▶'}
                </Text>
            </Pressable>
            {expanded && (
                <View style={styles.singleToolCallDetails}>
                    {toolCall.arguments && (
                        <Text style={styles.toolCallArgs}>
                            {typeof toolCall.arguments === 'string'
                                ? toolCall.arguments
                                : JSON.stringify(toolCall.arguments, null, 2)}
                        </Text>
                    )}
                    {toolCall.result && (
                        <View style={{ marginTop: 4 }}>
                            <Text style={{ fontSize: 11, fontWeight: '600', color: '#888', marginBottom: 2 }}>Result:</Text>
                            <Text style={styles.toolCallArgs}>
                                {typeof toolCall.result === 'string'
                                    ? toolCall.result
                                    : JSON.stringify(toolCall.result, null, 2)}
                            </Text>
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
                <Text style={styles.reasoningHeaderText}>
                    🧠 Thinking
                </Text>
                <Text style={styles.toolCallsExpandIcon}>
                    {expanded ? '▼' : '▶'}
                </Text>
            </Pressable>
            {expanded && (
                <View style={styles.reasoningContent}>
                    <Text style={styles.reasoningText}>
                        {reasoning}
                    </Text>
                </View>
            )}
        </View>
    );
}

// Team member response block for showing agent activity
export function MemberResponseBlock({ agentName, text }: { agentName: string; text: string }) {
    const [expanded, setExpanded] = useState(false);

    if (!text) return null;

    return (
        <View style={styles.memberResponseContainer}>
            <Pressable
                onPress={() => setExpanded(!expanded)}
                style={({ pressed }) => [
                    styles.memberResponseHeader,
                    pressed && { opacity: 0.7 },
                ]}
            >
                <Text style={styles.memberResponseHeaderText}>
                    👤 {agentName}
                </Text>
                <Text style={styles.toolCallsExpandIcon}>
                    {expanded ? '▼' : '▶'}
                </Text>
            </Pressable>
            {expanded && (
                <View style={styles.memberResponseContent}>
                    <Text style={styles.memberResponseText}>
                        {text}
                    </Text>
                </View>
            )}
        </View>
    );
}
