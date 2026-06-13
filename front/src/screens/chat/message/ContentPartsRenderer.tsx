import React, { useMemo, memo, useEffect, useRef } from 'react';
import {
    View,
    Pressable,
    Text,
    StyleSheet,
    Animated,
    Linking,
    Clipboard,
} from 'react-native';
import Markdown from 'react-native-markdown-display';
import { useChatOptional } from '../context';
import { ContentPart } from './models';
import { useTheme } from '../../../context/ThemeContext';
import { createMarkdownStyles } from './dynamicStyles';
import { createMarkdownRules } from './markdownRules';
import { SingleToolCall, ReasoningBlock, CollapsibleSteps } from './ToolCalls';
import { DocumentBlock } from './DocumentBlock';
import { getChatElementComponent } from '../../../plugins/chatElementRegistry';
import { unwrapDiscoveryToolCall } from './discoveryToolAdapter';
import { showToast } from '../../../utils/toast';

const markdownRules = createMarkdownRules({
    onCodeCopy: code => {
        Clipboard.setString(code);
        showToast('Code copied');
    },
    onLinkPress: url => Linking.openURL(url).catch(() => {}),
    onLinkCopy: url => {
        Clipboard.setString(url);
        showToast('Link copied');
    },
});

// Simple text styles for fast rendering during streaming
const createSimpleTextStyles = (theme: any) =>
    StyleSheet.create({
        text: {
            fontSize: 16,
            lineHeight: 22,
            color: theme.colors?.text || '#fff',
            fontFamily: undefined, // System font - fastest
        },
    });

/**
 * Detects if text contains markdown syntax
 * Fast check for common markdown patterns
 */
function hasMarkdown(text: string): boolean {
    // Quick check for common markdown patterns
    return (
        text.includes('**') ||
        text.includes('*') ||
        text.includes('`') ||
        text.includes('[') ||
        text.includes('#') ||
        text.includes('- ') ||
        text.includes('1.') ||
        text.includes('>') ||
        text.includes('```')
    );
}

/**
 * Detects if a string is a backend JSON log message
 */
function isLogMessage(text: string): boolean {
    if (!text || text[0] !== '{') return false;
    const hasLevel = text.includes('"level"');
    const hasTimestamp = text.includes('"timestamp"');
    if (!hasLevel && !hasTimestamp) return false;

    try {
        const obj = JSON.parse(text);
        return (
            obj &&
            typeof obj === 'object' &&
            'level' in obj &&
            'timestamp' in obj &&
            'message' in obj
        );
    } catch {
        return false;
    }
}

// Helper to parse "Document" JSON from text
function parseDocument(text: string): { msg: string; content: any } | null {
    if (!text || !text.includes('```json')) return null;

    const jsonBlockRegex = /```json\s*(\{[\s\S]*?\})\s*```/;
    const match = text.match(jsonBlockRegex);

    if (match?.[1]) {
        try {
            const obj = JSON.parse(match[1]);
            if (
                obj &&
                typeof obj === 'object' &&
                'msg' in obj &&
                'content' in obj
            ) {
                return { msg: obj.msg, content: obj.content };
            }
        } catch {
            // Failed to parse, ignore
        }
    }
    return null;
}

// ULTRA-FAST text renderer for streaming - uses plain Text, not Markdown
const StreamingTextPart = memo(function StreamingTextPart({
    text,
    simpleStyles,
    markdownStyles,
    onLongPress,
    isStreaming = false,
}: {
    text: string;
    simpleStyles: any;
    markdownStyles: any;
    onLongPress: (text: string) => void;
    isStreaming?: boolean;
}) {
    const cursorOpacity = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        if (isStreaming) {
            const animation = Animated.loop(
                Animated.sequence([
                    Animated.timing(cursorOpacity, {
                        toValue: 0,
                        duration: 400,
                        useNativeDriver: true,
                    }),
                    Animated.timing(cursorOpacity, {
                        toValue: 1,
                        duration: 400,
                        useNativeDriver: true,
                    }),
                ]),
            );
            animation.start();
            return () => animation.stop();
        }
    }, [isStreaming, cursorOpacity]);

    // Check for document structure (rare, but handle it)
    const documentData = parseDocument(text);

    if (documentData) {
        return (
            <View>
                <Pressable
                    onLongPress={() => onLongPress(documentData.msg)}
                    delayLongPress={250}
                    style={({ pressed }) => [pressed && { opacity: 0.75 }]}
                >
                    <Markdown style={markdownStyles} rules={markdownRules}>
                        {documentData.msg}
                    </Markdown>
                </Pressable>
                <DocumentBlock title="Details" content={documentData.content} />
            </View>
        );
    }

    // During streaming: use plain Text for maximum speed
    // After streaming: use Markdown only if text contains markdown syntax
    const shouldUseMarkdown = !isStreaming && hasMarkdown(text);

    if (shouldUseMarkdown) {
        return (
            <Pressable
                onLongPress={() => onLongPress(text)}
                delayLongPress={250}
                style={({ pressed }) => [pressed && { opacity: 0.75 }]}
            >
                <Markdown style={markdownStyles} rules={markdownRules}>
                    {text}
                </Markdown>
            </Pressable>
        );
    }

    // Fast path: plain text rendering
    return (
        <Pressable
            onLongPress={() => onLongPress(text)}
            delayLongPress={250}
            style={({ pressed }) => [pressed && { opacity: 0.75 }]}
        >
            <Text style={simpleStyles.text}>
                {text}
                {isStreaming && (
                    <Animated.Text style={{ opacity: cursorOpacity }}>
                        ▋
                    </Animated.Text>
                )}
            </Text>
        </Pressable>
    );
});

