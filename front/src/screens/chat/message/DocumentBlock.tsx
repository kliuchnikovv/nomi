import React, { useState, useMemo } from 'react';
import { View, Pressable } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { Text } from '@nomi/ds';
import { useTheme } from '../../../context/ThemeContext';
import { createStyles, createMarkdownStyles } from './dynamicStyles';
import { NavArrowDown } from 'iconoir-react-native';

interface DocumentBlockProps {
    title: string;
    content: any;
}

export const DocumentBlock: React.FC<DocumentBlockProps> = ({
    title,
    content,
}) => {
    const [expanded, setExpanded] = useState(false);
    const { theme, palette, descriptor } = useTheme();
    const styles = useMemo(
        () => createStyles(theme, palette),
        [theme, palette],
    );
    const markdownStyles = useMemo(() => createMarkdownStyles(theme), [theme]);

    // Helper to render content based on type
    const renderContent = (data: any) => {
        if (typeof data === 'string') {
            // If data is a string, assuming it might contain markdown
            return <Markdown style={markdownStyles as any}>{data}</Markdown>;
        }

        // Pretty print JSON/Object
        const formatted = JSON.stringify(data, null, 2);
        return (
            <Markdown style={markdownStyles as any}>
                {`\`\`\`json\n${formatted}\n\`\`\``}
            </Markdown>
        );
    };

    return (
        <View style={styles.documentContainer}>
            <Pressable
                style={styles.documentHeader}
                onPress={() => setExpanded(!expanded)}
            >
                <Text theme={descriptor} style={styles.documentTitle}>
                    {title}
                </Text>
                <NavArrowDown
                    width={12}
                    height={12}
                    color={theme.textSecondary}
                    style={{
                        transform: [{ rotate: expanded ? '180deg' : '0deg' }],
                    }}
                />
            </Pressable>

            {expanded && (
                <View style={styles.documentBody}>
                    {renderContent(content)}
                </View>
            )}
        </View>
    );
};
