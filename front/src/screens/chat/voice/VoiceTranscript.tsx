import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../context/ThemeContext';
import { useChat } from '../context';
import { ChatView } from '../../../components/chat/ChatView';

const MAX_MESSAGES = 20;

export function VoiceTranscript() {
    const { theme } = useTheme();
    const { messages } = useChat();

    return (
        <View
            style={[
                styles.card,
                { backgroundColor: theme.surface, borderColor: theme.border },
            ]}
        >
            <View
                style={[styles.labelRow, { borderBottomColor: theme.border }]}
            >
                <Text style={[styles.label, { color: theme.textSecondary }]}>
                    Transcript
                </Text>
            </View>
            <ChatView
                messages={messages}
                maxMessages={MAX_MESSAGES}
                input={null}
                bubbleOptions={{
                    showToolCalls: false,
                    showReasoning: false,
                    showAttachments: false,
                    showActions: false,
                    showLocations: false,
                    showModelLabel: false,
                    showAgentLabel: false,
                    maxWidthPct: 80,
                }}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        flex: 1,
        borderWidth: 1,
        borderRadius: 20,
        overflow: 'hidden',
    },
    labelRow: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    label: {
        fontSize: 11,
        fontWeight: '600',
        letterSpacing: 0.8,
        textTransform: 'uppercase',
    },
});
