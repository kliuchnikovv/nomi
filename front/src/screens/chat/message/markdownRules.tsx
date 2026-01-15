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
