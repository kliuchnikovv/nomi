import React from 'react';
import { Text, Pressable, View } from 'react-native';

// Cache for default rules (no-op copy handler)
let defaultRulesCache: any = null;
const NOOP_COPY = () => {};

/**
 * Create markdown rules with optional code copy handler
 * Results are cached for the default no-op handler for performance
 */
export const createMarkdownRules = (onCodeCopy: (code: string) => void) => {
    // Use cached rules for the default no-op handler
    if (onCodeCopy === NOOP_COPY) {
        if (!defaultRulesCache) {
            defaultRulesCache = createRulesInternal(NOOP_COPY);
        }
        return defaultRulesCache;
    }

    return createRulesInternal(onCodeCopy);
};

const createRulesInternal = (onCodeCopy: (code: string) => void) => ({
    fence: (node: any, children: any, parent: any, styles: any) => {
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
