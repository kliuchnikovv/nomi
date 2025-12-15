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
                                        {(typeof toolCall.result === 'string'
                                            ? toolCall.result
                                            : JSON.stringify(toolCall.result, null, 2)
                                        ).slice(0, 50) + (
                                                (typeof toolCall.result === 'string'
                                                    ? toolCall.result.length
                                                    : JSON.stringify(toolCall.result, null, 2).length
                                                ) > 50 ? '...' : ''
                                            )}
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
