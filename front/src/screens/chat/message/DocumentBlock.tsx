import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { styles, markdownStyles } from './styles';

interface DocumentBlockProps {
    title: string;
    content: any;
}

export const DocumentBlock: React.FC<DocumentBlockProps> = ({ title, content }) => {
    const [expanded, setExpanded] = useState(false);

    // Helper to render content based on type
    const renderContent = (data: any) => {
        if (typeof data === 'string') {
            // If data is a string, assuming it might contain markdown
            return (
                <Markdown style={markdownStyles as any}>
                    {data}
                </Markdown>
            );
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
                <Text style={styles.documentTitle}>{title}</Text>
                <Text style={styles.documentChevron}>{expanded ? '▲' : '▼'}</Text>
            </Pressable>

            {expanded && (
                <View style={styles.documentBody}>
                    {renderContent(content)}
                </View>
            )}
        </View>
    );
};
