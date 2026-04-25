import React from 'react';
import { Text, Pressable, View } from 'react-native';

type MarkdownRuleOptions = {
    onCodeCopy: (code: string) => void;
    onLinkPress: (url: string) => void;
    onLinkCopy: (url: string) => void;
};

let defaultRulesCache: any = null;
const NOOP: () => void = () => {};

export const createMarkdownRules = (options: MarkdownRuleOptions) => {
    if (
        options.onCodeCopy === NOOP &&
        options.onLinkPress === NOOP &&
        options.onLinkCopy === NOOP
    ) {
        if (!defaultRulesCache) {
            defaultRulesCache = createRulesInternal(options);
        }
        return defaultRulesCache;
    }
    return createRulesInternal(options);
};

// All children are links (no surrounding text)
const isLinkOnlyParagraph = (node: any) =>
    node.children?.length > 0 &&
    node.children.every((c: any) => c.type === 'link' || c.type === 'softbreak');

// Paragraph has links mixed with text → needs flex-row layout
const hasMixedLinks = (node: any) =>
    node.children?.some((c: any) => c.type === 'link') &&
    !isLinkOnlyParagraph(node);

const createRulesInternal = ({ onCodeCopy, onLinkPress, onLinkCopy }: MarkdownRuleOptions) => ({
    paragraph: (node: any, children: any, _parent: any, styles: any) => {
        if (isLinkOnlyParagraph(node)) {
            return (
                <View key={node.key} style={styles.link_paragraph}>
                    {children}
                </View>
            );
        }
        return (
            <Text key={node.key} style={styles.paragraph}>
                {children}
            </Text>
        );
    },

    link: (node: any, children: any, parent: any, styles: any) => {
        const parentNode = Array.isArray(parent) ? parent[0] : parent;
        const isBlockOnly = parentNode && isLinkOnlyParagraph(parentNode);
        const isMixed = parentNode && hasMixedLinks(parentNode);

        if (isBlockOnly) {
            return (
                <Pressable
                    key={node.key}
                    onPress={() => onLinkPress(node.attributes.href)}
                    onLongPress={() => onLinkCopy(node.attributes.href)}
                    delayLongPress={300}
                    style={({ pressed }) => [styles.link_button, pressed && { opacity: 0.7 }]}
                >
                    <Text style={styles.link_button_text} numberOfLines={2}>{children}</Text>
                    <Text style={styles.link_button_icon}>{'↗'}</Text>
                </Pressable>
            );
        }

        // Inline link inside mixed text paragraph
        return (
            <Text
                key={node.key}
                style={styles.link}
                onPress={() => onLinkPress(node.attributes.href)}
                onLongPress={() => onLinkCopy(node.attributes.href)}
                delayLongPress={300}
                suppressHighlighting
            >
                {children}<Text style={styles.link_icon}>{' ↗'}</Text>
            </Text>
        );
    },
    fence: (node: any, children: any, _parent2: any, styles: any) => {
        return (
            <Pressable
                key={node.key}
                onLongPress={() => onCodeCopy(node.content)}
                delayLongPress={300}
                style={({ pressed }) => [
                    styles.fence,
                    pressed && { opacity: 0.8 }
                ]}
            >
                <Text style={{
                    fontFamily: styles.fence?.fontFamily || 'Menlo',
                    fontSize: styles.fence?.fontSize || 14,
                    color: styles.fence?.color || styles.code_block?.color
                }}>
                    {node.content}
                </Text>
            </Pressable>
        );
    },
    code_inline: (node: any, children: any, parent: any, styles: any) => {
        return (
            <Text
                key={node.key}
                onLongPress={() => onCodeCopy(node.content)}
            >
                <View style={[
                    styles.code_inline,
                    {
                        color: undefined,
                        fontFamily: undefined,
                        fontSize: undefined,
                        transform: [{ translateY: 5.5 }],
                        justifyContent: 'center',
                    }
                ]}>
                    <Text style={{
                        fontFamily: styles.code_inline.fontFamily,
                        fontSize: styles.code_inline.fontSize,
                        color: styles.code_inline.color,
                        backgroundColor: 'transparent',
                        lineHeight: styles.code_inline.fontSize * 1.3,
                        textAlignVertical: 'center',
                    }}>
                        {node.content}
                    </Text>
                </View>
            </Text>
        );
    },
    code_block: (node: any, children: any, parent: any, styles: any) => {
        return (
            <Pressable
                key={node.key}
                onLongPress={() => onCodeCopy(node.content)}
                delayLongPress={300}
                style={({ pressed }) => [
                    styles.code_block,
                    pressed && { opacity: 0.8 }
                ]}
            >
                <Text style={{
                    fontFamily: styles.code_block.fontFamily,
                    fontSize: styles.code_block.fontSize,
                    color: styles.code_block.color
                }}>
                    {node.content}
                </Text>
            </Pressable>
        );
    }
});
