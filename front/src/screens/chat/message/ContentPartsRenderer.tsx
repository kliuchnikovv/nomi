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
import { SingleToolCall, ReasoningBlock } from './ToolCalls';
import { ToolResultCard } from './ToolResultCard';
import { DocumentBlock } from './DocumentBlock';
import { getChatElementComponent } from '../../../plugins/chatElementRegistry';
import {
    unwrapDiscoveryToolCall,
    decorateKnownToolCall,
} from './discoveryToolAdapter';
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
    speakingChunk,
    onSpeakingTap,
    speakingTheme,
}: {
    text: string;
    simpleStyles: any;
    markdownStyles: any;
    onLongPress: (text: string) => void;
    isStreaming?: boolean;
    /** Substring of `text` currently being voiced by TTS — highlighted in
     *  an animated accent color for a karaoke follow-along. */
    speakingChunk?: string;
    /** Tap on the decorated text triggers this (used to barge-in). */
    onSpeakingTap?: () => void;
    /** Theme colors needed for karaoke tinting. */
    speakingTheme?: { accent: string; accentAlt: string; textPrimary: string };
}) {
    const cursorOpacity = useRef(new Animated.Value(1)).current;
    const karaokeAnim = useRef(new Animated.Value(0)).current;

    const isSpeaking = !!speakingChunk && !!speakingTheme;
    useEffect(() => {
        if (!isSpeaking) return;
        const loop = Animated.loop(
            Animated.sequence([
                Animated.timing(karaokeAnim, {
                    toValue: 1,
                    duration: 900,
                    useNativeDriver: false,
                }),
                Animated.timing(karaokeAnim, {
                    toValue: 0,
                    duration: 900,
                    useNativeDriver: false,
                }),
            ]),
        );
        loop.start();
        return () => loop.stop();
    }, [isSpeaking, karaokeAnim]);

    // Locate `speakingChunk` inside `text` with whitespace-tolerant regex
    // so newlines/markdown in the raw reply don't defeat the highlight.
    const karaokeRange = useMemo(() => {
        if (!speakingChunk) return null;
        const trimmed = speakingChunk.trim();
        if (!trimmed) return null;
        const escaped = trimmed
            .split(/\s+/)
            .filter(Boolean)
            .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('\\s+');
        try {
            const m = new RegExp(escaped).exec(text);
            if (m) return { start: m.index, end: m.index + m[0].length };
        } catch {
            /* bad regex — no highlight */
        }
        return null;
    }, [speakingChunk, text]);

    const karaokeColor = speakingTheme
        ? (karaokeAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [speakingTheme.accentAlt, speakingTheme.accent],
          }) as any)
        : null;

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

    // Fast path: plain text rendering. In voice mode with a live speaking
    // chunk, split the text into 3 spans and animate the middle one.
    const textStyle = isSpeaking
        ? [
              simpleStyles.text,
              speakingTheme
                  ? {
                        fontSize: 17,
                        lineHeight: 24,
                        color: speakingTheme.textPrimary,
                    }
                  : null,
          ]
        : simpleStyles.text;

    if (karaokeRange && karaokeColor) {
        const before = text.slice(0, karaokeRange.start);
        const during = text.slice(karaokeRange.start, karaokeRange.end);
        const after = text.slice(karaokeRange.end);
        return (
            <Pressable
                onPress={onSpeakingTap}
                onLongPress={() => onLongPress(text)}
                delayLongPress={250}
                style={({ pressed }) => [pressed && { opacity: 0.75 }]}
            >
                <Text style={textStyle as any}>
                    {before}
                    <Animated.Text style={{ color: karaokeColor }}>
                        {during}
                    </Animated.Text>
                    {after}
                </Text>
            </Pressable>
        );
    }

    return (
        <Pressable
            onPress={onSpeakingTap}
            onLongPress={() => onLongPress(text)}
            delayLongPress={250}
            style={({ pressed }) => [pressed && { opacity: 0.75 }]}
        >
            <Text style={textStyle as any}>
                {text}
                {isStreaming && !isSpeaking && (
                    <Animated.Text style={{ opacity: cursorOpacity }}>
                        ▋
                    </Animated.Text>
                )}
            </Text>
        </Pressable>
    );
});

// Memoized component for tool calls and reasoning — rendered inline, no outer wrapper
const ToolCallsGroup = memo(function ToolCallsGroup({
    parts,
    showToolCalls = true,
    showReasoning = true,
}: {
    parts: ContentPart[];
    showToolCalls?: boolean;
    showReasoning?: boolean;
}) {
    return (
        <>
            {parts.map((part, index) => {
                if (part.type === 'tool_call') {
                    if (!showToolCalls) return null;
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
                    const resolved =
                        unwrapDiscoveryToolCall(part.tool_call) ??
                        decorateKnownToolCall(part.tool_call) ??
                        part.tool_call;
                    const cardKind = (resolved as any).card;
                    if (cardKind && cardKind !== 'generic') {
                        return (
                            <ToolResultCard
                                key={`tool-${index}`}
                                tool={resolved as any}
                                variant={cardKind}
                            />
                        );
                    }
                    return (
                        <SingleToolCall
                            key={`tool-${index}`}
                            toolCall={resolved}
                        />
                    );
                } else if (part.type === 'reasoning') {
                    if (!showReasoning) return null;
                    return (
                        <ReasoningBlock
                            key={`reasoning-${index}`}
                            reasoning={part.reasoning}
                        />
                    );
                }
                return null;
            })}
        </>
    );
});

