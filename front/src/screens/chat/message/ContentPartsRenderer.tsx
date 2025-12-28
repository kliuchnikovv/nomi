import React, { useMemo } from 'react';
import { View, Pressable } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { useChat } from '../context';
import { ContentPart } from './models';
import { styles, markdownStyles } from './styles';
import { SingleToolCall, ReasoningBlock, MemberResponseBlock } from './ToolCalls';

export function ContentPartsRenderer({ parts, onLongPress }: { parts: ContentPart[], onLongPress: (text: string) => void }) {
    const { showToolCalls, showReasoning, showMemberResponses } = useChat();

    const filteredParts = useMemo(() => {
        // Optional debug logging, can be removed later
        // console.log('[ContentPartsRenderer] Filtering parts:', { partsLength: parts.length });
        return parts.filter(part => {
            if (part.type === 'tool_call' && !showToolCalls) return false;
            if (part.type === 'reasoning' && !showReasoning) return false;
            if ((part as any).type === 'member_response') {
                const memberPart = part as any;
                // Always show Narrator, otherwise respect the toggle
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

    return (
        <>
            {mergedParts.map((part, index) => {
                if (part.type === 'text') {
                    return (
                        <Pressable
                            key={`text-${index}`}
                            onLongPress={() => onLongPress(part.text || '')}
                            delayLongPress={250}
                            style={({ pressed }) => [pressed && { opacity: 0.75 }]}
                        >
                            <Markdown style={markdownStyles as any}>
                                {part.text || ''}
                            </Markdown>
                        </Pressable>
                    );
                } else if (part.type === 'tool_call') {
                    return <SingleToolCall key={`tool-${index}`} toolCall={part.tool_call} />;
                } else if (part.type === 'reasoning') {
                    return <ReasoningBlock key={`reasoning-${index}`} reasoning={part.reasoning} />;
                } else if ((part as any).type === 'member_response') {
                    // Team member response
                    const memberPart = part as any;
                    return <MemberResponseBlock key={`member-${index}`} agentName={memberPart.agent_name} text={memberPart.text} />;
                }
                return null;
            })}
        </>
    );
}
