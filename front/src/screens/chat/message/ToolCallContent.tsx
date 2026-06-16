import React, { useMemo } from 'react';
import { View, Text, ScrollView } from 'react-native';
import Markdown from 'react-native-markdown-display';
import Clipboard from '@react-native-clipboard/clipboard';
import { useTheme } from '../../../context/ThemeContext';
import { createStyles, createMarkdownStyles } from './dynamicStyles';
import { createMarkdownRules } from './markdownRules';

// Local copy of the markdown sniff used in ContentPartsRenderer. Kept local to
// avoid a circular import (ContentPartsRenderer imports ToolCalls).
function hasMarkdown(text: string): boolean {
    return (
        text.includes('**') ||
        text.includes('`') ||
        text.includes('[') ||
        text.includes('#') ||
        text.includes('- ') ||
        text.includes('* ') ||
        text.includes('1.') ||
        text.includes('> ') ||
        text.includes('```')
    );
}

type NormalizedValue = { text: string; kind: 'json' | 'text'; json?: any };

/**
 * Normalize a raw tool-call value (arguments or result) for display.
 *
 * Tool payloads frequently arrive double-encoded — a JSON string whose `\n`
 * are literal backslash-n rather than real newlines. We decode those so line
 * breaks render natively, and we classify the content so the renderer can pick
 * markdown vs JSON-highlighting.
 */
export function normalizeToolValue(value: any): NormalizedValue {
    if (value == null) return { text: '', kind: 'text' };

    if (typeof value === 'string') {
        const trimmed = value.trim();
        const isStructured = trimmed.startsWith('{') || trimmed.startsWith('[');
        if (isStructured || trimmed.startsWith('"')) {
            try {
                const parsed = JSON.parse(trimmed);
                if (typeof parsed === 'string') {
                    // Double-encoded string → return the inner string with real newlines.
                    return { text: parsed, kind: 'text' };
                }
                if (parsed && typeof parsed === 'object') {
                    return {
                        text: JSON.stringify(parsed, null, 2),
                        kind: 'json',
                        json: parsed,
                    };
                }
            } catch {
                // not strict JSON — fall through
            }
        }
        // Python-style dict/list repr (single quotes, True/False/None) is not
        // valid JSON but is still structured — highlight it in place.
        if (isStructured) {
            return { text: value, kind: 'json' };
        }
        return { text: value, kind: 'text' };
    }

    if (typeof value === 'object') {
        return {
            text: JSON.stringify(value, null, 2),
            kind: 'json',
            json: value,
        };
    }

    return { text: String(value), kind: 'text' };
}

// Token regex for structured content (JSON or Python-style dict/list repr):
// double- or single-quoted strings (optionally a key when followed by a colon),
// literals, and numbers. Everything between matches (whitespace, braces,
// brackets, commas, colons) is rendered with the base color.
const JSON_TOKEN =
    /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')(\s*:)?|\b(true|false|null|True|False|None)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

// Unescape the common sequences inside a string token so multi-line values
// show as real line breaks instead of literal `\n`. Order matters: handle the
// escaped backslash last so it doesn't consume the others.
function unescapeJsonString(token: string): string {
    return token
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'")
        .replace(/\\\\/g, '\\');
}

type SyntaxColors = {
    key: string;
    string: string;
    number: string;
    literal: string;
    base: string;
};

/**
 * Cheap JSON syntax highlighter — tokenizes the pretty-printed JSON and renders
 * colored <Text> spans using theme colors. No external deps.
 */
function renderHighlightedJson(
    jsonText: string,
    colors: SyntaxColors,
): React.ReactNode {
    const baseColor = colors.base;

    const nodes: React.ReactNode[] = [];
    let lastIndex = 0;
    let key = 0;
    let match: RegExpExecArray | null;

    JSON_TOKEN.lastIndex = 0;
    while ((match = JSON_TOKEN.exec(jsonText)) !== null) {
        if (match.index > lastIndex) {
            nodes.push(
                <Text key={key++} style={{ color: baseColor }}>
                    {jsonText.slice(lastIndex, match.index)}
                </Text>,
            );
        }

        const [token, strToken, keyColon, literalToken, numberToken] = match;
        if (strToken) {
            // A key is a string immediately followed by a colon.
            const isKey = !!keyColon;
            nodes.push(
                <Text
                    key={key++}
                    style={{ color: isKey ? colors.key : colors.string }}
                >
                    {unescapeJsonString(token)}
                </Text>,
            );
        } else if (literalToken) {
            nodes.push(
                <Text key={key++} style={{ color: colors.literal }}>
                    {token}
                </Text>,
            );
        } else if (numberToken) {
            nodes.push(
                <Text key={key++} style={{ color: colors.number }}>
                    {token}
                </Text>,
            );
        }

        lastIndex = match.index + token.length;
    }

    if (lastIndex < jsonText.length) {
        nodes.push(
            <Text key={key++} style={{ color: baseColor }}>
                {jsonText.slice(lastIndex)}
            </Text>,
        );
    }

    return nodes;
}

type ToolCallContentProps = {
    value: any;
    label?: string;
};

/**
 * Shared renderer for tool-call `arguments` / `result`.
 * - Decodes double-encoded strings so real line breaks show.
 * - Renders markdown text with formatting.
 * - Highlights JSON cheaply with colored spans.
 */
export function ToolCallContent({ value, label }: ToolCallContentProps) {
    const { theme, palette } = useTheme();
    const styles = useMemo(
        () => createStyles(theme, palette),
        [theme, palette],
    );
    const markdownStyles = useMemo(() => createMarkdownStyles(theme), [theme]);
    const markdownRules = useMemo(
        () =>
            createMarkdownRules({
                onCodeCopy: (code: string) => Clipboard.setString(code),
                onLinkPress: () => {},
                onLinkCopy: (url: string) => Clipboard.setString(url),
            }),
        [],
    );

    const normalized = useMemo(() => normalizeToolValue(value), [value]);

    const syntaxColors = useMemo<SyntaxColors>(
        () => ({
            key: theme.accent,
            string: theme.success || palette.green,
            number: theme.warning || palette.orange,
            literal: theme.info || palette.cyan,
            base: theme.codeText || palette.fg,
        }),
        [theme, palette],
    );

    if (!normalized.text) return null;

    let body: React.ReactNode;
    if (normalized.kind === 'json') {
        body = (
            <Text style={styles.toolCallArgs}>
                {renderHighlightedJson(normalized.text, syntaxColors)}
            </Text>
        );
    } else if (hasMarkdown(normalized.text)) {
        body = (
            <Markdown style={markdownStyles as any} rules={markdownRules}>
                {normalized.text}
            </Markdown>
        );
    } else {
        body = <Text style={styles.toolCallArgs}>{normalized.text}</Text>;
    }

    return (
        <View style={label ? { marginTop: 4 } : undefined}>
            {label ? (
                <Text
                    style={{
                        fontSize: 11,
                        fontWeight: '600',
                        color: theme.textSecondary,
                        marginBottom: 2,
                    }}
                >
                    {label}
                </Text>
            ) : null}
            <ScrollView
                style={styles.toolCallScrollable}
                nestedScrollEnabled={true}
                persistentScrollbar={true}
                indicatorStyle="white"
            >
                {body}
            </ScrollView>
        </View>
    );
}
