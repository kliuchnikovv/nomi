import React, { useMemo } from 'react';
import { View, Pressable, Alert } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import Markdown from 'react-native-markdown-display';
import { useChat } from '../context';
import { ContentPart } from './models';
import { useTheme } from '../../../context/ThemeContext';
import { createMarkdownStyles } from './dynamicStyles';
import { createMarkdownRules } from './markdownRules';
import { SingleToolCall, ReasoningBlock, MemberResponseBlock, CollapsibleSteps } from './ToolCalls';

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

export function ContentPartsRenderer({ parts, onLongPress }: { parts: ContentPart[], onLongPress: (text: string) => void }) {
    const { showToolCalls, showReasoning, showMemberResponses } = useChat();
    const { theme } = useTheme();
    const { theme } = useTheme();
    const markdownStyles = useMemo(() => createMarkdownStyles(theme), [theme]);

    const handleCodeCopy = (code: string) => {
        Clipboard.setString(code);
        // Optional: visible feedback
        // Alert.alert("Copied", "Code copied to clipboard"); 
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

            if ((part as any).type === 'member_response') {
                const memberPart = part as any;
                // Always show Narrator, otherwise respect the toggle
                // NOTE: We usually WANT to see member responses as bubbles now
                if (memberPart.agent_name !== 'Narrator' && !showMemberResponses) {
                    return false;
                }
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
    // Member responses are NO LONGER considered internal, they should break the group and render standalone
    const groupedParts = useMemo(() => {
        const result: { type: 'group' | 'text' | 'member', parts?: ContentPart[], part?: ContentPart }[] = [];
        let currentInternalGroup: ContentPart[] = [];

        const isInternal = (part: ContentPart) => {
            return part.type === 'tool_call' || part.type === 'reasoning';
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
            } else if ((part as any).type === 'member_response') {
                flushInternalGroup();
                // Special case: Narrator member_response could be treated as text if desired,
                // but treating it as a member block is consistent for "Agent Bubbles"
                result.push({ type: 'member', part });
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
                    if (part.type !== 'text') return null;
                    return (
                        <Pressable
                            key={`text-${groupIndex}`}
                            onLongPress={() => onLongPress(part.text || '')}
                            delayLongPress={250}
                            style={({ pressed }) => [pressed && { opacity: 0.75 }]}
                        >
                            <Markdown style={markdownStyles as any} rules={markdownRules}>
                                {part.text || ''}
                            </Markdown>
                        </Pressable>
                    );
                } else if (group.type === 'member' && group.part) {
                    const memberPart = group.part as any;
                    return (
                        <MemberResponseBlock
                            key={`member-${groupIndex}`}
                            agentName={memberPart.agent_name}
                            text={memberPart.text}
                        />
                    );
                } else if (group.type === 'group' && group.parts) {
                    return (
                        <CollapsibleSteps key={`group-${groupIndex}`}>
                            {group.parts.map((part, index) => {
                                if (part.type === 'tool_call') {
                                    return <SingleToolCall key={`tool-${index}`} toolCall={part.tool_call} />;
                                } else if (part.type === 'reasoning') {
                                    return <ReasoningBlock key={`reasoning-${index}`} reasoning={part.reasoning} />;
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