type ProcessedPart =
    | { type: 'text'; text: string }
    | { type: 'group'; parts: ContentPart[] };

// Memoized content parts processor.
// Parts are rendered in arrival order: consecutive tool_call/reasoning parts are
// grouped into a single CollapsibleSteps block, but a group boundary resets each
// time a text part appears. This preserves natural interleaving:
//   text-A → [tool-1, reasoning-1] → text-B → [tool-2] → text-C
function useProcessedParts(
    parts: ContentPart[],
    showToolCalls: boolean,
    showReasoning: boolean,
    showMemberResponses: boolean,
) {
    return useMemo(() => {
        if (!parts || parts.length === 0) return [];

        const result: ProcessedPart[] = [];
        let pendingGroup: ContentPart[] = [];

        const flushGroup = () => {
            if (pendingGroup.length > 0) {
                result.push({ type: 'group', parts: pendingGroup });
                pendingGroup = [];
            }
        };

        for (const part of parts) {
            if (part.type === 'tool_call' && !showToolCalls) continue;
            if (part.type === 'reasoning' && !showReasoning) continue;
            if (
                (part as any).type === 'member_response' &&
                !showMemberResponses
            )
                continue;

            const isTextLike =
                part.type === 'text' ||
                (part as any).type === 'member_response';

            if (isTextLike) {
                const txt: string =
                    part.type === 'text' ? part.text : (part as any).text;
                if (isLogMessage(txt)) continue;
                if (txt?.trim()) {
                    flushGroup();
                    result.push({ type: 'text', text: txt });
                }
            } else if (part.type === 'tool_call' || part.type === 'reasoning') {
                pendingGroup.push(part);
            }
        }

        flushGroup();
        return result;
    }, [parts, showToolCalls, showReasoning, showMemberResponses]);
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
    showMemberResponses: showMemberResponsesProp,
    speakingChunk,
    onSpeakingTap,
}: {
    parts: ContentPart[];
    onLongPress: (text: string) => void;
    showToolCalls?: boolean;
    showReasoning?: boolean;
    showMemberResponses?: boolean;
    /** When set, the last text group is rendered with a karaoke-style
     *  highlight over the currently-spoken chunk (see StreamingTextPart). */
    speakingChunk?: string;
    /** Called when the user taps a decorated text group — used to interrupt
     *  TTS playback. */
    onSpeakingTap?: () => void;
}) {
    const chat = useChatOptional();
    const showToolCalls = showToolCallsProp ?? chat?.showToolCalls ?? true;
    const showReasoning = showReasoningProp ?? chat?.showReasoning ?? true;
    const showMemberResponses =
        showMemberResponsesProp ?? chat?.showMemberResponses ?? true;
    const { theme } = useTheme();

    // Simple styles for fast text rendering
    const simpleStyles = useMemo(() => createSimpleTextStyles(theme), [theme]);

    // Markdown styles for final rendering
    const markdownStyles = useMemo(() => createMarkdownStyles(theme), [theme]);

    // Process parts into groups - memoized
    const groupedParts = useProcessedParts(
        parts,
        showToolCalls,
        showReasoning,
        showMemberResponses,
    );

    // Detect if we're currently streaming — gate the heuristic on the real
    // generation signal so completed replies (e.g. slash commands) don't keep
    // a phantom blinking cursor when their text lacks ending punctuation.
    const streaming =
        useMemo(() => isStreamingActive(parts), [parts]) &&
        !!chat?.assistantWorking;

    // Index of the last text group — only that group gets the karaoke
    // decoration so we don't highlight the same chunk in multiple places.
    const lastTextIdx = useMemo(() => {
        for (let i = groupedParts.length - 1; i >= 0; i--) {
            if (groupedParts[i].type === 'text') return i;
        }
        return -1;
    }, [groupedParts]);

    const speakingTheme = useMemo(
        () => ({
            accent: theme.accent,
            accentAlt: theme.accentAlt,
            textPrimary: theme.textPrimary ?? theme.text,
        }),
        [theme.accent, theme.accentAlt, theme.textPrimary, theme.text],
    );

    return (
        <>
            {groupedParts.map((group, index) => {
                if (group.type === 'text') {
                    const decorate = index === lastTextIdx && !!speakingChunk;
                    return (
                        <StreamingTextPart
                            key={`text-${index}-${group.text.length}`}
                            text={group.text}
                            simpleStyles={simpleStyles}
                            markdownStyles={markdownStyles as any}
                            onLongPress={onLongPress}
                            isStreaming={streaming}
                            speakingChunk={decorate ? speakingChunk : undefined}
                            onSpeakingTap={decorate ? onSpeakingTap : undefined}
                            speakingTheme={decorate ? speakingTheme : undefined}
                        />
                    );
                } else {
                    return (
                        <ToolCallsGroup
                            key={`group-${index}`}
                            parts={group.parts}
                            showToolCalls={showToolCalls}
                            showReasoning={showReasoning}
                        />
                    );
                }
            })}
        </>
    );
});
