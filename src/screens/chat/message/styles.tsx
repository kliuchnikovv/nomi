import { StyleSheet } from 'react-native';
import { oneDark, oneDarkPalette } from '../../../themes/oneDark.ts';
import { redBright } from 'colorette';

const withAlpha = (hex: string, alpha: number) => {
    const h = hex.replace('#', '');
    const bigint = parseInt(h, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const tokens = {
    userBubble: oneDark.gutterGrey,
    actionBg: withAlpha(oneDarkPalette.blue, 0.12),
    actionBorder: withAlpha(oneDarkPalette.blue, 0.3),
    actionLabel: oneDark.text,
    actionWhy: withAlpha(oneDarkPalette.white, 0.7),
    importanceBg: withAlpha(oneDarkPalette.red, 0.15),
    importanceText: oneDarkPalette.red,
    daemonBorder: withAlpha(oneDarkPalette.red, 0.4),
    daemonHeader: oneDarkPalette.red,
};

export const styles = StyleSheet.create({
    assistantContainer: {
        alignSelf: 'stretch',
        // no background, no padding — text only
    },
    bubble: {
        padding: 5,
        borderRadius: 12,
        maxWidth: '85%',
    },
    bubbleUser: {
        alignSelf: 'flex-end',
        backgroundColor: oneDarkPalette.commentGrey,
        minWidth: 60,
    },
    bubbleAssistant: {
        alignSelf: 'flex-start',
        // backgroundColor: 'rgba(171, 178, 191, 0.06)',
    },
    bubbleDaemon: {
        alignSelf: 'flex-start',
        backgroundColor: withAlpha(oneDarkPalette.red, 0.08),
        maxWidth: '85%',
    },
    daemonContainer: {
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: withAlpha(oneDarkPalette.red, 0.4),
        borderRadius: 10,
        padding: 6,
    },
    daemonHeader: {
        color: tokens.daemonHeader,
        fontSize: 11,
        fontWeight: '700',
        marginBottom: 4,
        textTransform: 'uppercase',
    },
    markdownStyles: {
        body: {
            color: oneDark.text,
            fontSize: 16,
            lineHeight: 22,
        },
        code_inline: {
            backgroundColor: oneDark.background,
            paddingHorizontal: 4,
            paddingVertical: 2,
            borderRadius: 4
        },
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
    importanceBadge: {
        alignSelf: 'flex-start',
        backgroundColor: tokens.importanceBg,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
        marginTop: 6,
    },
    importanceText: {
        color: tokens.importanceText,
        fontSize: 12,
        fontWeight: '700',
        textTransform: 'uppercase',
    },
    actionButton: {
        backgroundColor: tokens.actionBg,
        padding: 10,
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: tokens.actionBorder,
    },
    actionWhy: {
        color: tokens.actionWhy,
        fontSize: 12,
        marginTop: 2,
    },
    actionLabel: {
        color: tokens.actionLabel,
        fontSize: 14,
        fontWeight: '600',
    },
});
