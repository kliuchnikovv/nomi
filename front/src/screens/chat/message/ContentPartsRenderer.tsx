import React, { useMemo } from 'react';
import { View, Pressable, Alert } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import Markdown from 'react-native-markdown-display';
import { useChat } from '../context';
import { ContentPart } from './models';
import { useTheme } from '../../../context/ThemeContext';
import { createMarkdownStyles } from './dynamicStyles';
import { createMarkdownRules } from './markdownRules';
import { SingleToolCall, ReasoningBlock, AgentThinkingBlock, CollapsibleSteps } from './ToolCalls';
import { DocumentBlock } from './DocumentBlock';

/**
 * Detects if a string is a backend JSON log message that shouldn't be displayed in chat.
 * Attributes looked for: "level", "logger", "timestamp", "message" inside a JSON object.
 */
function isLogMessage(text: string): boolean {
    if (!text || !text.trim().startsWith('{')) return false;
    try {
        // Quick heuristic check before parsing to avoid perf hit on all messages
        if (!text.includes('"level"') && !text.includes('"timestamp"')) return false;

        const obj = JSON.parse(text);
        if (typeof obj === 'object' && obj !== null) {
            // Check for common log fields from backend (RailwayJsonFormatter)
            if ('level' in obj && 'timestamp' in obj && 'message' in obj) {
                return true;
            }
        }
        return false;
    } catch (e) {
        return false;
    }
}

// Helper to parse "Document" JSON from text (AnalystOutput, ArchitectPlan, etc.)
function parseDocument(text: string): { msg: string, content: any } | null {
    if (!text) return null;

    // Look for JSON code block: ```json { ... } ```
    const jsonBlockRegex = /```json\s*(\{[\s\S]*?\})\s*```/;
    const match = text.match(jsonBlockRegex);

    if (match && match[1]) {
        try {
            const obj = JSON.parse(match[1]);
            // Check for our specific schema signatures
            if (obj && typeof obj === 'object' && 'msg' in obj && 'content' in obj) {
                return { msg: obj.msg, content: obj.content };
            }
        } catch (e) {
            // Failed to parse, ignore
        }
    }
    return null;
}

export function ContentPartsRenderer({ parts, onLongPress }: { parts: ContentPart[], onLongPress: (text: string) => void }) {
    const { showToolCalls, showReasoning, showMemberResponses } = useChat();
    const { theme } = useTheme();
    const markdownStyles = useMemo(() => createMarkdownStyles(theme), [theme]);

    const handleCodeCopy = (code: string) => {
        Clipboard.setString(code);
        // Optional: visible feedback
        console.log('Code copied to clipboard');
    };

    const markdownRules = useMemo(() => createMarkdownRules(handleCodeCopy), []);

    const filteredParts = useMemo(() => {
        return parts.filter(part => {
            if (part.type === 'tool_call' && !showToolCalls) return false;
            if (part.type === 'reasoning' && !showReasoning) return false;

            // Filter out backend leaked logs
            if (part.type === 'text' && isLogMessage(part.text)) {
                return false;
            }

            // Member responses (agent thinking) - respect showMemberResponses toggle
            if ((part as any).type === 'member_response') {
                return showMemberResponses;
            }
            return true;
        });
    }, [parts, showToolCalls, showReasoning, showMemberResponses]);

    // Merge consecutive text parts for proper markdown rendering
    const mergedParts = useMemo(() => {
        const result: ContentPart[] = [];
        for (const part of filteredParts) {
            if (part.type === 'text') {
                const last = result[result.length - 1];
                if (last && last.type === 'text') {
                    // Merge with previous text part
                    last.text = (last.text || '') + (part.text || '');
                } else {
                    // Create new text part (copy to avoid mutation)
                    result.push({ type: 'text', text: part.text || '' });
                }
            } else {
                result.push(part);
            }
        }
        return result;
    }, [filteredParts]);

    // Group parts for rendering: consecutive "internal" parts (tool_call, reasoning) should be grouped
    const groupedParts = useMemo(() => {
        const result: { type: 'group' | 'text' | 'member', parts?: ContentPart[], part?: ContentPart }[] = [];
        let currentInternalGroup: ContentPart[] = [];

        const isInternal = (part: ContentPart) => {
            return part.type === 'tool_call' || part.type === 'reasoning' || (part as any).type === 'member_response';
        };

        const flushInternalGroup = () => {
            if (currentInternalGroup.length > 0) {
                result.push({ type: 'group', parts: [...currentInternalGroup] });
                currentInternalGroup = [];
            }
        };

        for (const part of mergedParts) {
            if (isInternal(part)) {
                currentInternalGroup.push(part);
            } else {
                // Text part
                flushInternalGroup();
                result.push({ type: 'text', part });
            }
        }
        flushInternalGroup();
        return result;
    }, [mergedParts]);

    return (
        <>
            {groupedParts.map((group, groupIndex) => {
                if (group.type === 'text' && group.part) {
                    const part = group.part;
                    const textContent = part.text || '';

                    // Try to parse as a structured Document first
                    const documentData = parseDocument(textContent);

                    if (documentData) {
                        // Team Lead text: render as plain Markdown (no bubble)
                        return (
                            <View key={`doc-${groupIndex}`}>
                                <Pressable
                                    onLongPress={() => onLongPress(documentData.msg)}
                                    delayLongPress={250}
                                    style={({ pressed }) => [pressed && { opacity: 0.75 }]}
                                >
                                    <Markdown style={markdownStyles as any} rules={markdownRules}>
                                        {documentData.msg}
                                    </Markdown>
                                </Pressable>
                                <DocumentBlock title="Детали" content={documentData.content} />
                            </View>
                        );
                    }

                    // Team Lead text: render as plain Markdown (no bubble) - same for both modes
                    return (
                        <Pressable
                            key={`text-${groupIndex}`}
                            onLongPress={() => onLongPress(textContent)}
                            delayLongPress={250}
                            style={({ pressed }) => [pressed && { opacity: 0.75 }]}
                        >
                            <Markdown style={markdownStyles as any} rules={markdownRules}>
                                {textContent}
                            </Markdown>
                        </Pressable>
                    );

                } else if (group.type === 'group' && group.parts) {
                    return (
                        <CollapsibleSteps key={`group-${groupIndex}`}>
                            {group.parts.map((part, index) => {
                                if (part.type === 'tool_call') {
                                    return <SingleToolCall key={`tool-${index}`} toolCall={part.tool_call} />;
                                } else if (part.type === 'reasoning') {
                                    return <ReasoningBlock key={`reasoning-${index}`} reasoning={part.reasoning} />;
                                } else if ((part as any).type === 'member_response') {
                                    return <AgentThinkingBlock key={`member-${index}`} agentName={(part as any).agent_name} text={(part as any).text} />;
                                }
                                return null;
                            })}
                        </CollapsibleSteps>
                    );
                }
                return null;
            })}
        </>
    );
}
