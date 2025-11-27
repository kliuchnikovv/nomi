import { StyleSheet } from 'react-native';
import { oneDark } from '../../themes/oneDark.ts';

export const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    list: {
        flex: 1,
    },
    listContent: {
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 12,
        gap: 8,
    },
    bubble: {
        padding: 5,
        borderRadius: 12,
        maxWidth: '85%',
        flexDirection: 'row',
        alignItems: 'flex-end',
    },
    bubbleUser: {
        alignSelf: 'flex-end',
        backgroundColor: oneDark.gutterGrey,
    },
    bubbleAssistant: {
        alignSelf: 'flex-start',
        // backgroundColor: 'rgba(171, 178, 191, 0.06)',
    },
    assistantContainer: {
        alignSelf: 'stretch',
        // no background, no padding — text only
    },
    daemonContainer: {
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(224,108,117,0.4)',
        borderRadius: 10,
        padding: 6,
    },
    daemonHeader: {
        color: '#e06c75',
        fontSize: 11,
        fontWeight: '700',
        marginBottom: 4,
        textTransform: 'uppercase',
    },
    bubbleText: {
        color: oneDark.text,
        fontSize: 16,
        lineHeight: 22,
    },
    inputBar: {
        paddingHorizontal: 12,
        paddingBottom: 12,
        paddingTop: 0,
    },
    markdownStyles: {
        body: {
            color: oneDark.text,
            fontSize: 16,
            lineHeight: 22
        },
        code_inline: {
            backgroundColor: oneDark.background,
            paddingHorizontal: 4,
            paddingVertical: 2,
            borderRadius: 4 },
        code_block: {
            backgroundColor: 'rgba(171,178,191,0.12)',
            padding: 8,
            borderRadius: 6
        },
        fence: {
            backgroundColor: 'rgba(171,178,191,0.12)',
            padding: 8,
            borderRadius: 6
        },
        link: {
            color: '#61afef'
        },
        list_item: {
            flexDirection: 'row'
        },
        blockquote: {
            borderLeftWidth: 3,
            borderLeftColor: '#4b5263',
            paddingLeft: 8,
            color: oneDark.text
        },
        heading1: {
            fontSize: 22,
            fontWeight: '600'
        },
        heading2: {
            fontSize: 20,
            fontWeight: '600'
        },
    },
    actionButton: {
        backgroundColor: 'rgba(79, 167, 255, 0.12)',
        padding: 10,
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(79, 167, 255, 0.3)',
    },
    actionMarkdown: {
        body: { color: oneDark.text, fontSize: 14 },
        link: { color: '#61afef' },
    },
    actionWhy: {
        color: 'rgba(171,178,191,0.7)',
        fontSize: 12,
        marginTop: 2,
    },
    importanceBadge: {
        alignSelf: 'flex-start',
        backgroundColor: 'rgba(224,108,117,0.15)',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
        marginTop: 6,
    },
    importanceText: {
        color: '#e06c75',
        fontSize: 12,
        fontWeight: '700',
        textTransform: 'uppercase',
    },
});