// Memoized component for tool calls and reasoning
const ToolCallsGroup = memo(function ToolCallsGroup({
    parts,
}: {
    parts: ContentPart[];
}) {
    return (
        <CollapsibleSteps>
            {parts.map((part, index) => {
                if (part.type === 'tool_call') {
                    // Check chat element registry for custom UI
                    const CustomElement = getChatElementComponent(
                        part.tool_call.name,
                    );
                    if (CustomElement) {
                        const args =
                            typeof part.tool_call.arguments === 'string'
                                ? JSON.parse(part.tool_call.arguments)
                                : part.tool_call.arguments;
                        return (
                            <CustomElement
                                key={`custom-${index}`}
                                args={args}
                                toolCall={part.tool_call}
                            />
                        );
                    }
                    // discovery_tool: render the resolved underlying integration
                    // call ("GitHub · list_repos" + clean result) instead of the
                    // raw routing envelope. Falls back to the original when running
                    // or unparseable.
                    const resolved =
                        unwrapDiscoveryToolCall(part.tool_call) ??
                        part.tool_call;
                    return (
                        <SingleToolCall
                            key={`tool-${index}`}
                            toolCall={resolved}
                        />
                    );
                } else if (part.type === 'reasoning') {
                    return (
                        <ReasoningBlock
                            key={`reasoning-${index}`}
                            reasoning={part.reasoning}
                        />
                    );
                }
                return null;
            })}
        </CollapsibleSteps>
    );
});

type ProcessedPart =
    | { type: 'text'; text: string }
    | { type: 'group'; parts: ContentPart[] };

// Memoized content parts processor.
// All tool_call and reasoning parts are merged into a single collapsible group
// placed before the text response, regardless of interspersed short text fragments.
function useProcessedParts(
    parts: ContentPart[],
    showToolCalls: boolean,
    showReasoning: boolean,
) {
    return useMemo(() => {
        if (!parts || parts.length === 0) return [];

        const groupParts: ContentPart[] = [];
        const textItems: string[] = [];

        for (const part of parts) {
            if (part.type === 'tool_call' && !showToolCalls) continue;
            if (part.type === 'reasoning' && !showReasoning) continue;
            if (part.type === 'text' && isLogMessage(part.text)) continue;

            const isTextLike =
                part.type === 'text' ||
                (part as any).type === 'member_response';
            if (isTextLike) {
                const txt: string =
                    part.type === 'text' ? part.text : (part as any).text;
                if (txt?.trim()) textItems.push(txt);
            } else if (part.type === 'tool_call' || part.type === 'reasoning') {
                groupParts.push(part);
            }
        }

        const result: ProcessedPart[] = [];
        if (groupParts.length > 0) {
            result.push({ type: 'group', parts: groupParts });
        }
        for (const text of textItems) {
            result.push({ type: 'text', text });
        }
        return result;
    }, [parts, showToolCalls, showReasoning]);
}

// Detect if streaming is active by checking for incomplete text parts
function isStreamingActive(parts: ContentPart[]): boolean {
    // If last part is text and doesn't end with punctuation, likely streaming
    if (!parts || parts.length === 0) return false;
    const lastPart = parts[parts.length - 1];
    if (lastPart.type !== 'text' || !lastPart.text) return false;
    const text = lastPart.text.trim();
    // Check if text ends with sentence-ending punctuation
    return text.length > 0 && !/[.!?。！？]\s*$/.test(text);
}

export const ContentPartsRenderer = memo(function ContentPartsRenderer({
    parts,
    onLongPress,
    showToolCalls: showToolCallsProp,
    showReasoning: showReasoningProp,
}: {
    parts: ContentPart[];
    onLongPress: (text: string) => void;
    showToolCalls?: boolean;
    showReasoning?: boolean;
}) {
    const chat = useChatOptional();
    const showToolCalls = showToolCallsProp ?? chat?.showToolCalls ?? true;
    const showReasoning = showReasoningProp ?? chat?.showReasoning ?? true;
    const { theme } = useTheme();

    // Simple styles for fast text rendering
    const simpleStyles = useMemo(() => createSimpleTextStyles(theme), [theme]);

    // Markdown styles for final rendering
    const markdownStyles = useMemo(() => createMarkdownStyles(theme), [theme]);

    // Process parts into groups - memoized
    const groupedParts = useProcessedParts(parts, showToolCalls, showReasoning);

    // Detect if we're currently streaming
    const streaming = useMemo(() => isStreamingActive(parts), [parts]);

    return (
        <>
            {groupedParts.map((group, index) => {
                if (group.type === 'text') {
                    return (
                        <StreamingTextPart
                            key={`text-${index}-${group.text.length}`}
                            text={group.text}
                            simpleStyles={simpleStyles}
                            markdownStyles={markdownStyles as any}
                            onLongPress={onLongPress}
                            isStreaming={streaming}
                        />
                    );
                } else {
                    return (
                        <ToolCallsGroup
                            key={`group-${index}`}
                            parts={group.parts}
                        />
                    );
                }
            })}
        </>
    );
});
