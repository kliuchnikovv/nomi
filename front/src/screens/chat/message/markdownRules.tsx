import React from 'react';
import { Text, Pressable, View } from 'react-native';

export const createMarkdownRules = (onCodeCopy: (code: string) => void) => ({
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
        // Use a View inside Text to support borderRadius on iOS (Inline View pattern)
        return (
            <Text
                key={node.key}
                onLongPress={() => onCodeCopy(node.content)}
            >
                <View style={[
                    styles.code_inline,
                    {
                        // Override properties that shouldn't be on the container
                        color: undefined,
                        fontFamily: undefined,
                        fontSize: undefined,
                        // Fix vertical alignment - push down to align with text baseline
                        transform: [{ translateY: 5.5 }],
                        // Ensure text is centered vertically in the pill
                        justifyContent: 'center',
                    }
                ]}>
                    <Text style={{
                        fontFamily: styles.code_inline.fontFamily,
                        fontSize: styles.code_inline.fontSize,
                        color: styles.code_inline.color,
                        backgroundColor: 'transparent',
                        // Fix text vertical alignment inside the pill
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
