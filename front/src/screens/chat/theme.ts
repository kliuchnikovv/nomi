import { palette as themePalette } from '../../themes';
import { ThemeColors } from '../../themes/types';

export const createChatTheme = (theme: ThemeColors) => ({
    background: theme.background,
    surface: theme.surface,
    surfaceAlt: theme.surfaceHighlight,
    border: theme.border,
    textPrimary: theme.textPrimary,
    textSecondary: theme.textSecondary,
    accent: theme.accent,
    accentAlt: themePalette.cyan,
    userBubble: theme.surface,
    assistantBubble: theme.surfaceHighlight,
    surfaceHighlight: theme.surfaceHighlight,
    errorBackground: 'rgba(224, 108, 117, 0.15)',
    errorText: themePalette.red,
    errorButtonBackground: themePalette.red,
    errorButtonText: '#FFFFFF',
    // Code colors
    codeBg: theme.codeBg || themePalette.bg,
    codeInlineBg: theme.codeInlineBg || '#24283b',
    codeText: theme.codeText || themePalette.white,
});

export const ASSISTANT_BUBBLE_WIDTH_RATIO = 1.0;

export const createMarkdownStyles = (chatTheme: ReturnType<typeof createChatTheme>) => ({
    body: {
        color: chatTheme.textPrimary,
        fontSize: 16,
        lineHeight: 22,
        fontFamily: 'System',
    },
    link: {
        color: chatTheme.accent,
        fontSize: 16,
        fontFamily: 'System',
    },
    bullet_list: {
        color: chatTheme.textPrimary,
        fontSize: 16,
        fontFamily: 'System',
    },
    ordered_list: {
        color: chatTheme.textPrimary,
        fontSize: 16,
        fontFamily: 'System',
    },
    list_item: {
        color: chatTheme.textPrimary,
        fontSize: 16,
        fontFamily: 'System',
    },
    paragraph: {
        color: chatTheme.textPrimary,
        fontSize: 16,
        fontFamily: 'System',
        lineHeight: 22,
    },
    heading1: {
        color: chatTheme.textPrimary,
        fontSize: 22,
        fontFamily: 'System',
        marginBottom: 6,
    },
    heading2: {
        color: chatTheme.textPrimary,
        fontSize: 20,
        fontFamily: 'System',
        marginBottom: 6,
    },
    heading3: {
        color: chatTheme.textPrimary,
        fontSize: 18,
        fontFamily: 'System',
        marginBottom: 4,
    },
    strong: {
        fontWeight: '700',
        color: chatTheme.textPrimary,
        fontSize: 16,
        fontFamily: 'System',
    },
    em: {
        fontStyle: 'italic',
        color: chatTheme.textPrimary,
        fontSize: 16,
        fontFamily: 'System',
    },
    code_inline: {
        backgroundColor: chatTheme.codeInlineBg || '#24283b',
        paddingHorizontal: 4,
        paddingVertical: 2,
        borderRadius: 6,
        color: chatTheme.codeText || '#a9b1d6',
        fontFamily: 'Courier',
    },
    code_block: {
        backgroundColor: chatTheme.codeBg || '#1a1b26',
        padding: 8,
        borderRadius: 10,
        color: chatTheme.codeText || '#a9b1d6',
        fontFamily: 'Courier',
    },
    fence: {
        backgroundColor: chatTheme.codeBg || '#1a1b26',
        padding: 8,
        borderRadius: 10,
        color: chatTheme.codeText || '#a9b1d6',
        fontFamily: 'Courier',
    },
});
